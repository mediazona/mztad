import type { ColumnSchema, Filter, Sort } from './types.js'

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function isKnownCol(col: string, known: Set<string>): void {
  if (!known.has(col)) throw new Error(`Unknown column: ${col}`)
}

export function buildWhere(
  filters: Filter[],
  knownCols: Set<string>,
): { sql: string; params: unknown[] } {
  if (filters.length === 0) return { sql: '', params: [] }
  const clauses: string[] = []
  const params: unknown[] = []

  for (const f of filters) {
    isKnownCol(f.col, knownCols)
    const c = quoteIdent(f.col)
    switch (f.op) {
      case 'eq':
        if (f.value === null) {
          clauses.push(`${c} IS NULL`)
        } else {
          clauses.push(`${c} = ?`)
          params.push(f.value)
        }
        break
      case 'neq':
        if (f.value === null) {
          clauses.push(`${c} IS NOT NULL`)
        } else {
          clauses.push(`(${c} IS NULL OR ${c} != ?)`)
          params.push(f.value)
        }
        break
      case 'in':
      case 'notIn': {
        if (f.values.length === 0) {
          clauses.push(f.op === 'in' ? 'FALSE' : 'TRUE')
          break
        }
        const nulls = f.values.filter((v) => v === null)
        const nonNull = f.values.filter((v) => v !== null)
        const parts: string[] = []
        if (nonNull.length > 0) {
          parts.push(`${c} ${f.op === 'in' ? 'IN' : 'NOT IN'} (${nonNull.map(() => '?').join(',')})`)
          params.push(...nonNull)
        }
        if (nulls.length > 0) {
          parts.push(`${c} IS ${f.op === 'in' ? '' : 'NOT '}NULL`)
        }
        clauses.push(`(${parts.join(f.op === 'in' ? ' OR ' : ' AND ')})`)
        break
      }
      case 'gt':
        clauses.push(`${c} > ?`)
        params.push(f.value)
        break
      case 'gte':
        clauses.push(`${c} >= ?`)
        params.push(f.value)
        break
      case 'lt':
        clauses.push(`${c} < ?`)
        params.push(f.value)
        break
      case 'lte':
        clauses.push(`${c} <= ?`)
        params.push(f.value)
        break
      case 'range': {
        const parts: string[] = []
        if (f.min !== undefined) {
          parts.push(`${c} >= ?`)
          params.push(f.min)
        }
        if (f.max !== undefined) {
          parts.push(`${c} <= ?`)
          params.push(f.max)
        }
        if (parts.length === 0) continue
        clauses.push(`(${parts.join(' AND ')})`)
        break
      }
      case 'contains':
      case 'notContains':
      case 'startsWith':
      case 'endsWith': {
        const op = f.caseSensitive ? 'LIKE' : 'ILIKE'
        const escaped = f.value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
        const pat =
          f.op === 'contains' || f.op === 'notContains' ? `%${escaped}%` :
          f.op === 'startsWith' ? `${escaped}%` :
          `%${escaped}`
        if (f.op === 'notContains') {
          clauses.push(`(${c} IS NULL OR ${c} NOT ${op} ? ESCAPE '\\')`)
        } else {
          clauses.push(`${c} ${op} ? ESCAPE '\\'`)
        }
        params.push(pat)
        break
      }
      case 'regex':
      case 'notRegex': {
        // DuckDB's regexp_matches returns true on any substring match; users
        // can anchor with ^/$ for whole-string behavior. Case-insensitive
        // matching goes through the 'i' option flag.
        const expr = f.caseSensitive
          ? `regexp_matches(${c}, ?)`
          : `regexp_matches(${c}, ?, 'i')`
        if (f.op === 'notRegex') {
          clauses.push(`(${c} IS NULL OR NOT ${expr})`)
        } else {
          clauses.push(expr)
        }
        params.push(f.value)
        break
      }
      case 'isNull':
        clauses.push(`${c} IS NULL`)
        break
      case 'notNull':
        clauses.push(`${c} IS NOT NULL`)
        break
    }
  }
  return clauses.length ? { sql: clauses.join(' AND '), params } : { sql: '', params }
}

export function buildQuickSearch(
  q: string,
  schema: ColumnSchema[],
): { sql: string; params: unknown[] } {
  const trimmed = q.trim()
  if (!trimmed || schema.length === 0) return { sql: '', params: [] }
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  const pat = `%${escaped}%`
  const parts: string[] = []
  const params: unknown[] = []
  for (const c of schema) {
    const up = c.type.toUpperCase()
    const expr =
      up === 'VARCHAR' || up.startsWith('VARCHAR') || up === 'CHAR' || up === 'JSON'
        ? quoteIdent(c.name)
        : `CAST(${quoteIdent(c.name)} AS VARCHAR)`
    parts.push(`${expr} ILIKE ? ESCAPE '\\'`)
    params.push(pat)
  }
  return { sql: `(${parts.join(' OR ')})`, params }
}

export function buildOrderBy(sorts: Sort[], knownCols: Set<string>): string {
  if (sorts.length === 0) return ''
  const parts = sorts.map((s) => {
    isKnownCol(s.col, knownCols)
    return `${quoteIdent(s.col)} ${s.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`
  })
  return `ORDER BY ${parts.join(', ')}`
}

function toSqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return `'${String(v).replace(/'/g, "''")}'`
}

function inlineParams(sql: string, params: unknown[]): string {
  let i = 0
  return sql.replace(/\?/g, () => toSqlLiteral(params[i++]))
}

export function formatPageSql(
  tableRef: string,
  filters: Filter[],
  sorts: Sort[],
  schema: ColumnSchema[],
): string {
  const cols = new Set(schema.map((c) => c.name))
  const { sql: whereSql, params: whereParams } = buildWhere(filters, cols)
  const where = whereSql ? `WHERE ${whereSql}` : ''
  const order = buildOrderBy(sorts, cols)
  const rawPieces = [`SELECT * FROM ${tableRef}`, where, order].filter(Boolean)
  return inlineParams(rawPieces.join('\n'), whereParams)
}
