import { app, ipcMain, webContents } from 'electron'
import type { FindMatchesRequest, PageRequest } from '@shared/types'
import { DuckDBService } from './duckdb.js'
import { FileWatcher } from './fileWatcher.js'
import { Recents } from './recents.js'

const watchers = new Map<number, FileWatcher>()

export function disposeWatcherForWebContents(wcId: number): void {
  const w = watchers.get(wcId)
  if (!w) return
  w.stop()
  watchers.delete(wcId)
}

export interface WindowTableTracker {
  add(wcId: number, tableId: string): void
  remove(wcId: number, tableId: string): void
  takeAll(wcId: number): string[]
  has(wcId: number): boolean
}

export function createTracker(): WindowTableTracker {
  const map = new Map<number, Set<string>>()
  return {
    add(wcId, tableId) {
      let set = map.get(wcId)
      if (!set) { set = new Set(); map.set(wcId, set) }
      set.add(tableId)
    },
    remove(wcId, tableId) {
      const set = map.get(wcId)
      if (!set) return
      set.delete(tableId)
      if (set.size === 0) map.delete(wcId)
    },
    takeAll(wcId) {
      const set = map.get(wcId)
      if (!set) return []
      map.delete(wcId)
      return Array.from(set)
    },
    has(wcId) {
      const set = map.get(wcId)
      return !!(set && set.size > 0)
    },
  }
}

export function registerIpc(
  db: DuckDBService,
  tracker: WindowTableTracker,
  recents: Recents,
): void {
  ipcMain.handle('mztad:openFile', async (e, filePath: string) => {
    const result = await db.openFile(filePath)
    const wcId = e.sender.id
    tracker.add(wcId, result.tableId)
    recents.add(filePath)
    try { app.addRecentDocument(filePath) } catch { /* not supported on this platform/OS */ }

    // (Re)watch the file so we can prompt the user to reload when it changes.
    let watcher = watchers.get(wcId)
    if (!watcher) {
      watcher = new FileWatcher(() => {
        const wc = webContents.fromId(wcId)
        if (wc && !wc.isDestroyed()) wc.send('mztad:file-changed')
      })
      watchers.set(wcId, watcher)
    }
    watcher.watch(filePath)
    return result
  })
  ipcMain.handle('mztad:getPage', async (_e, req: PageRequest) => db.getPage(req))
  ipcMain.handle('mztad:cancel', async (_e, queryId: string) => db.cancel(queryId))
  ipcMain.handle('mztad:runSql', async (_e, sql: string) => db.runSql(sql))
  ipcMain.handle('mztad:runSqlAsView', async (e, baseTableId: string, sql: string) => {
    const result = await db.runSqlAsView(baseTableId, sql)
    tracker.add(e.sender.id, result.tableId)
    return result
  })
  ipcMain.handle('mztad:resetToBase', async (_e, baseTableId: string) => db.resetToBase(baseTableId))
  ipcMain.handle('mztad:closeTable', async (e, tableId: string) => {
    await db.closeTable(tableId)
    tracker.remove(e.sender.id, tableId)
  })
  ipcMain.handle('mztad:findMatches', async (_e, req: FindMatchesRequest) => db.findMatches(req))
  ipcMain.handle('mztad:getRecents', () => recents.list())
  ipcMain.handle('mztad:clearRecents', () => {
    recents.clear()
    try { app.clearRecentDocuments() } catch { /* not supported */ }
  })
}
