import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnSchema } from '@shared/types'
import { parseType, shortTypeLabel, type ParsedType } from './parseType.js'

interface Props {
  anchor: DOMRect
  schema: ColumnSchema[]
  hiddenCols: Set<string>
  onToggle: (col: string) => void
  onShowAll: () => void
  onClose: () => void
}

function StructTree({ fields, depth }: { fields: { name: string; type: ParsedType }[]; depth: number }) {
  return (
    <>
      {fields.map((f) => (
        <div key={f.name}>
          <div className="cm-subfield" style={{ paddingLeft: 28 + depth * 14 }}>
            <span className="cm-subname" title={f.name}>↳ {f.name}</span>
            <span className="cm-type">{shortTypeLabel(f.type)}</span>
          </div>
          {f.type.kind === 'struct' && (
            <StructTree fields={f.type.fields} depth={depth + 1} />
          )}
          {f.type.kind === 'list' && f.type.element.kind === 'struct' && (
            <StructTree fields={f.type.element.fields} depth={depth + 1} />
          )}
        </div>
      ))}
    </>
  )
}

export function ColumnsMenu({ anchor, schema, hiddenCols, onToggle, onShowAll, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return schema
    return schema.filter((c) => c.name.toLowerCase().includes(q))
  }, [query, schema])

  const W = 280
  const top = anchor.bottom + 4
  const left = Math.max(4, Math.min(anchor.left, window.innerWidth - W - 4))

  const hiddenCount = hiddenCols.size

  return createPortal(
    <div ref={ref} className="columns-menu" style={{ top, left, width: W }}>
      <div className="cm-header">
        <div className="cm-title">Columns</div>
        <div className="cm-count">
          {schema.length - hiddenCount} / {schema.length}
        </div>
      </div>
      <input
        className="cm-search"
        placeholder="filter…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="cm-list">
        {filtered.map((c) => {
          const visible = !hiddenCols.has(c.name)
          const parsed = parseType(c.type)
          const structFields =
            parsed.kind === 'struct' ? parsed.fields :
            parsed.kind === 'list' && parsed.element.kind === 'struct' ? parsed.element.fields :
            null
          const isExpanded = expanded.has(c.name)
          return (
            <div key={c.name} className="cm-group">
              <label className="cm-item">
                <input type="checkbox" checked={visible} onChange={() => onToggle(c.name)} />
                {structFields ? (
                  <button
                    type="button"
                    className="cm-expand"
                    onClick={(e) => {
                      e.preventDefault()
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (next.has(c.name)) next.delete(c.name)
                        else next.add(c.name)
                        return next
                      })
                    }}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="cm-expand-spacer" />
                )}
                <span className="cm-name" title={c.name}>{c.name}</span>
                <span className="cm-type" title={c.type}>{shortTypeLabel(parsed)}</span>
              </label>
              {structFields && isExpanded && <StructTree fields={structFields} depth={0} />}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="cm-empty">no matches</div>}
      </div>
      <div className="cm-footer">
        <button onClick={onShowAll} disabled={hiddenCount === 0}>Show all</button>
      </div>
    </div>,
    document.body,
  )
}
