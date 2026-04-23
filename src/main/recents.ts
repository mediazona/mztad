import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MAX = 20

export class Recents {
  private items: string[] = []
  private listeners = new Set<() => void>()

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { paths?: unknown }
      if (Array.isArray(raw.paths)) {
        this.items = raw.paths.filter((p): p is string => typeof p === 'string').slice(0, MAX)
      }
    } catch { /* corrupt file — start fresh */ }
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ paths: this.items }, null, 2))
    } catch { /* disk full / readonly — just drop the update */ }
  }

  list(): string[] {
    return [...this.items]
  }

  add(p: string): void {
    const resolved = path.resolve(p)
    const next = [resolved, ...this.items.filter((x) => x !== resolved)].slice(0, MAX)
    if (next.length === this.items.length && next.every((v, i) => v === this.items[i])) return
    this.items = next
    this.save()
    this.emit()
  }

  remove(p: string): void {
    const resolved = path.resolve(p)
    const before = this.items.length
    this.items = this.items.filter((x) => x !== resolved)
    if (this.items.length !== before) {
      this.save()
      this.emit()
    }
  }

  clear(): void {
    if (this.items.length === 0) return
    this.items = []
    this.save()
    this.emit()
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}
