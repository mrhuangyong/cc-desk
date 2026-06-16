import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { ClaudeService } from './claude-service'
import { PtyManager } from './pty-manager'
import { readDirTree, readFileContent } from './file-service'
import { getSettings, saveSettings } from './settings-store'

const isDev = !app.isPackaged

const claude = new ClaudeService()
const ptyManager = new PtyManager()

function createWindow() {
  const win = new BrowserWindow({
    width: 1680,
    height: 1040,
    minWidth: 960,
    minHeight: 640,
    frame: false, // 无系统边框，用自定义 titleBar
    // macOS: 用原生红绿灯但隐藏标题栏；hiddenInset 让红绿灯内嵌、留出空间给左侧内容
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    // 非 macOS 没有原生红绿灯，由自定义 titleBar 自绘窗口控制按钮（暂仅占位）
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 启用 <webview> 标签：浏览器 Tab 用它替代 iframe，以支持元素拾取（注入脚本到任意页面）
      webviewTag: true
    }
  })

  // 终端输出通过 webContents 推送到渲染进程
  ptyManager.setWebContents(win.webContents)

  // ---- IPC 通道注册 ----

  // Claude
  ipcMain.handle('claude:send', (_e, opts) => {
    return claude.send({ ...opts, webContents: win.webContents })
  })
  ipcMain.handle('claude:stop', () => {
    claude.abort()
  })

  // Settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial) => saveSettings(partial))

  // File System
  ipcMain.handle('fs:read-tree', async (_e, dirPath: string) => readDirTree(dirPath))
  ipcMain.handle('fs:read-file', async (_e, filePath: string) => readFileContent(filePath))

  // Terminal (pty)
  ipcMain.handle('pty:create', (_e, opts) => {
    return ptyManager.create(opts.tabId, opts.cols, opts.rows, opts.cwd)
  })
  ipcMain.handle('pty:input', (_e, opts) => {
    ptyManager.write(opts.tabId, opts.data)
  })
  ipcMain.handle('pty:resize', (_e, opts) => {
    ptyManager.resize(opts.tabId, opts.cols, opts.rows)
  })
  ipcMain.handle('pty:kill', (_e, tabId) => {
    ptyManager.kill(tabId)
  })

  // 开发态加载 dev server，生产态加载打包文件
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 外链用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  if (process.platform !== 'darwin') app.quit()
})
