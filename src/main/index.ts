import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { ClaudeService } from './claude-service'
import { SessionQueryManager } from './session-query-manager'
import { PtyManager } from './pty-manager'
import { readDirTree, readFileContent, searchFiles, writeFileContent, pathExists } from './file-service'
import { getSettings, saveSettings } from './settings-store'
import { getModelProvidersConfig, saveModelProvidersConfig } from './cc-desk-store'
import { getProjectsSnapshot, saveProjectsSnapshot } from './projects-store'
import * as cc from './claude-config'
import { getMemoryFile, saveMemoryFile } from './memory-file'
import { BackendTaskRegistry } from './backend-task-registry'
import { ensureClaudeConfigDir } from './paths'
import { migrateFromClaude } from './migrate-from-claude'

// 启动第一件事：把 Claude Agent SDK / CLI 的配置目录隔离到 ~/.cc-desk/claude，
// 使运行时不再读取 ~/.claude/settings.json（其 env 块会覆盖 cc-desk 注入的角色模型映射，
// 导致 haiku 等后台子任务被 ~/.claude 的模型配置劫持）。必须在任何 query() 之前完成。
ensureClaudeConfigDir()
// 首次启动时把 ~/.claude 的插件/技能/设置一次性迁移到隔离目录（幂等，已迁移则跳过）。
// 让设置页与 SDK 运行时在隔离目录也能看到原有插件，cc-desk 完全自洽不再依赖 ~/.claude。
void migrateFromClaude()

const isDev = !app.isPackaged

// 应用图标：out/main → 项目根 ../../build/icons/。dev 与 build 均输出到 out/，路径一致。
const iconPath = join(__dirname, '../../build/icons/icon.png')

const claude = new ClaudeService()
const backendTaskRegistry = new BackendTaskRegistry()
claude.setRegistry(backendTaskRegistry)
const sessionQueryManager = new SessionQueryManager()
claude.setManager(sessionQueryManager)
const ptyManager = new PtyManager()

function createWindow() {
  const win = new BrowserWindow({
    width: 1680,
    height: 1040,
    minWidth: 960,
    minHeight: 640,
    icon: iconPath,  // 窗口/dock 图标（替换 Electron 默认图标）
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
  ipcMain.handle('claude:stop', async (_e, localSessionId: string) => {
    await claude.interrupt(localSessionId)
    // 兜底：interrupt 不保证 SDK 一定再吐 result，主动发 aborted 让渲染端清 streaming 状态。
    win.webContents.send('claude:aborted', { localSessionId })
  })
  ipcMain.handle('claude:running-sessions', () => claude.runningSessionIds())
  ipcMain.handle('claude:dialog-response', (_e, { reqId, result }) => {
    claude.resolveDialog(reqId, result)
  })
  // 动态切换权限模式：批准计划后立即退出 plan 模式（control request 实时生效）。
  ipcMain.handle('claude:set-permission-mode', (_e, { localSessionId, permission }) => {
    return claude.setPermissionMode(localSessionId, permission)
  })
  ipcMain.handle('cc:builtin:compact', (_e, localSessionId: string) => claude.compactSession(localSessionId, win.webContents))
  ipcMain.handle('cc:builtin:init', (_e, opts: { cwd: string }) => claude.initProject(opts.cwd, win.webContents))
  ipcMain.handle('cc:builtin:export', (_e, localSessionId: string) => claude.exportSession(localSessionId, win.webContents))
  ipcMain.handle('cc:builtin:add-dir', (_e, opts: { localSessionId: string; dir: string }) => claude.addDir(opts.localSessionId, opts.dir, win.webContents))

  // Settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial) => saveSettings(partial))

  // cc-desk 自有配置（模型供应商，存 ~/.cc-desk/config.json）
  ipcMain.handle('cc-desk:model:get', () => getModelProvidersConfig())
  ipcMain.handle('cc-desk:model:save', (_e, patch) => saveModelProvidersConfig(patch))

  // 工作区快照（projects 含会话/消息，独立于 settings 存储）
  ipcMain.handle('projects:get', () => getProjectsSnapshot())
  ipcMain.handle('projects:save', (_e, snap) => saveProjectsSnapshot(snap))

  // Claude 配置（真实读写 ~/.claude/ 配置文件）
  ipcMain.handle('cc:mcp:get', () => cc.getMcpServers())
  ipcMain.handle('cc:mcp:save', (_e, servers) => cc.saveMcpServers(servers))
  ipcMain.handle('cc:plugins:get', () => cc.getPlugins())
  ipcMain.handle('cc:plugin:set-enabled', (_e, id, enabled) => cc.setPluginEnabled(id, enabled))
  ipcMain.handle('cc:skills:get', () => cc.getSkills())
  ipcMain.handle('cc:commands:get', () => cc.getCommands())
  ipcMain.handle('cc:hooks:get', () => cc.getHooks())
  ipcMain.handle('cc:hook:set-enabled', (_e, name, enabled) => cc.setHookEnabled(name, enabled))
  ipcMain.handle('cc:model:get', () => cc.getModelConfig())
  ipcMain.handle('cc:model:save', (_e, cfg) => cc.saveModelConfig(cfg))
  ipcMain.handle('cc:general:get', () => cc.getGeneralConfig())
  ipcMain.handle('cc:general:save', (_e, cfg) => cc.saveGeneralConfig(cfg))

  // 全局记忆文件 CLAUDE.md（读写 ~/.cc-desk/claude/CLAUDE.md）
  ipcMain.handle('cc:memory:get', () => getMemoryFile())
  ipcMain.handle('cc:memory:save', (_e, content: string) => saveMemoryFile(content))

  // File System
  ipcMain.handle('fs:read-tree', async (_e, dirPath: string) => readDirTree(dirPath))
  ipcMain.handle('fs:read-file', async (_e, filePath: string) => readFileContent(filePath))
  ipcMain.handle('fs:search-files', async (_e, dirPath: string) => searchFiles(dirPath))
  ipcMain.handle('fs:write-file', async (_e, filePath: string, content: string) => writeFileContent(filePath, content))
  ipcMain.handle('fs:exists', async (_e, filePath: string) => pathExists(filePath))
  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

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

  // 后台任务
  ipcMain.handle('backend-task:list', (_e, localSessionId: string) => {
    return backendTaskRegistry.listBySession(localSessionId)
  })

  // 从 registry 删除后台任务记录（渲染端「移除」/「清除已结束」调用）。
  // 仅清理已持久化的记录，不影响正在运行的进程（停止走 backend-task:kill）。
  // 支持单个(taskIds 为单元素)与批量两种调用。
  ipcMain.handle('backend-task:remove', (_e, _localSessionId: string, taskIds: string | string[]) => {
    const ids = Array.isArray(taskIds) ? taskIds : [taskIds]
    return backendTaskRegistry.removeMany(ids)
  })

  ipcMain.handle('backend-task:kill', async (_e, localSessionId: string, taskId: string) => {
    try {
      await claude.stopTask(localSessionId, taskId)
      // handleTaskNotification 返回更新后的 task，直接用，免去 listBySession 线性扫描
      const t = backendTaskRegistry.handleTaskNotification(localSessionId, { task_id: taskId, status: 'stopped' })
      if (t) win.webContents.send('claude:backend-task', { localSessionId, op: 'update', task: t })
      return { ok: true }
    } catch (err) {
      console.error('[backend-task] kill failed', taskId, err)
      return { ok: false, error: String(err) }
    }
  })

  // 会话归档：杀持久进程 + 清理该会话后台任务记录（避免 registry Map 无限增长）
  ipcMain.handle('session:archive', async (_e, localSessionId: string) => {
    await claude.closeSession(localSessionId)
    backendTaskRegistry.clearBySession(localSessionId)
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

  // 渲染端(重新)加载完成后,把活跃 SDK session 的事件回调重新绑定到当前 webContents。
  // 刷新页面时 webContents 对象本身不变(JS 上下文重建),onEvent 闭包仍指向同一 webContents,
  // 但统一在 did-finish-load 后 reattach 可保证回调指向最新的 webContents(保险 + 一致性)。
  win.webContents.on('did-finish-load', () => {
    claude.reattachRunningSessions(win.webContents)
  })
}

app.whenReady().then(() => {
  // macOS dev 下 BrowserWindow.icon 不覆盖 dock 图标，需显式设 dock icon
  if (process.platform === 'darwin') {
    try { app.dock?.setIcon(iconPath) } catch { /* ignore */ }
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  startArchiveTimer()
})

// 自动归档定时器：autoArchive 开启时，每 30 分钟向渲染端发一次归档信号，
// 携带 archiveDays 对应的时间阈值。渲染端据此清理陈旧空会话。
let archiveTimer: NodeJS.Timeout | null = null
function startArchiveTimer() {
  if (archiveTimer) clearInterval(archiveTimer)
  const tick = () => {
    const s = getSettings()
    if (!s.autoArchive) return
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    const days = Number(s.archiveDays) > 0 ? Number(s.archiveDays) : 7
    const beforeTs = Date.now() - days * 24 * 60 * 60 * 1000
    win.webContents.send('archive:tick', { beforeTs })
  }
  // 启动后立即跑一次（清理历史空会话），之后每 30 分钟
  setTimeout(tick, 10_000)
  archiveTimer = setInterval(tick, 30 * 60 * 1000)
}

app.on('before-quit', async () => {
  // Cmd+Q（macOS）走 before-quit，window-all-closed 此时未必触发；
  // 这里统一清理 PTY 子进程 + SDK 持久 query + 后台任务记录，避免孤儿进程与泄漏。
  ptyManager.killAll()
  backendTaskRegistry.clearAll()
  await sessionQueryManager.closeAll()
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  if (process.platform !== 'darwin') app.quit()
})
