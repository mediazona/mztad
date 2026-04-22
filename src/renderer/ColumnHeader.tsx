import { useRef, useState } from 'react'
import type { IHeaderParams } from 'ag-grid-community'
import type { ColumnSchema, Filter, Sort } from '@shared/types'
import { FilterPopover } from './FilterPopover.js'

export interface ColumnHeaderParams extends IHeaderParams {
  colSchema: ColumnSchema
  onAddFilter: (f: Filter) => void
  onHideColumn: (col: string) => void
  onToggleSort: (col: string, multi: boolean) => void
  sorts: Sort[]
}

function FunnelIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 2.5h13a.5.5 0 0 1 .4.8l-4.9 6.2v3.8a.5.5 0 0 1-.3.5l-3 1.2a.5.5 0 0 1-.7-.5V9.5L1.1 3.3a.5.5 0 0 1 .4-.8z"
        fill="currentColor"
      />
    </svg>
  )
}

export function ColumnHeader(props: ColumnHeaderParams) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const iconRef = useRef<HTMLButtonElement>(null)
  const colName = props.colSchema.name
  const currentSort = props.sorts.find((s) => s.col === colName)?.dir ?? null

  const onSortClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    props.onToggleSort(colName, e.shiftKey)
  }

  const onFilterClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!iconRef.current) return
    if (anchor) setAnchor(null)
    else setAnchor(iconRef.current.getBoundingClientRect())
  }

  const sortArrow = currentSort === 'asc' ? '▲' : currentSort === 'desc' ? '▼' : ''

  return (
    <div className="col-header">
      <span
        className="col-header-name"
        onClick={onSortClick}
        title={`${props.colSchema.name} : ${props.colSchema.type}`}
      >
        {props.displayName}
        {sortArrow && <span className="col-header-sort"> {sortArrow}</span>}
      </span>
      <button
        ref={iconRef}
        className="col-header-filter"
        onClick={onFilterClick}
        aria-label="Column menu"
        title="Column menu"
      >
        <FunnelIcon />
      </button>
      {anchor && (
        <FilterPopover
          anchor={anchor}
          colSchema={props.colSchema}
          onApply={(f) => { props.onAddFilter(f); setAnchor(null) }}
          onHide={() => { props.onHideColumn(props.colSchema.name); setAnchor(null) }}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  )
}
