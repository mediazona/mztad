import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ColumnSchema, Filter } from '@shared/types'

type Op =
  | 'eq' | 'neq'
  | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
  | 'regex' | 'notRegex'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'isNull' | 'notNull'

function isNumericType(t: string): boolean {
  const up = t.toUpperCase()
  return (
    up.includes('INT') ||
    up === 'FLOAT' || up === 'DOUBLE' || up === 'REAL' ||
    up.startsWith('DECIMAL') || up.startsWith('NUMERIC') ||
    up === 'HUGEINT'
  )
}

function isDateType(t: string): boolean {
  const up = t.toUpperCase()
  return up === 'DATE' || up.includes('TIME')
}

function opsForType(type: string): Op[] {
  const up = type.toUpperCase()
  if (up === 'BOOLEAN') return ['eq', 'neq', 'isNull', 'notNull']
  if (isNumericType(type) || isDateType(type)) {
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'notNull']
  }
  return ['eq', 'neq', 'contains', 'notContains', 'startsWith', 'endsWith', 'regex', 'notRegex', 'isNull', 'notNull']
}

const OP_LABEL: Record<Op, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  notContains: "doesn't contain",
  startsWith: 'starts with',
  endsWith: 'ends with',
  regex: 'matches regex',
  notRegex: "doesn't match regex",
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  isNull: 'is null',
  notNull: 'is not null',
}

function coerce(value: string, numeric: boolean): string | number {
  if (!numeric) return value
  const trimmed = value.trim()
  if (trimmed === '') return value
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : value
}

interface Props {
  anchor: DOMRect
  colSchema: ColumnSchema
  initial?: Filter
  onApply: (f: Filter) => void
  onHide: () => void
  onClose: () => void
}

type InitialState = { op: Op; value: string; value2: string; caseSensitive: boolean }

// Reverse of the apply() switch: map an existing Filter back into popover
// state so clicking a chip reopens it with the same values prefilled.
function stateFromFilter(f: Filter, fallback: Op): InitialState {
  const s: InitialState = { op: fallback, value: '', value2: '', caseSensitive: false }
  switch (f.op) {
    case 'eq':
    case 'neq':
      s.op = f.op
      s.value = f.value == null ? '' : String(f.value)
      break
    case 'contains':
    case 'notContains':
    case 'startsWith':
    case 'endsWith':
    case 'regex':
    case 'notRegex':
      s.op = f.op
      s.value = f.value
      s.caseSensitive = !!f.caseSensitive
      break
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      s.op = f.op
      s.value = String(f.value)
      break
    case 'range':
      s.op = 'between'
      s.value = f.min == null ? '' : String(f.min)
      s.value2 = f.max == null ? '' : String(f.max)
      break
    case 'isNull':
    case 'notNull':
      s.op = f.op
      break
    case 'in':
    case 'notIn':
      // Shouldn't land here — chips guard editing these — but fall back safely.
      break
  }
  return s
}

export function FilterPopover({ anchor, colSchema, initial, onApply, onHide, onClose }: Props) {
  const ops = opsForType(colSchema.type)
  const seed = initial ? stateFromFilter(initial, ops[0]!) : null
  const [op, setOp] = useState<Op>(seed?.op ?? ops[0]!)
  const [value, setValue] = useState(seed?.value ?? '')
  const [value2, setValue2] = useState(seed?.value2 ?? '')
  const [caseSensitive, setCaseSensitive] = useState(seed?.caseSensitive ?? false)
  const popRef = useRef<HTMLDivElement>(null)
  const numeric = isNumericType(colSchema.type)
  const isEditing = initial != null

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose()
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  const needsValue = op !== 'isNull' && op !== 'notNull'
  const needsTwoValues = op === 'between'
  const isRegex = op === 'regex' || op === 'notRegex'
  const isStringLike =
    op === 'contains' || op === 'notContains' || op === 'startsWith' || op === 'endsWith' || isRegex

  const apply = () => {
    const col = colSchema.name
    let filter: Filter | null = null
    switch (op) {
      case 'eq':
      case 'neq': {
        const v: string | number | boolean | null =
          value === '' ? null : coerce(value, numeric)
        filter = { col, op, value: v }
        break
      }
      case 'contains':
      case 'notContains':
      case 'startsWith':
      case 'endsWith':
      case 'regex':
      case 'notRegex':
        if (value === '') return
        filter = { col, op, value, caseSensitive }
        break
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        if (value === '') return
        filter = { col, op, value: coerce(value, numeric) }
        break
      case 'between':
        filter = {
          col,
          op: 'range',
          min: value === '' ? undefined : coerce(value, numeric),
          max: value2 === '' ? undefined : coerce(value2, numeric),
        }
        break
      case 'isNull':
      case 'notNull':
        filter = { col, op }
        break
    }
    if (filter) onApply(filter)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); apply() }
  }

  const POP_W = 260
  const top = anchor.bottom + 4
  const left = Math.max(4, Math.min(anchor.left, window.innerWidth - POP_W - 4))

  return createPortal(
    <div
      ref={popRef}
      className="filter-popover"
      style={{ top, left, width: POP_W }}
      onKeyDown={onKeyDown}
    >
      <div className="fp-header">
        <div className="fp-col" title={colSchema.name}>{colSchema.name}</div>
        <div className="fp-type">{colSchema.type}</div>
      </div>
      <select className="fp-op" value={op} onChange={(e) => setOp(e.target.value as Op)}>
        {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
      </select>
      {needsValue && (
        <input
          autoFocus
          className="fp-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={needsTwoValues ? 'min' : isRegex ? 'pattern (e.g. ^foo.*bar$)' : 'value'}
          spellCheck={isRegex ? false : undefined}
        />
      )}
      {needsTwoValues && (
        <input
          className="fp-value"
          value={value2}
          onChange={(e) => setValue2(e.target.value)}
          placeholder="max"
        />
      )}
      {isStringLike && (
        <label className="fp-case">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          case-sensitive
        </label>
      )}
      <div className="fp-actions">
        <button onClick={onHide} className="fp-hide">Hide column</button>
        <div className="fp-actions-spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="fp-apply" onClick={apply}>{isEditing ? 'Update' : 'Apply'}</button>
      </div>
    </div>,
    document.body,
  )
}
