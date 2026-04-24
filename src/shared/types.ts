export type ColumnType =
  | 'BOOLEAN'
  | 'TINYINT' | 'SMALLINT' | 'INTEGER' | 'BIGINT' | 'HUGEINT'
  | 'UTINYINT' | 'USMALLINT' | 'UINTEGER' | 'UBIGINT'
  | 'FLOAT' | 'DOUBLE' | 'DECIMAL'
  | 'VARCHAR' | 'BLOB'
  | 'DATE' | 'TIME' | 'TIMESTAMP' | 'TIMESTAMP WITH TIME ZONE' | 'INTERVAL'
  | 'UUID' | 'JSON'
  | string

export interface ColumnSchema {
  name: string
  type: ColumnType
  nullable: boolean
}

export interface OpenFileResult {
  tableId: string
  path: string
  kind: 'parquet' | 'csv' | 'tsv' | 'json'
  schema: ColumnSchema[]
  rowCount: number
}

export type Filter =
  | { col: string; op: 'eq' | 'neq'; value: string | number | boolean | null }
  | { col: string; op: 'in' | 'notIn'; values: (string | number | boolean | null)[] }
  | { col: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: string | number }
  | { col: string; op: 'range'; min?: number | string; max?: number | string }
  | { col: string; op: 'contains' | 'notContains' | 'startsWith' | 'endsWith'; value: string; caseSensitive?: boolean }
  | { col: string; op: 'isNull' | 'notNull' }

export interface Sort {
  col: string
  dir: 'asc' | 'desc'
}

export interface PageRequest {
  tableId: string
  offset: number
  limit: number
  sorts: Sort[]
  filters: Filter[]
  queryId: string
}

export interface PageResult {
  rows: Record<string, unknown>[]
  totalMatched: number
  queryId: string
}

export interface FindMatchesRequest {
  tableId: string
  filters: Filter[]
  sorts: Sort[]
  searchText: string
}

export interface FindMatchesResult {
  indexes: number[]
  truncated: boolean
}

export interface IpcApi {
  openFile(path: string): Promise<OpenFileResult>
  getPage(req: PageRequest): Promise<PageResult>
  cancel(queryId: string): Promise<void>
  runSql(sql: string): Promise<{ columns: ColumnSchema[]; rows: Record<string, unknown>[] }>
  runSqlAsView(baseTableId: string, sql: string): Promise<OpenFileResult>
  resetToBase(baseTableId: string): Promise<OpenFileResult>
  closeTable(tableId: string): Promise<void>
  findMatches(req: FindMatchesRequest): Promise<FindMatchesResult>
  getRecents(): Promise<string[]>
  clearRecents(): Promise<void>
  onOpenFile(cb: (path: string) => void): () => void
  onFileChanged(cb: () => void): () => void
  pathForFile(file: File): string | undefined
}

declare global {
  interface Window {
    api: IpcApi
  }
}
