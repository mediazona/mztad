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

type Kind = OpenFileResult['kind']

interface TableMeta {
  path: string
  kind: Kind
  cols: Set<string>
  schema: ColumnSchema[]
  baseId?: string // set on custom-SQL views; points at the file-backed base view
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
  private idCounter = 0

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

    this.tables.set(tableId, { path: filePath, kind, cols: new Set(schema.map((c) => c.name)), schema })
    return { tableId, path: filePath, kind, schema, rowCount }
  }

  async getPage(req: PageRequest): Promise<PageResult> {
    const meta = this.tables.get(req.tableId)
    if (!meta) throw new Error(`Unknown tableId: ${req.tableId}`)
    const { sql: whereSql, params } = buildWhere(req.filters, meta.cols)
    const orderBy = buildOrderBy(req.sorts, meta.cols)
    const where = whereSql ? `WHERE ${whereSql}` : ''

    const tid = quoteIdent(req.tableId)
    const countSql = `SELECT COUNT(*)::BIGINT AS n FROM ${tid} ${where}`.trim()
    const pageSql = `SELECT * FROM ${tid} ${where} ${orderBy} LIMIT ${req.limit} OFFSET ${req.offset}`.trim()

    const cntReader = await this.readConn.runAndReadAll(countSql, params.length ? (params as never[]) : undefined)
    const cntRow = cntReader.getRowObjects()[0] as { n: bigint | number }
    const totalMatched = typeof cntRow.n === 'bigint' ? Number(cntRow.n) : Number(cntRow.n)

    const pageReader = await this.readConn.runAndReadAll(pageSql, params.length ? (params as never[]) : undefined)
    const rows = pageReader.getRowObjectsJson() as Record<string, unknown>[]

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

    this.tables.set(customId, {
      path: base.path,
      kind: base.kind,
      cols: new Set(schema.map((c) => c.name)),
      schema,
      baseId: baseTableId,
    })
    return { tableId: customId, path: base.path, kind: base.kind, schema, rowCount }
  }

  async resetToBase(baseTableId: string): Promise<OpenFileResult> {
    const base = this.tables.get(baseTableId)
    if (!base) throw new Error(`Unknown baseTableId: ${baseTableId}`)
    const cntReader = await this.metaConn.runAndReadAll(
      `SELECT COUNT(*)::BIGINT AS n FROM ${quoteIdent(baseTableId)}`,
    )
    const cntRow = cntReader.getRowObjects()[0] as { n: bigint | number }
    return {
      tableId: baseTableId,
      path: base.path,
      kind: base.kind,
      schema: base.schema,
      rowCount: Number(cntRow.n),
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
