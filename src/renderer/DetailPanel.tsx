import { useEffect } from 'react'
import type { ColumnSchema } from '@shared/types'

export interface FocusedCell {
  col: string
  value: unknown
  rowIndex: number
}

interface Props {
  focusedCell: FocusedCell | null
  schema: ColumnSchema[]
  onClose: () => void
}

function formatValue(v: unknown): string {
  if (v === null) return 'NULL'
  if (v === undefined) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v, null, 2) } catch { return String(v) }
  }
  return String(v)
}

function isJsonish(v: unknown): boolean {
  return typeof v === 'object' && v !== null
}

export function DetailPanel({ focusedCell, schema, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const type = focusedCell ? schema.find((s) => s.name === focusedCell.col)?.type : undefined
  const text = focusedCell ? formatValue(focusedCell.value) : ''
  const jsonish = focusedCell ? isJsonish(focusedCell.value) : false
  const byteLen = text.length

  const copy = () => {
    if (!focusedCell) return
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="detail-panel">
      <div className="dp-header">
        {focusedCell ? (
          <>
            <span className="dp-col" title={focusedCell.col}>{focusedCell.col}</span>
            {type && <span className="dp-type">{type}</span>}
            <span className="dp-meta">
              row {focusedCell.rowIndex >= 0 ? focusedCell.rowIndex.toLocaleString() : '?'}
              {jsonish ? ' · json' : ''}
              {' · '}
              {byteLen.toLocaleString()} chars
            </span>
          </>
        ) : (
          <span className="dp-placeholder">Click a cell to inspect its value</span>
        )}
        <span className="dp-spacer" />
        {focusedCell && (
          <button className="dp-btn" onClick={copy} title="Copy formatted value">Copy</button>
        )}
        <button className="dp-close" onClick={onClose} aria-label="Close details">×</button>
      </div>
      {focusedCell && (
        <pre className={`dp-body ${jsonish ? 'dp-body-json' : ''}`}>{text}</pre>
      )}
    </div>
  )
}
