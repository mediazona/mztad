import fs from 'node:fs'

// fs.watch's rename/replace semantics vary across OSes and handle atomic
// editor saves poorly (VS Code, pandas-to_parquet, etc. often rename-in).
// Polling via fs.watchFile is slower but reliable — 1.5s cadence is fine
// for "show a reload button when the file changed".
const POLL_INTERVAL_MS = 1500

type Handler = (curr: fs.Stats, prev: fs.Stats) => void

export class FileWatcher {
  private currentPath: string | null = null
  private handler: Handler | null = null

  constructor(private readonly notify: () => void) {}

  watch(filePath: string): void {
    this.stop()
    const handler: Handler = (curr, prev) => {
      // fs.watchFile fires an initial callback when the file first comes into
      // existence; treat that as a non-change (we captured the baseline by
      // calling watchFile against the known-good path).
      if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return
      this.notify()
    }
    this.currentPath = filePath
    this.handler = handler
    fs.watchFile(filePath, { interval: POLL_INTERVAL_MS, persistent: false }, handler)
  }

  stop(): void {
    if (this.currentPath && this.handler) {
      fs.unwatchFile(this.currentPath, this.handler)
    }
    this.currentPath = null
    this.handler = null
  }
}
