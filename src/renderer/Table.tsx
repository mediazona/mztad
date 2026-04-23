import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type {
  CellClickedEvent,
  CellDoubleClickedEvent,
  CellMouseDownEvent,
  CellMouseOverEvent,
  ColDef,
  GridApi,
  GridReadyEvent,
  ICellRendererParams,
  IDatasource,
  RowClassParams,
  RowStyle,
} from 'ag-grid-community'
import type { ColumnSchema, Filter, Sort } from '@shared/types'
import { ColumnHeader } from './ColumnHeader.js'

const PAGE_SIZE = 200
const ROW_ID_COL = '__mz_row_id'

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function cellToTSVField(v: unknown): string {
  return formatValue(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

function buildSelectionTSV(
  selection: Map<number, Set<string>>,
  includeHeader: boolean,
  api: GridApi,
): string | null {
  if (selection.size === 0) return null
  const allColIds = (api.getColumns()?.map((c) => c.getColId()) ?? []).filter((c) => c !== ROW_ID_COL)
  const union = new Set<string>()
  for (const s of selection.values()) for (const c of s) union.add(c)
  const cols = allColIds.filter((c) => union.has(c))
  if (cols.length === 0) return null
  const sortedRows = Array.from(selection.keys()).sort((a, b) => a - b)
  const lines: string[] = []
  if (includeHeader) lines.push(cols.join('\t'))
  for (const rowIdx of sortedRows) {
    const node = api.getDisplayedRowAtIndex(rowIdx)
    if (!node || node.data == null) continue
    const data = node.data as Record<string, unknown>
    const rowCols = selection.get(rowIdx)!
    lines.push(cols.map((c) => (rowCols.has(c) ? cellToTSVField(data[c]) : '')).join('\t'))
  }
  return lines.join('\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>
  const re = new RegExp(`(${escapeRegex(search)})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <mark key={i} className="match-hl">{p}</mark> : p,
      )}
    </>
  )
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

interface Props {
  tableId: string
  schema: ColumnSchema[]
  filters: Filter[]
  sorts: Sort[]
  hiddenCols: Set<string>
  matchIndexes: Set<number>
  currentMatchIndex: number | null
  searchText: string
  theme: 'light' | 'dark'
  onAddFilter: (f: Filter) => void
  onToggleSort: (col: string, multi: boolean) => void
  onTotalMatched: (n: number) => void
  onHideColumn: (col: string) => void
  onFocusCell: (col: string, value: unknown, rowIndex: number) => void
  onOpenDetails: () => void
}

export function Table({
  tableId,
  schema,
  filters,
  sorts,
  hiddenCols,
  matchIndexes,
  currentMatchIndex,
  searchText,
  theme,
  onAddFilter,
  onToggleSort,
  onTotalMatched,
  onHideColumn,
  onFocusCell,
  onOpenDetails,
}: Props) {
  const filtersRef = useRef(filters)
  const sortsRef = useRef(sorts)
  const tableIdRef = useRef(tableId)
  const matchIndexesRef = useRef(matchIndexes)
  const currentMatchIndexRef = useRef(currentMatchIndex)
  const searchTextRef = useRef(searchText)
  const gridApiRef = useRef<GridApi | null>(null)

  // Custom cell selection: rowIndex -> Set of colIds selected in that row
  const [selection, setSelection] = useState<Map<number, Set<string>>>(new Map())
  const [anchor, setAnchor] = useState<{ row: number; col: string } | null>(null)
  const selectionRef = useRef(selection)
  const anchorRef = useRef(anchor)
  const draggingRef = useRef(false)
  const lastDragCellRef = useRef<string | null>(null)
  useEffect(() => { selectionRef.current = selection }, [selection])
  useEffect(() => { anchorRef.current = anchor }, [anchor])

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false
      lastDragCellRef.current = null
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // Clear selection when the underlying table changes or filters/sorts shift
  // (row indices no longer refer to the same logical rows).
  useEffect(() => {
    setSelection(new Map())
    setAnchor(null)
  }, [tableId, filters, sorts])

  // Deferred cell refresh so .cell-selected class re-applies on selection change
  useEffect(() => {
    const id = window.setTimeout(() => {
      gridApiRef.current?.refreshCells({ force: true })
    }, 0)
    return () => window.clearTimeout(id)
  }, [selection])

  useEffect(() => { filtersRef.current = filters }, [filters])
  useEffect(() => { sortsRef.current = sorts }, [sorts])
  useEffect(() => { tableIdRef.current = tableId }, [tableId])
  useEffect(() => { matchIndexesRef.current = matchIndexes }, [matchIndexes])
  useEffect(() => { currentMatchIndexRef.current = currentMatchIndex }, [currentMatchIndex])
  useEffect(() => { searchTextRef.current = searchText }, [searchText])

  useEffect(() => {
    gridApiRef.current?.purgeInfiniteCache()
  }, [filters, sorts, tableId])

  // Copy shortcuts:
  //   ⌘C  → selected cells as TSV, no header (single cell = plain value)
  //   ⌘⌥C → selected cells as TSV with header
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Match physical key — on macOS Option+C produces 'ç', which would miss an e.key === 'c' check.
      const isC = e.code === 'KeyC' || e.key.toLowerCase() === 'c' || e.key === 'ç'
      if (!isC) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const sel = window.getSelection()
      if (sel && sel.toString().length > 0) return
      const api = gridApiRef.current
      if (!api) return
      const sel2 = selectionRef.current
      if (sel2.size === 0) return
      const text = buildSelectionTSV(sel2, e.altKey, api)
      if (text == null) return
      e.preventDefault()
      void navigator.clipboard.writeText(text).catch((err) => {
        console.warn('clipboard write failed', err)
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Soft redraw on match-state change — deferred to next tick so AG Grid's
  // synchronous cell-ctrl updates don't re-enter React's render cycle.
  useEffect(() => {
    const id = window.setTimeout(() => {
      gridApiRef.current?.redrawRows()
    }, 0)
    return () => window.clearTimeout(id)
  }, [matchIndexes, currentMatchIndex, searchText])

  // Scroll current match into view via DOM (AG Grid's ensureIndexVisible no-ops
  // for infinite-row indices outside the current cache).
  useEffect(() => {
    if (currentMatchIndex == null) return
    const api = gridApiRef.current
    if (!api) return
    const rowHeight = (api.getGridOption('rowHeight') as number | undefined) ?? 42
    const viewports = Array.from(
      document.querySelectorAll<HTMLElement>('.ag-body-viewport, .ag-center-cols-viewport'),
    )
    let main: HTMLElement | null = null
    let maxH = 0
    for (const el of viewports) {
      if (el.scrollHeight > maxH) { main = el; maxH = el.scrollHeight }
    }
    if (!main) return
    const target = Math.max(
      0,
      currentMatchIndex * rowHeight - main.clientHeight / 2 + rowHeight / 2,
    )
    main.scrollTop = target
  }, [currentMatchIndex])

  // Stable references — AG Grid treats prop-identity change as a grid option update,
  // and rapid updates there can trigger a setCellCtrls/flushSync loop in v33+.
  const getRowStyle = useCallback(
    (params: RowClassParams): RowStyle | undefined => {
      const idx = params.node.rowIndex
      if (idx == null) return undefined
      if (idx === currentMatchIndexRef.current) {
        return {
          backgroundColor: 'var(--row-match-current-bg)',
          boxShadow: 'inset 3px 0 0 var(--accent)',
        } as RowStyle
      }
      if (matchIndexesRef.current.has(idx)) {
        return { backgroundColor: 'var(--row-match-bg)' } as RowStyle
      }
      return undefined
    },
    [],
  )

  const cellRenderer = useMemo(
    () => (params: ICellRendererParams) => {
      const text = formatValue(params.value)
      return <HighlightedText text={text} search={searchTextRef.current} />
    },
    [],
  )


  const rowIdColDef = useMemo<ColDef>(
    () => ({
      colId: ROW_ID_COL,
      field: ROW_ID_COL,
      headerName: '#',
      width: 72,
      pinned: 'left',
      sortable: false,
      resizable: false,
      suppressHeaderMenuButton: true,
      valueGetter: (p) => ((p.node?.rowIndex ?? -1) >= 0 ? p.node!.rowIndex! + 1 : ''),
      cellStyle: {
        textAlign: 'right',
        color: 'var(--fg-dim)',
        fontVariantNumeric: 'tabular-nums',
        cursor: 'pointer',
      },
      cellClass: (p) => {
        const r = p.node?.rowIndex
        if (r == null) return ''
        const rowSel = selectionRef.current.get(r)
        const cols = dataColIds()
        return rowSel && rowSel.size === cols.length ? 'mz-row-id mz-row-id-selected' : 'mz-row-id'
      },
    }),
    [],
  )

  const colDefs = useMemo<ColDef[]>(
    () =>
      [rowIdColDef].concat(schema
        .filter((c) => !hiddenCols.has(c.name))
        .map((c) => ({
          field: c.name,
          headerName: c.name,
          sortable: false,
          resizable: true,
          headerComponent: ColumnHeader,
          headerComponentParams: { colSchema: c, onAddFilter, onHideColumn, onToggleSort, sorts },
          suppressHeaderMenuButton: true,
          cellRenderer,
          cellStyle: isNumericType(c.type)
            ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
            : undefined,
          tooltipValueGetter: (p) => {
            const v = p.value
            if (v === null || v === undefined) return ''
            if (typeof v === 'object') {
              try { return JSON.stringify(v, null, 2) } catch { return String(v) }
            }
            return String(v)
          },
          cellClass: (p) => {
            const classes: string[] = []
            if (p.value === null || p.value === undefined) classes.push('cell-null')
            const q = searchTextRef.current
            if (q) {
              const text = formatValue(p.value)
              if (text.toLowerCase().includes(q.toLowerCase())) {
                classes.push('cell-has-match')
              }
            }
            const r = p.node?.rowIndex
            if (r != null) {
              const rowSel = selectionRef.current.get(r)
              if (rowSel?.has(p.column.getColId())) classes.push('cell-selected')
            }
            return classes.join(' ')
          },
        }))),
    [rowIdColDef, schema, hiddenCols, sorts, cellRenderer, onAddFilter, onHideColumn, onToggleSort],
  )

  const datasource = useMemo<IDatasource>(
    () => ({
      getRows: (params) => {
        const limit = params.endRow - params.startRow
        const queryId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        window.api
          .getPage({
            tableId: tableIdRef.current,
            offset: params.startRow,
            limit,
            sorts: sortsRef.current,
            filters: filtersRef.current,
            queryId,
          })
          .then((res) => {
            const lastRow = res.totalMatched
            params.successCallback(res.rows, lastRow)
            onTotalMatched(res.totalMatched)
          })
          .catch((err) => {
            console.error('getPage failed', err)
            params.failCallback()
          })
      },
    }),
    // datasource is stable; refs carry live state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const onGridReady = (e: GridReadyEvent) => {
    gridApiRef.current = e.api
  }

  const dataColIds = (): string[] => {
    const api = gridApiRef.current
    return (api?.getColumns()?.map((c) => c.getColId()) ?? []).filter((c) => c !== ROW_ID_COL)
  }

  const buildRectSelection = (
    r1: number,
    r2: number,
    c1: string,
    c2: string,
  ): Map<number, Set<string>> => {
    const cols = dataColIds()
    const i1 = cols.indexOf(c1)
    const i2 = cols.indexOf(c2)
    if (i1 < 0 || i2 < 0) return new Map([[r1, new Set([c1])]])
    const [rFrom, rTo] = r1 <= r2 ? [r1, r2] : [r2, r1]
    const [cFrom, cTo] = i1 <= i2 ? [i1, i2] : [i2, i1]
    const rangeCols = new Set(cols.slice(cFrom, cTo + 1))
    const next = new Map<number, Set<string>>()
    for (let r = rFrom; r <= rTo; r++) next.set(r, new Set(rangeCols))
    return next
  }

  const selectRow = (row: number): Map<number, Set<string>> =>
    new Map([[row, new Set(dataColIds())]])

  const onCellMouseDown = (e: CellMouseDownEvent) => {
    const col = e.colDef.field
    const row = e.rowIndex ?? -1
    if (!col || row < 0) return
    const native = e.event as MouseEvent | undefined
    if (native?.altKey) return // alt-click handled in onCellClicked (filter)

    const isRowIdCol = col === ROW_ID_COL

    // Shift+click: range from anchor (rows span [anchor.row, row]; cols span anchor.col..col)
    if (native?.shiftKey) {
      const a = anchorRef.current
      if (!a) {
        if (isRowIdCol) { setSelection(selectRow(row)); setAnchor({ row, col: dataColIds()[0] ?? col }) }
        else { setSelection(new Map([[row, new Set([col])]])); setAnchor({ row, col }) }
        return
      }
      if (isRowIdCol) {
        // Row-range spanning all columns
        const cols = dataColIds()
        const [rFrom, rTo] = a.row <= row ? [a.row, row] : [row, a.row]
        const next = new Map<number, Set<string>>()
        for (let r = rFrom; r <= rTo; r++) next.set(r, new Set(cols))
        setSelection(next)
      } else {
        setSelection(buildRectSelection(a.row, row, a.col, col))
      }
      return
    }

    // Cmd/Ctrl+click: toggle single cell (or whole row on the row-id column)
    if (native?.metaKey || native?.ctrlKey) {
      if (isRowIdCol) {
        const cols = dataColIds()
        setSelection((prev) => {
          const next = new Map(prev)
          const existing = next.get(row)
          if (existing && existing.size === cols.length) next.delete(row)
          else next.set(row, new Set(cols))
          return next
        })
        setAnchor({ row, col: cols[0] ?? col })
      } else {
        setSelection((prev) => {
          const next = new Map(prev)
          const rowSel = next.get(row)
          if (rowSel) {
            const newSet = new Set(rowSel)
            if (newSet.has(col)) newSet.delete(col)
            else newSet.add(col)
            if (newSet.size === 0) next.delete(row)
            else next.set(row, newSet)
          } else {
            next.set(row, new Set([col]))
          }
          return next
        })
        setAnchor({ row, col })
      }
      return
    }

    // Plain mousedown: start a drag; select the row (row-id col) or single cell
    if (isRowIdCol) {
      setSelection(selectRow(row))
      setAnchor({ row, col: dataColIds()[0] ?? col })
    } else {
      setSelection(new Map([[row, new Set([col])]]))
      setAnchor({ row, col })
      draggingRef.current = true
      lastDragCellRef.current = `${row}:${col}`
    }
  }

  const onCellMouseOver = (e: CellMouseOverEvent) => {
    if (!draggingRef.current) return
    const col = e.colDef.field
    const row = e.rowIndex ?? -1
    if (!col || row < 0 || col === ROW_ID_COL) return
    const key = `${row}:${col}`
    if (lastDragCellRef.current === key) return
    lastDragCellRef.current = key
    const a = anchorRef.current
    if (!a) return
    setSelection(buildRectSelection(a.row, row, a.col, col))
  }

  const onCellClicked = (e: CellClickedEvent) => {
    const col = e.colDef.field
    const row = e.rowIndex ?? -1
    if (!col || row < 0 || col === ROW_ID_COL) return
    onFocusCell(col, e.value, row)
    const native = e.event as MouseEvent | undefined
    if (!native?.altKey) return
    const v = e.value
    const notEq = native.shiftKey
    if (v === null || v === undefined) {
      onAddFilter({ col, op: notEq ? 'notNull' : 'isNull' })
    } else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      onAddFilter({ col, op: notEq ? 'neq' : 'eq', value: v })
    }
  }

  const onCellDoubleClicked = (e: CellDoubleClickedEvent) => {
    const col = e.colDef.field
    if (col) onFocusCell(col, e.value, e.rowIndex ?? -1)
    onOpenDetails()
  }

  return (
    <div
      className={`${theme === 'dark' ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'} grid-wrap`}
      style={{ width: '100%', height: '100%' }}
    >
      <AgGridReact
        theme="legacy"
        columnDefs={colDefs}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={PAGE_SIZE}
        cacheOverflowSize={2}
        maxBlocksInCache={10}
        infiniteInitialRowCount={PAGE_SIZE}
        rowBuffer={20}
        onGridReady={onGridReady}
        onCellClicked={onCellClicked}
        onCellDoubleClicked={onCellDoubleClicked}
        onCellMouseDown={onCellMouseDown}
        onCellMouseOver={onCellMouseOver}
        getRowStyle={getRowStyle}
        suppressFieldDotNotation
        suppressCellFocus={false}
        suppressRowClickSelection
        tooltipShowDelay={300}
      />
    </div>
  )
}
