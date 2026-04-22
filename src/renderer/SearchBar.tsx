import { useEffect, useRef } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  onClose: () => void
  onNext: () => void
  onPrev: () => void
  matchCount: number
  matchPos: number
  truncated: boolean
  loading: boolean
}

export function SearchBar({
  value,
  onChange,
  onClose,
  onNext,
  onPrev,
  matchCount,
  matchPos,
  truncated,
  loading,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onPrev()
      else onNext()
    }
  }

  const countLabel = (() => {
    if (loading) return 'searching…'
    if (!value) return ''
    if (matchCount === 0) return 'no matches'
    return `${(matchPos + 1).toLocaleString()} / ${matchCount.toLocaleString()}${truncated ? '+' : ''}`
  })()

  const navDisabled = matchCount === 0

  return (
    <div className="searchbar">
      <span className="searchbar-label">Find</span>
      <input
        ref={inputRef}
        className="searchbar-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="search any column — ↵ next · ⇧↵ prev"
      />
      <span className="searchbar-count">{countLabel}</span>
      <button
        className="searchbar-nav"
        onClick={onPrev}
        disabled={navDisabled}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >↑</button>
      <button
        className="searchbar-nav"
        onClick={onNext}
        disabled={navDisabled}
        title="Next match (Enter)"
        aria-label="Next match"
      >↓</button>
      <button className="searchbar-close" onClick={onClose} aria-label="Close search">×</button>
    </div>
  )
}
