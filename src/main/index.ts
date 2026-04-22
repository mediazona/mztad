import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { DuckDBService } from './duckdb.js'
import { createTracker, registerIpc } from './ipc.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

app.setName('mzTad')

const db = new DuckDBService()
const tracker = createTracker()
const windowsByPath = new Map<string, BrowserWindow>()
const pendingFiles: string[] = [] // args/open-file events arriving before ready

function isOpenableFile(p: string): boolean {
  if (!p) return false
  try {
    const stat = fs.statSync(p)
    if (!stat.isFile()) return false
  } catch {
    return false
  }
  return /\.(parquet|pq|csv|tsv|json|ndjson|jsonl)$/i.test(p)
}

function parseCliArgs(argv: string[]): string[] {
  // Skip electron executable and our own script path; keep file-like args.
  return argv.slice(1).filter((a) => !a.startsWith('-') && isOpenableFile(a))
}

function createWindowForFile(filePath: string): BrowserWindow {
  const resolved = path.resolve(filePath)
  const existing = windowsByPath.get(resolved)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    title: path.basename(resolved),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  })

  windowsByPath.set(resolved, win)
  const wcId = win.webContents.id
  win.on('closed', () => {
    windowsByPath.delete(resolved)
    const leftover = tracker.takeAll(wcId)
    for (const id of leftover) void db.closeTable(id)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('mztad:open-file', resolved)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

function createEmptyWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    title: 'mzTad',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  })
  const wcId = win.webContents.id
  win.on('closed', () => {
    const leftover = tracker.takeAll(wcId)
    for (const id of leftover) void db.closeTable(id)
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return win
}

function openPathInFocusedOrNew(filePath: string): BrowserWindow {
  const resolved = path.resolve(filePath)
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && !tracker.has(focused.webContents.id)) {
    focused.webContents.send('mztad:open-file', resolved)
    return focused
  }
  return createWindowForFile(resolved)
}

async function openViaDialog(): Promise<void> {
  const res = await dialog.showOpenDialog({
    title: 'mzTad — Open data file',
    properties: ['openFile'],
    filters: [
      { name: 'Data files', extensions: ['parquet', 'pq', 'csv', 'tsv', 'json', 'ndjson', 'jsonl'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (res.canceled || res.filePaths.length === 0) return
  for (const p of res.filePaths) openPathInFocusedOrNew(p)
}

async function showAboutDialog(): Promise<void> {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'About mzTad',
    message: 'mzTad',
    detail: `Version ${app.getVersion()}\n\nMade by Mediazona\nzona.media`,
    buttons: ['Visit zona.media', 'Donate', 'Close'],
    defaultId: 0,
    cancelId: 2,
  })
  if (result.response === 0) await shell.openExternal('https://zona.media')
  if (result.response === 1) await shell.openExternal('https://donate.zona.media')
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{
          label: app.name,
          submenu: [
            { label: 'About mzTad', click: () => void showAboutDialog() },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => void openViaDialog() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// macOS: Finder double-click / dock drop
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) openPathInFocusedOrNew(filePath)
  else pendingFiles.push(filePath)
})

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: 'mzTad',
    applicationVersion: app.getVersion(),
    copyright: 'Made by Mediazona — zona.media',
    website: 'https://zona.media',
  })
  await db.init()
  registerIpc(db, tracker)
  buildMenu()

  const cliFiles = parseCliArgs(process.argv)
  const toOpen = [...cliFiles, ...pendingFiles]
  if (toOpen.length === 0) {
    createEmptyWindow()
  } else {
    for (const p of toOpen) createWindowForFile(p)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createEmptyWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', async () => {
  await db.close()
})
