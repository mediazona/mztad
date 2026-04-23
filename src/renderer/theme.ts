import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'mztad-theme'

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch { /* storage unavailable */ }
  return 'auto'
}

function systemPrefersDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return true }
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === 'auto') return systemPrefersDark() ? 'dark' : 'light'
  return theme
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
}

// Run synchronously at app start, before React renders, so CSS vars are correct on first paint.
export function applyStoredTheme(): void {
  apply(resolve(readStored()))
}

export interface ThemeState {
  theme: Theme
  resolved: ResolvedTheme
  cycle: () => void
  set: (t: Theme) => void
}

export function useTheme(): ThemeState {
  const [theme, setTheme] = useState<Theme>(readStored)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(theme))

  useEffect(() => {
    try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
    const r = resolve(theme)
    setResolved(r)
    apply(r)
  }, [theme])

  useEffect(() => {
    if (theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const r: ResolvedTheme = mq.matches ? 'dark' : 'light'
      setResolved(r)
      apply(r)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const cycle = () => setTheme((t) => (t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto'))

  return { theme, resolved, cycle, set: setTheme }
}
