import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ColumnSchema,
  FindMatchesRequest,
  FindMatchesResult,
  IpcApi,
  OpenFileResult,
  PageRequest,
  PageResult,
} from '@shared/types'

const api: IpcApi = {
  openFile: (filePath) => ipcRenderer.invoke('mztad:openFile', filePath) as Promise<OpenFileResult>,
  getPage: (req: PageRequest) => ipcRenderer.invoke('mztad:getPage', req) as Promise<PageResult>,
  cancel: (queryId) => ipcRenderer.invoke('mztad:cancel', queryId) as Promise<void>,
  runSql: (sql) =>
    ipcRenderer.invoke('mztad:runSql', sql) as Promise<{ columns: ColumnSchema[]; rows: Record<string, unknown>[] }>,
  runSqlAsView: (baseTableId, sql) =>
    ipcRenderer.invoke('mztad:runSqlAsView', baseTableId, sql) as Promise<OpenFileResult>,
  resetToBase: (baseTableId) =>
    ipcRenderer.invoke('mztad:resetToBase', baseTableId) as Promise<OpenFileResult>,
  closeTable: (tableId) => ipcRenderer.invoke('mztad:closeTable', tableId) as Promise<void>,
  findMatches: (req: FindMatchesRequest) =>
    ipcRenderer.invoke('mztad:findMatches', req) as Promise<FindMatchesResult>,
  getRecents: () => ipcRenderer.invoke('mztad:getRecents') as Promise<string[]>,
  clearRecents: () => ipcRenderer.invoke('mztad:clearRecents') as Promise<void>,
  onOpenFile: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: string) => cb(p)
    ipcRenderer.on('mztad:open-file', listener)
    return () => ipcRenderer.removeListener('mztad:open-file', listener)
  },
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return undefined
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
