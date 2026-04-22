import { ipcMain } from 'electron'
import type { FindMatchesRequest, PageRequest } from '@shared/types'
import { DuckDBService } from './duckdb.js'

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

export function registerIpc(db: DuckDBService, tracker: WindowTableTracker): void {
  ipcMain.handle('mztad:openFile', async (e, filePath: string) => {
    const result = await db.openFile(filePath)
    tracker.add(e.sender.id, result.tableId)
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
}
