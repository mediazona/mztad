import path from 'node:path'
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api'
import type {
  ColumnSchema,
  FindMatchesRequest,
  FindMatchesResult,
  OpenFileResult,
  PageRequest,
  PageResult,
} from '@shared/types'
import { buildOrderBy, buildQuickSearch, buildWhere, quoteIdent } from '@shared/sqlBuilder'

const FIND_MATCH_LIMIT = 50000
const COL_WIDTH_SAMPLE_ROWS = 5000
const COL_WIDTH_PER_CHAR = 7.5
// AG Grid quartz cells have ~17px horizontal padding on each side; header cells
// additionally host the filter button. Keep a small safety margin so the last
// character doesn't hit the resize-handle hit zone.
const COL_WIDTH_HEADER_PAD = 64
const COL_WIDTH_DATA_PAD = 46
const COL_WIDTH_MIN = 72
const COL_WIDTH_MAX = 400

type Kind = OpenFileResult['kind']

interface TableMeta {
  path: string
  kind: Kind
  cols: Set<string>
  schema: ColumnSchema[]
  colWidths: Record<string, number>
  baseId?: string // set on custom-SQL views; points at the file-backed base view
}

function isNumericType(t: string): boolean {
  const up = t.toUpperCase()
  return (
    up.includes('INT') ||
    up === 'FLOAT' || up === 'DOUBLE' || up === 'REAL' ||
    up.startsWith('DECIMAL') || up.startsWith('NUMERIC') ||
    up === 'HUGEINT'
  )
}

function detectKind(filePath: string): Kind {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.parquet' || ext === '.pq') return 'parquet'
  if (ext === '.tsv') return 'tsv'
  if (ext === '.json' || ext === '.ndjson' || ext === '.jsonl') return 'json'
  return 'csv'
}

function readerFor(kind: Kind, filePath: string): string {
  const lit = `'${filePath.replace(/'/g, "''")}'`
  switch (kind) {
    case 'parquet':
      return `read_parquet(${lit})`
    case 'tsv':
      // TSV convention: no quote char — tabs don't appear in data, so " is treated as literal
      return `read_csv_auto(${lit}, delim='\t', quote='', escape='')`
    case 'json':
      // ignore_errors=true skips records whose auto-detected types can't be coerced
      // (common on large JSON files where one column has mixed empty strings + dates).
      return `read_json_auto(${lit}, ignore_errors=true)`
    case 'csv':
      return `read_csv_auto(${lit}, quote='"', escape='"')`
  }
}

export class DuckDBService {
  private instance!: DuckDBInstance
  private readConn!: DuckDBConnection
  private metaConn!: DuckDBConnection
  private tables = new Map<string, TableMeta>()
  // Cache COUNT(*) per (tableId, filters) so mid-scroll page fetches don't re-scan the file.
  // Invalidated when the table is closed or replaced.
  private countCache = new Map<string, Map<string, number>>()
  private idCounter = 0

  private filtersKey(filters: unknown[]): string {
    return filters.length === 0 ? '' : JSON.stringify(filters)
  }

  private getCachedCount(tableId: string, filters: unknown[]): number | undefined {
    return this.countCache.get(tableId)?.get(this.filtersKey(filters))
  }

  private setCachedCount(tableId: string, filters: unknown[], count: number): void {
    let inner = this.countCache.get(tableId)
    if (!inner) {
      inner = new Map()
      this.countCache.set(tableId, inner)
    }
    inner.set(this.filtersKey(filters), count)
  }

  // Estimate initial column widths from a sample so tables open sized for
  // their actual data instead of a one-size-fits-all default. Two queries run
  // in parallel:
  //   1. LIMIT-5000 sample, MAX(LENGTH(...)) per column — catches text/date/bool.
  //   2. MIN/MAX per numeric column over the full table — catches autoincrement
  //      keys whose max-length value sits at the end of the file and never
  //      appears in the sample. Parquet answers from row-group stats; CSV/JSON
  //      pay one linear pass.
  // LIMIT is used instead of USING SAMPLE because LIMIT lets DuckDB stop after
  // N rows, whereas reservoir sampling scans the full file.
  private async computeColWidths(
    tableId: string,
    schema: ColumnSchema[],
  ): Promise<Record<string, number>> {
    const widths: Record<string, number> = {}
    for (const c of schema) {
      widths[c.name] = Math.min(
        COL_WIDTH_MAX,
        Math.max(COL_WIDTH_MIN, Math.round(c.name.length * COL_WIDTH_PER_CHAR + COL_WIDTH_HEADER_PAD)),
      )
    }
    if (schema.length === 0) return widths

    const tid = quoteIdent(tableId)
    const sampleSelects = schema
      .map((c, i) => `MAX(LENGTH(TRY_CAST(${quoteIdent(c.name)} AS VARCHAR))) AS c${i}`)
      .join(', ')
    const sampleSql = `SELECT ${sampleSelects} FROM (SELECT * FROM ${tid} LIMIT ${COL_WIDTH_SAMPLE_ROWS})`

    const numericIdx = schema
      .map((c, i) => (isNumericType(c.type) ? i : -1))
      .filter((i) => i >= 0)
    const extremesSql =
      numericIdx.length > 0
        ? `SELECT ${numericIdx
            .map(
              (i) =>
                `LENGTH(TRY_CAST(MAX(${quoteIdent(schema[i]!.name)}) AS VARCHAR)) AS hi${i}, ` +
                `LENGTH(TRY_CAST(MIN(${quoteIdent(schema[i]!.name)}) AS VARCHAR)) AS lo${i}`,
            )
            .join(', ')} FROM ${tid}`
        : null

    const samplePromise = this.metaConn.runAndReadAll(sampleSql).catch(() => null)
    const extremesPromise = extremesSql
      ? this.readConn.runAndReadAll(extremesSql).catch(() => null)
      : Promise.resolve(null)
    const [sampleReader, extremesReader] = await Promise.all([samplePromise, extremesPromise])

    const sampleRow = sampleReader?.getRowObjects()[0] as
      | Record<string, bigint | number | null>
      | undefined
    const extremesRow = extremesReader?.getRowObjects()[0] as
      | Record<string, bigint | number | null>
      | undefined
    if (!sampleRow && !extremesRow) return widths

    const toLen = (v: bigint | number | null | undefined): number =>
      v == null ? 0 : Number(v)

    for (let i = 0; i < schema.length; i++) {
      const c = schema[i]!
      const sampleLen = toLen(sampleRow?.[`c${i}`])
      const hiLen = toLen(extremesRow?.[`hi${i}`])
      const loLen = toLen(extremesRow?.[`lo${i}`])
      const maxLen = Math.max(sampleLen, hiLen, loLen)
      const headerPx = c.name.length * COL_WIDTH_PER_CHAR + COL_WIDTH_HEADER_PAD
      const dataPx = maxLen * COL_WIDTH_PER_CHAR + COL_WIDTH_DATA_PAD
      const w = Math.round(Math.max(headerPx, dataPx))
      widths[c.name] = Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, w))
    }
    return widths
  }

  async init(): Promise<void> {
    this.instance = await DuckDBInstance.create(':memory:')
    this.readConn = await this.instance.connect()
    this.metaConn = await this.instance.connect()
  }

  async openFile(filePath: string): Promise<OpenFileResult> {
    const kind = detectKind(filePath)
    const tableId = `t_${++this.idCounter}`
    const viewSql = `CREATE OR REPLACE VIEW ${quoteIdent(tableId)} AS SELECT * FROM ${readerFor(kind, filePath)}`
    await this.metaConn.run(viewSql)

    const descReader = await this.metaConn.runAndReadAll(`DESCRIBE ${quoteIdent(tableId)}`)
    const descRows = descReader.getRowObjects() as Array<Record<string, unknown>>
    const schema: ColumnSchema[] = descRows.map((r) => ({
      name: String(r.column_name),
      type: String(r.column_type),
      nullable: String(r.null ?? 'YES').toUpperCase() === 'YES',
    }))

    const cntReader = await this.metaConn.runAndReadAll(
      `SELECT COUNT(*)::BIGINT AS n FROM ${quoteIdent(tableId)}`,
    )
    const cntRow = cntReader.getRowObjects()[0] as { n: bigint | number }
    const rowCount = typeof cntRow.n === 'bigint' ? Number(cntRow.n) : Number(cntRow.n)

    const colWidths = await this.computeColWidths(tableId, schema)
    this.tables.set(tableId, {
      path: filePath,
      kind,
      cols: new Set(schema.map((c) => c.name)),
      schema,
      colWidths,
    })
    this.setCachedCount(tableId, [], rowCount)
    return { tableId, path: filePath, kind, schema, rowCount, colWidths }
  }

  async getPage(req: PageRequest): Promise<PageResult> {
    const meta = this.tables.get(req.tableId)
    if (!meta) throw new Error(`Unknown tableId: ${req.tableId}`)
    const { sql: whereSql, params } = buildWhere(req.filters, meta.cols)
    const orderBy = buildOrderBy(req.sorts, meta.cols)
    const where = whereSql ? `WHERE ${whereSql}` : ''

    const tid = quoteIdent(req.tableId)
    const pageSql = `SELECT * FROM ${tid} ${where} ${orderBy} LIMIT ${req.limit} OFFSET ${req.offset}`.trim()
    const boundParams = params.length ? (params as never[]) : undefined

    const cached = this.getCachedCount(req.tableId, req.filters)
    if (cached !== undefined) {
      const pageReader = await this.readConn.runAndReadAll(pageSql, boundParams)
      const rows = pageReader.getRowObjectsJson() as Record<string, unknown>[]
      return { rows, totalMatched: cached, queryId: req.queryId }
    }

    const countSql = `SELECT COUNT(*)::BIGINT AS n FROM ${tid} ${where}`.trim()
    // Count on metaConn, page on readConn — separate connections execute concurrently.
    const [cntReader, pageReader] = await Promise.all([
      this.metaConn.runAndReadAll(countSql, boundParams),
      this.readConn.runAndReadAll(pageSql, boundParams),
    ])
    const cntRow = cntReader.getRowObjects()[0] as { n: bigint | number }
    const totalMatched = typeof cntRow.n === 'bigint' ? Number(cntRow.n) : Number(cntRow.n)
    const rows = pageReader.getRowObjectsJson() as Record<string, unknown>[]
    this.setCachedCount(req.tableId, req.filters, totalMatched)
    return { rows, totalMatched, queryId: req.queryId }
  }

  async findMatches(req: FindMatchesRequest): Promise<FindMatchesResult> {
    const meta = this.tables.get(req.tableId)
    if (!meta) throw new Error(`Unknown tableId: ${req.tableId}`)
    const text = req.searchText.trim()
    if (!text) return { indexes: [], truncated: false }

    const { sql: whereSql, params: whereParams } = buildWhere(req.filters, meta.cols)
    const { sql: qsSql, params: qsParams } = buildQuickSearch(text, meta.schema)
    if (!qsSql) return { indexes: [], truncated: false }
    const orderBy = buildOrderBy(req.sorts, meta.cols)
    // Window ORDER BY must match getPage's so returned indexes line up with AG Grid row positions.
    const windowClause = orderBy ? `OVER (${orderBy})` : 'OVER ()'
    const where = whereSql ? `WHERE ${whereSql}` : ''
    const tid = quoteIdent(req.tableId)
    const params = [...whereParams, ...qsParams]

    const sql = `
      SELECT (_mz_rn - 1) AS _mz_idx FROM (
        SELECT *, ROW_NUMBER() ${windowClause} AS _mz_rn
        FROM ${tid}
        ${where}
      ) AS _mz_sub
      WHERE ${qsSql}
      ORDER BY _mz_rn
      LIMIT ${FIND_MATCH_LIMIT + 1}
    `
    const reader = await this.readConn.runAndReadAll(sql, params.length ? (params as never[]) : undefined)
    const rows = reader.getRowObjects() as Array<{ _mz_idx: bigint | number }>
    const indexes = rows
      .slice(0, FIND_MATCH_LIMIT)
      .map((r) => (typeof r._mz_idx === 'bigint' ? Number(r._mz_idx) : Number(r._mz_idx)))
    return { indexes, truncated: rows.length > FIND_MATCH_LIMIT }
  }

  async runSqlAsView(baseTableId: string, sql: string): Promise<OpenFileResult> {
    const base = this.tables.get(baseTableId)
    if (!base) throw new Error(`Unknown baseTableId: ${baseTableId}`)
    const customId = `t_${++this.idCounter}_custom`
    // Wrap in parentheses so any trailing semicolon or whitespace is still a valid subquery.
    const trimmed = sql.trim().replace(/;+\s*$/, '')
    await this.metaConn.run(
      `CREATE OR REPLACE VIEW ${quoteIdent(customId)} AS (${trimmed})`,
    )
    const descReader = await this.metaConn.runAndReadAll(`DESCRIBE ${quoteIdent(customId)}`)
    const descRows = descReader.getRowObjects() as Array<Record<string, unknown>>
    const schema: ColumnSchema[] = descRows.map((r) => ({
      name: String(r.column_name),
      type: String(r.column_type),
      nullable: String(r.null ?? 'YES').toUpperCase() === 'YES',
    }))
    const cntReader = await this.metaConn.runAndReadAll(
      `SELECT COUNT(*)::BIGINT AS n FROM ${quoteIdent(customId)}`,
    )
    const cntRow = cntReader.getRowObjects()[0] as { n: bigint | number }
    const rowCount = Number(cntRow.n)

    const colWidths = await this.computeColWidths(customId, schema)
    this.tables.set(customId, {
      path: base.path,
      kind: base.kind,
      cols: new Set(schema.map((c) => c.name)),
      schema,
      colWidths,
      baseId: baseTableId,
    })
    this.setCachedCount(customId, [], rowCount)
    return { tableId: customId, path: base.path, kind: base.kind, schema, rowCount, colWidths }
  }

  async resetToBase(baseTableId: string): Promise<OpenFileResult> {
    const base = this.tables.get(baseTableId)
    if (!base) throw new Error(`Unknown baseTableId: ${baseTableId}`)
    let rowCount = this.getCachedCount(baseTableId, [])
    if (rowCount === undefined) {
      const cntReader = await this.metaConn.runAndReadAll(
        `SELECT COUNT(*)::BIGINT AS n FROM ${quoteIdent(baseTableId)}`,
      )
      const cntRow = cntReader.getRowObjects()[0] as { n: bigint | number }
      rowCount = Number(cntRow.n)
      this.setCachedCount(baseTableId, [], rowCount)
    }
    return {
      tableId: baseTableId,
      path: base.path,
      kind: base.kind,
      schema: base.schema,
      rowCount,
      colWidths: base.colWidths,
    }
  }

  async runSql(sql: string): Promise<{ columns: ColumnSchema[]; rows: Record<string, unknown>[] }> {
    const reader = await this.metaConn.runAndReadAll(sql)
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[]
    const columns: ColumnSchema[] =
      rows.length > 0
        ? Object.keys(rows[0]!).map((name) => ({ name, type: 'VARCHAR', nullable: true }))
        : []
    return { columns, rows }
  }

  async closeTable(tableId: string): Promise<void> {
    if (!this.tables.has(tableId)) return
    try {
      await this.metaConn.run(`DROP VIEW IF EXISTS ${quoteIdent(tableId)}`)
    } catch {
      /* view may already be gone; proceed to evict metadata */
    }
    this.tables.delete(tableId)
    this.countCache.delete(tableId)
  }

  async cancel(_queryId: string): Promise<void> {
    const anyConn = this.readConn as unknown as { interrupt?: () => void }
    try {
      anyConn.interrupt?.()
    } catch {
      /* interrupt unsupported or no active query */
    }
  }

  async close(): Promise<void> {
    try { (this.readConn as unknown as { close?: () => void }).close?.() } catch { /* ignore */ }
    try { (this.metaConn as unknown as { close?: () => void }).close?.() } catch { /* ignore */ }
  }
}
