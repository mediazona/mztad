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
    case 'isNull': return { op: 'is', value: 'null' }
    case 'notNull': return { op: 'is', value: 'not null' }
  }
}

interface Props {
  filters: Filter[]
  onRemove: (index: number) => void
  onClear: () => void
}

export function FilterChips({ filters, onRemove, onClear }: Props) {
  if (filters.length === 0) return null
  return (
    <div className="chips">
      {filters.map((f, i) => {
        const { op, value } = describeFilter(f)
        return (
          <span key={i} className="chip" title={`${f.col} ${op} ${value}`}>
            <span className="col">{f.col}</span>
            <span className="op">{op}</span>
            <span>{value}</span>
            <button aria-label="Remove filter" onClick={() => onRemove(i)}>×</button>
          </span>
        )
      })}
      <button className="chips-clear" onClick={onClear}>Clear all</button>
    </div>
  )
}
