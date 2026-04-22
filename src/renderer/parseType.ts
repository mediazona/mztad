export type ParsedType =
  | { kind: 'primitive'; name: string }
  | { kind: 'struct'; fields: StructField[] }
  | { kind: 'list'; element: ParsedType }
  | { kind: 'map'; key: ParsedType; value: ParsedType }

export interface StructField {
  name: string
  type: ParsedType
}

// Split on top-level commas, respecting nested parentheses
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let inQuote = false
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"') {
      if (s[i + 1] === '"') { i++; continue }
      inQuote = !inQuote
    } else if (!inQuote) {
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === ',' && depth === 0) {
        out.push(s.slice(start, i).trim())
        start = i + 1
      }
    }
  }
  out.push(s.slice(start).trim())
  return out.filter((p) => p.length > 0)
}

// "field name" TYPE  or  field TYPE
function splitNameType(s: string): { name: string; rest: string } {
  s = s.trim()
  if (s.startsWith('"')) {
    let i = 1
    while (i < s.length) {
      if (s[i] === '"' && s[i + 1] === '"') { i += 2; continue }
      if (s[i] === '"') break
      i++
    }
    const name = s.slice(1, i).replace(/""/g, '"')
    return { name, rest: s.slice(i + 1).trim() }
  }
  const space = s.search(/\s/)
  if (space === -1) return { name: s, rest: '' }
  return { name: s.slice(0, space), rest: s.slice(space + 1).trim() }
}

export function parseType(raw: string): ParsedType {
  const s = raw.trim()
  // Arrays: TYPE[] (may be nested: TYPE[][])
  if (s.endsWith('[]')) {
    return { kind: 'list', element: parseType(s.slice(0, -2)) }
  }
  const up = s.toUpperCase()
  if (up.startsWith('STRUCT(') && s.endsWith(')')) {
    const inner = s.slice(s.indexOf('(') + 1, -1)
    const fields = splitTopLevel(inner).map((part) => {
      const { name, rest } = splitNameType(part)
      return { name, type: parseType(rest) }
    })
    return { kind: 'struct', fields }
  }
  if (up.startsWith('MAP(') && s.endsWith(')')) {
    const inner = s.slice(s.indexOf('(') + 1, -1)
    const parts = splitTopLevel(inner)
    if (parts.length === 2) {
      return { kind: 'map', key: parseType(parts[0]!), value: parseType(parts[1]!) }
    }
  }
  if (up.startsWith('LIST(') && s.endsWith(')')) {
    const inner = s.slice(s.indexOf('(') + 1, -1)
    return { kind: 'list', element: parseType(inner) }
  }
  return { kind: 'primitive', name: s }
}

export function shortTypeLabel(t: ParsedType): string {
  switch (t.kind) {
    case 'primitive': return t.name
    case 'struct': return `STRUCT(${t.fields.length})`
    case 'list': return `${shortTypeLabel(t.element)}[]`
    case 'map': return 'MAP'
  }
}

export function shortTypeLabelFromString(raw: string): string {
  return shortTypeLabel(parseType(raw))
}
