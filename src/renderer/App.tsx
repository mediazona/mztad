import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import type { FindMatchesResult, Filter, OpenFileResult, Sort } from '@shared/types'
import { formatPageSql, quoteIdent } from '@shared/sqlBuilder'
import { FilterChips } from './FilterChips.js'
import { Table } from './Table.js'
import { SearchBar } from './SearchBar.js'
import { ColumnsMenu } from './ColumnsMenu.js'
import { SqlEditor } from './SqlEditor.js'
import { DetailPanel, type FocusedCell } from './DetailPanel.js'
import { K } from './keys.js'
import { useTheme } from './theme.js'

export default function App() {
  const [baseInfo, setBaseInfo] = useState<OpenFileResult | null>(null)
  const [activeInfo, setActiveInfo] = useState<OpenFileResult | null>(null)
  const [filters, setFilters] = useState<Filter[]>([])
  const [sorts, setSorts] = useState<Sort[]>([])
  const [rawSearch, setRawSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocusTrigger, setSearchFocusTrigger] = useState(0)
  const [matches, setMatches] = useState<FindMatchesResult>({ indexes: [], truncated: false })
  const [matchPos, setMatchPos] = useState(0)
  const [searchLoading, setSearchLoading] = useState(false)
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [totalMatched, setTotalMatched] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ title: string; subtitle?: string } | null>(null)
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState<DOMRect | null>(null)
  const [sqlEditorOpen, setSqlEditorOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [focusedCell, setFocusedCell] = useState<FocusedCell | null>(null)
  const dragDepth = useRef(0)
  const columnsBtnRef = useRef<HTMLButtonElement>(null)
  const { theme, resolved: resolvedTheme, cycle: cycleTheme } = useTheme()
  const [recents, setRecents] = useState<string[]>([])

  // Fetch recents while there's no file open (i.e., while the empty state is showing).
  useEffect(() => {
    if (activeInfo) return
    let cancelled = false
    window.api.getRecents().then((list) => { if (!cancelled) setRecents(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [activeInfo])

  const clearRecents = useCallback(async () => {
    await window.api.clearRecents()
    setRecents([])
  }, [])

  const isCustom = !!(baseInfo && activeInfo && baseInfo.tableId !== activeInfo.tableId)

  // Debounce Cmd+F search (200ms) — avoids hammering DuckDB on every keystroke
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(rawSearch), 200)
    return () => clearTimeout(handle)
  }, [rawSearch])

  // Fetch match indexes whenever the search, filters, sort, or table changes
  useEffect(() => {
    if (!activeInfo) return
    if (!debouncedSearch.trim()) {
      setMatches({ indexes: [], truncated: false })
      setMatchPos(0)
      setSearchLoading(false)
      return
    }
    let cancelled = false
    setSearchLoading(true)
    window.api
      .findMatches({
        tableId: activeInfo.tableId,
        filters,
        sorts,
        searchText: debouncedSearch,
      })
      .then((res) => {
        if (cancelled) return
        setMatches(res)
        setMatchPos(0)
        setSearchLoading(false)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setSearchLoading(false)
        setMatches({ indexes: [], truncated: false })
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Search failed: ${msg}`)
        console.error('findMatches failed', e)
      })
    return () => { cancelled = true }
  }, [activeInfo?.tableId, filters, sorts, debouncedSearch])

  const goNext = useCallback(() => {
    setMatchPos((p) => {
      const n = matches.indexes.length
      if (n === 0) return 0
      return (p + 1) % n
    })
  }, [matches.indexes.length])
  const goPrev = useCallback(() => {
    setMatchPos((p) => {
      const n = matches.indexes.length
      if (n === 0) return 0
      return (p - 1 + n) % n
    })
  }, [matches.indexes.length])

  const openPath = useCallback(async (filePath: string) => {
    setError(null)
    const basename = filePath.split('/').pop() ?? filePath
    setBusy({ title: `Opening ${basename}`, subtitle: 'scanning schema & row count…' })
    const oldIds = new Set<string>()
    if (baseInfo) oldIds.add(baseInfo.tableId)
    if (activeInfo) oldIds.add(activeInfo.tableId)
    try {
      const info = await window.api.openFile(filePath)
      setBaseInfo(info)
      setActiveInfo(info)
      setFilters([])
      setSorts([])
      setRawSearch('')
      setDebouncedSearch('')
      setSearchOpen(false)
      setHiddenCols(new Set())
      setTotalMatched(info.rowCount)
      oldIds.delete(info.tableId)
      for (const id of oldIds) void window.api.closeTable(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [baseInfo, activeInfo])

  useEffect(() => {
    const off = window.api.onOpenFile((p) => void openPath(p))
    return off
  }, [openPath])

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current++
      if (dragDepth.current === 1) setDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragOver(false)
    }
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      const f = e.dataTransfer?.files?.[0]
      if (!f) return
      const p = window.api.pathForFile(f)
      if (p) void openPath(p)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openPath])

  // Cmd/Ctrl+F opens (or re-focuses) the search bar and selects its current text
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        if (!activeInfo) return
        e.preventDefault()
        setSearchOpen(true)
        setSearchFocusTrigger((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeInfo])

  const addFilter = useCallback((f: Filter) => {
    setFilters((prev) => [...prev, f])
  }, [])
  const toggleSort = useCallback((col: string, multi: boolean) => {
    setSorts((prev) => {
      const existing = prev.find((s) => s.col === col)
      const nextDir: 'asc' | 'desc' | null =
        !existing ? 'asc' :
        existing.dir === 'asc' ? 'desc' :
        null
      if (multi) {
        const others = prev.filter((s) => s.col !== col)
        return nextDir ? [...others, { col, dir: nextDir }] : others
      }
      return nextDir ? [{ col, dir: nextDir }] : []
    })
  }, [])
  const removeFilter = useCallback((i: number) => {
    setFilters((prev) => prev.filter((_, idx) => idx !== i))
  }, [])
  const clearFilters = useCallback(() => setFilters([]), [])

  const hideColumn = useCallback((col: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev)
      next.add(col)
      return next
    })
  }, [])
  const toggleColumn = useCallback((col: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }, [])
  const showAllColumns = useCallback(() => setHiddenCols(new Set()), [])

  const closeSearch = useCallback(() => {
    // Only hide the bar — preserve rawSearch/debouncedSearch so Cmd+F reopens
    // with the previous query pre-selected and matches still navigable.
    setSearchOpen(false)
  }, [])

  const onFocusCell = useCallback((col: string, value: unknown, rowIndex: number) => {
    setFocusedCell({ col, value, rowIndex })
  }, [])
  const openDetails = useCallback(() => setDetailsOpen(true), [])
  const closeDetails = useCallback(() => setDetailsOpen(false), [])

  const onColumnsClick = () => {
    if (!columnsBtnRef.current) return
    if (columnsMenuAnchor) setColumnsMenuAnchor(null)
    else setColumnsMenuAnchor(columnsBtnRef.current.getBoundingClientRect())
  }

  const currentSqlPreview = useMemo(() => {
    if (!activeInfo) return ''
    return formatPageSql(
      quoteIdent(activeInfo.tableId),
      filters,
      sorts,
      activeInfo.schema,
    )
  }, [activeInfo, filters, sorts])

  const matchSet = useMemo(() => new Set(matches.indexes), [matches.indexes])
  const currentMatchRowIndex =
    matches.indexes.length > 0 ? matches.indexes[matchPos] ?? null : null

  const runCustomSql = useCallback(async (sql: string): Promise<string | null> => {
    if (!baseInfo) return 'No file open'
    setBusy({ title: 'Running SQL', subtitle: 'building view & counting rows…' })
    const priorCustomId =
      activeInfo && activeInfo.tableId !== baseInfo.tableId ? activeInfo.tableId : null
    try {
      const info = await window.api.runSqlAsView(baseInfo.tableId, sql)
      setActiveInfo(info)
      setFilters([])
      setSorts([])
      setRawSearch('')
      setDebouncedSearch('')
      setHiddenCols(new Set())
      setTotalMatched(info.rowCount)
      if (priorCustomId && priorCustomId !== info.tableId) {
        void window.api.closeTable(priorCustomId)
      }
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    } finally {
      setBusy(null)
    }
  }, [baseInfo, activeInfo])

  const resetToBase = useCallback(async () => {
    if (!baseInfo) return
    const priorCustomId =
      activeInfo && activeInfo.tableId !== baseInfo.tableId ? activeInfo.tableId : null
    try {
      const info = await window.api.resetToBase(baseInfo.tableId)
      setActiveInfo(info)
      setFilters([])
      setSorts([])
      setRawSearch('')
      setDebouncedSearch('')
      setHiddenCols(new Set())
      setTotalMatched(info.rowCount)
      setSqlEditorOpen(false)
      if (priorCustomId) void window.api.closeTable(priorCustomId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [baseInfo, activeInfo])

  if (!activeInfo || !baseInfo) {
    return (
      <div className="app">
        <div className={`empty-state ${dragOver ? 'drag-over' : ''}`}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>mzTad</div>
          <div>Drop a Parquet, CSV, TSV, or JSON file here</div>
          <div style={{ fontSize: 11 }}>— or use File → Open… ({K.combo(K.mod, 'O')}) —</div>
          {error && <div style={{ color: '#ff6b6b', marginTop: 8 }}>{error}</div>}
          {recents.length > 0 && (
            <div className="recents">
              <div className="recents-header">
                <span>Recent</span>
                <button className="recents-clear" onClick={() => void clearRecents()}>Clear</button>
              </div>
              <ul className="recents-list">
                {recents.slice(0, 10).map((p) => {
                  const sep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
                  const name = sep >= 0 ? p.slice(sep + 1) : p
                  const dir = sep >= 0 ? p.slice(0, sep) : ''
                  return (
                    <li key={p}>
                      <button
                        className="recents-item"
                        onClick={() => void openPath(p)}
                        title={p}
                      >
                        <span className="recents-name">{name}</span>
                        <span className="recents-dir">{dir}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
        {busy && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div className="loading-text">{busy.title}</div>
            {busy.subtitle && <div className="loading-sub">{busy.subtitle}</div>}
          </div>
        )}
      </div>
    )
  }

  const shownCount = totalMatched ?? activeInfo.rowCount
  const visibleCols = activeInfo.schema.length - hiddenCols.size

  return (
    <div className="app">
      <div className="toolbar">
        <div className="file" title={baseInfo.path}>
          {baseInfo.path.split('/').pop()}
          {isCustom && <span className="custom-badge">custom SQL</span>}
        </div>
        <div className="stats">
          {shownCount.toLocaleString()}
          {filters.length > 0 && ` / ${activeInfo.rowCount.toLocaleString()}`} rows
          {' · '}
          {visibleCols}{hiddenCols.size > 0 && `/${activeInfo.schema.length}`} cols
          {' · '}
          {activeInfo.kind}
        </div>
        <div className="spacer" />
        {isCustom && (
          <button className="tb-btn" onClick={() => void resetToBase()}>Reset to file</button>
        )}
        <button ref={columnsBtnRef} className="tb-btn" onClick={onColumnsClick}>
          Columns{hiddenCols.size > 0 && ` (${hiddenCols.size} hidden)`}
        </button>
        <button
          className={`tb-btn${detailsOpen ? ' tb-btn-active' : ''}`}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          Details
        </button>
        <button className="tb-btn" onClick={() => setSqlEditorOpen(true)}>SQL</button>
        <button
          className="tb-btn"
          onClick={cycleTheme}
          title={`Theme: ${theme} (click to cycle)`}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀' : '◐'}
        </button>
        {error && <div className="tb-error">{error}</div>}
      </div>
      {searchOpen && (
        <SearchBar
          value={rawSearch}
          onChange={setRawSearch}
          onClose={closeSearch}
          onNext={goNext}
          onPrev={goPrev}
          matchCount={matches.indexes.length}
          matchPos={matchPos}
          truncated={matches.truncated}
          loading={searchLoading}
          focusTrigger={searchFocusTrigger}
        />
      )}
      <FilterChips filters={filters} onRemove={removeFilter} onClear={clearFilters} />
      <Table
        tableId={activeInfo.tableId}
        schema={activeInfo.schema}
        filters={filters}
        sorts={sorts}
        hiddenCols={hiddenCols}
        matchIndexes={matchSet}
        currentMatchIndex={currentMatchRowIndex}
        searchText={debouncedSearch}
        theme={resolvedTheme}
        onAddFilter={addFilter}
        onToggleSort={toggleSort}
        onTotalMatched={setTotalMatched}
        onHideColumn={hideColumn}
        onFocusCell={onFocusCell}
        onOpenDetails={openDetails}
      />
      {detailsOpen && (
        <DetailPanel
          focusedCell={focusedCell}
          schema={activeInfo.schema}
          onClose={closeDetails}
        />
      )}
      <div className="hint">
        Click cell · Drag to select · {K.combo(K.shift, 'click')} range · {K.combo(K.mod, 'click')} toggle cell · # column for row · {K.combo(K.mod, 'C')} copy · {K.combo(K.mod, K.alt, 'C')} copy + headers · {K.combo(K.alt, 'click')} filter · {K.combo(K.mod, 'F')} find · Dbl-click details
      </div>
      {columnsMenuAnchor && (
        <ColumnsMenu
          anchor={columnsMenuAnchor}
          schema={activeInfo.schema}
          hiddenCols={hiddenCols}
          onToggle={toggleColumn}
          onShowAll={showAllColumns}
          onClose={() => setColumnsMenuAnchor(null)}
        />
      )}
      {sqlEditorOpen && (
        <SqlEditor
          initialSql={currentSqlPreview}
          isCustom={isCustom}
          onRun={runCustomSql}
          onReset={() => void resetToBase()}
          onClose={() => setSqlEditorOpen(false)}
        />
      )}
      {busy && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div className="loading-text">{busy.title}</div>
          {busy.subtitle && <div className="loading-sub">{busy.subtitle}</div>}
        </div>
      )}
    </div>
  )
}
