import type { Filter } from '@shared/types'

function describeFilter(f: Filter): { op: string; value: string } {
  switch (f.op) {
    case 'eq': return { op: '=', value: String(f.value) }
    case 'neq': return { op: '≠', value: String(f.value) }
    case 'in': return { op: 'in', value: `(${f.values.length})` }
    case 'notIn': return { op: 'not in', value: `(${f.values.length})` }
    case 'gt': return { op: '>', value: String(f.value) }
    case 'gte': return { op: '≥', value: String(f.value) }
    case 'lt': return { op: '<', value: String(f.value) }
    case 'lte': return { op: '≤', value: String(f.value) }
    case 'range': return { op: 'between', value: `${f.min ?? '*'}…${f.max ?? '*'}` }
    case 'contains': return { op: 'contains', value: f.value }
    case 'notContains': return { op: "doesn't contain", value: f.value }
    case 'startsWith': return { op: 'starts', value: f.value }
    case 'endsWith': return { op: 'ends', value: f.value }
    case 'regex': return { op: '~', value: f.value }
    case 'notRegex': return { op: '!~', value: f.value }
    case 'isNull': return { op: 'is', value: 'null' }
    case 'notNull': return { op: 'is', value: 'not null' }
  }
}

interface Props {
  filters: Filter[]
  onRemove: (index: number) => void
  onClear: () => void
  onEdit?: (index: number, anchor: DOMRect) => void
}

// `in`/`notIn` filters have no popover UI today, so they're not editable.
function isEditable(f: Filter): boolean {
  return f.op !== 'in' && f.op !== 'notIn'
}

export function FilterChips({ filters, onRemove, onClear, onEdit }: Props) {
  if (filters.length === 0) return null
  return (
    <div className="chips">
      {filters.map((f, i) => {
        const { op, value } = describeFilter(f)
        const editable = onEdit != null && isEditable(f)
        const onChipClick = (e: React.MouseEvent<HTMLSpanElement>) => {
          if (!editable) return
          onEdit!(i, e.currentTarget.getBoundingClientRect())
        }
        // Stop the native mousedown before it reaches FilterPopover's document
        // listener — otherwise clicking a chip while a popover is already open
        // would close and immediately reopen it in a visible flicker.
        const onChipMouseDown = (e: React.MouseEvent<HTMLSpanElement>) => {
          if (!editable) return
          e.nativeEvent.stopImmediatePropagation()
        }
        return (
          <span
            key={i}
            className={`chip${editable ? ' chip-editable' : ''}`}
            title={editable ? `Edit filter — ${f.col} ${op} ${value}` : `${f.col} ${op} ${value}`}
            onMouseDown={onChipMouseDown}
            onClick={onChipClick}
          >
            <span className="col">{f.col}</span>
            <span className="op">{op}</span>
            <span>{value}</span>
            <button
              aria-label="Remove filter"
              onClick={(e) => { e.stopPropagation(); onRemove(i) }}
              onMouseDown={(e) => e.stopPropagation()}
            >×</button>
          </span>
        )
      })}
      <button className="chips-clear" onClick={onClear}>Clear all</button>
    </div>
  )
}
