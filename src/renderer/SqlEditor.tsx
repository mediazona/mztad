import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  initialSql: string
  isCustom: boolean
  onRun: (sql: string) => Promise<string | null> // returns error message or null
  onReset: () => void
  onClose: () => void
}

export function SqlEditor({ initialSql, isCustom, onRun, onReset, onClose }: Props) {
  const [sql, setSql] = useState(initialSql)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    taRef.current?.focus()
    taRef.current?.select()
  }, [])

  const run = async () => {
    setBusy(true)
    setError(null)
    const err = await onRun(sql)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run() }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sql-modal" onKeyDown={onKeyDown}>
        <div className="sql-modal-header">
          <div className="sql-modal-title">SQL</div>
          <button className="sql-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <textarea
          ref={taRef}
          className="sql-textarea"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          spellCheck={false}
        />
        {error && <div className="sql-error">{error}</div>}
        <div className="sql-modal-footer">
          <div className="sql-hint">⌘↵ Run · Esc close</div>
          <div className="sql-modal-spacer" />
          {isCustom && (
            <button onClick={onReset} className="sql-reset">Reset to file</button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button onClick={run} disabled={busy} className="sql-run">{busy ? 'Running…' : 'Run'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
