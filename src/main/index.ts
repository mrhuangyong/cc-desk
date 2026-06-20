import { app, BrowserWindow, shell, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { ClaudeService } from './claude-service'
import { SessionQueryManager } from './session-query-manager'
import { PtyManager } from './pty-manager'
import { readDirTree, readFileContent, searchFiles, writeFileContent, pathExists } from './file-service'
import { getSettings, saveSettings } from './settings-store'
import { menuT } from './menu-i18n'
import { getModelProvidersConfig, saveModelProvidersConfig } from './cc-desk-store'
import { getProjectsSnapshot, saveProjectsSnapshot } from './projects-store'
import * as cc from './claude-config'
import * as mkt from './marketplace-manager'
import { getMemoryFile, saveMemoryFile } from './memory-file'
import { BackendTaskRegistry } from './backend-task-registry'
import { ensureClaudeConfigDir } from './paths'
import { migrateFromClaude } from './migrate-from-claude'
import { UpdateManager } from './update-manager'

// 启动第一件事：把 Claude Agent SDK / CLI 的配置目录隔离到 ~/.cc-desk/claude，
// 使运行时不再读取 ~/.claude/settings.json（其 env 块会覆盖 cc-desk 注入的角色模型映射，
// 导致 haiku 等后台子任务被 ~/.claude 的模型配置劫持）。必须在任何 query() 之前完成。
ensureClaudeConfigDir()
// 首次启动时把 ~/.claude 的插件/技能/设置一次性迁移到隔离目录（幂等，已迁移则跳过）。
// 让设置页与 SDK 运行时在隔离目录也能看到原有插件，cc-desk 完全自洽不再依赖 ~/.claude。
void migrateFromClaude()
// 应用启动后异步刷新标记了 autoUpdate 的插件仓库（不阻塞窗口加载，失败静默跳过）。
mkt.refreshAutoUpdateMarketplaces().catch(() => {})

const isDev = !app.isPackaged

// 应用图标：out/main → 项目根 ../../build/icons/。dev 与 build 均输出到 out/，路径一致。
const iconPath = join(__dirname, '../../build/icons/icon.png')

const claude = new ClaudeService()
const backendTaskRegistry = new BackendTaskRegistry()
claude.setRegistry(backendTaskRegistry)
const sessionQueryManager = new SessionQueryManager()
claude.setManager(sessionQueryManager)
const ptyManager = new PtyManager()
const updateManager = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })


// 获取当前活动窗口（IPC handler 在窗口重建后需要拿到最新 webContents）
function getActiveWin(): Electron.BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins.length > 0 ? wins[wins.length - 1] : null
}

// IPC handler 全局注册一次（不随窗口重建重复注册）
function registerIpcHandlers(): void {


  // Claude
  ipcMain.handle('claude:send', (_e, opts) => {
    return claude.send({ ...opts, webContents: getActiveWin()!.webContents })
  })
  ipcMain.handle('claude:stop', async (_e, localSessionId: string) => {
    await claude.interrupt(localSessionId)
    // 兜底：interrupt 不保证 SDK 一定再吐 result，主动发 aborted 让渲染端清 streaming 状态。
    getActiveWin()!.webContents.send('claude:aborted', { localSessionId })
  })
  ipcMain.handle('claude:running-sessions', () => claude.runningSessionIds())
  ipcMain.handle('claude:dialog-response', (_e, { reqId, result }) => {
    claude.resolveDialog(reqId, result)
  })
  // 动态切换权限模式：批准计划后立即退出 plan 模式（control request 实时生效）。
  ipcMain.handle('claude:set-permission-mode', (_e, { localSessionId, permission }) => {
    return claude.setPermissionMode(localSessionId, permission)
  })
  ipcMain.handle('cc:builtin:compact', (_e, localSessionId: string) => claude.compactSession(localSessionId, getActiveWin()!.webContents))
  ipcMain.handle('cc:builtin:init', (_e, opts: { cwd: string }) => claude.initProject(opts.cwd, getActiveWin()!.webContents))
  ipcMain.handle('cc:builtin:export', (_e, localSessionId: string) => claude.exportSession(localSessionId, getActiveWin()!.webContents))
  ipcMain.handle('cc:builtin:add-dir', (_e, opts: { localSessionId: string; dir: string }) => claude.addDir(opts.localSessionId, opts.dir, getActiveWin()!.webContents))

  // Settings
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, partial) => {
    const prevLang = getSettings().lang
    saveSettings(partial)
    // 语言变更时重建菜单，让自定义 label 跟随切换
    if (partial.lang && partial.lang !== prevLang) {
      Menu.setApplicationMenu(buildAppMenu(updateManager))
    }
  })

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
  ipcMain.handle('cc:marketplace:get', () => mkt.getMarketplaces())
  ipcMain.handle('cc:marketplace:get-plugins', (_e, name: string) => mkt.getMarketplacePlugins(name))
  ipcMain.handle('cc:marketplace:search', (_e, query: string) => mkt.searchMarketplacePlugins(query))
  ipcMain.handle('cc:marketplace:add', (_e, source: string, options?: any) => mkt.addMarketplace(source, options))
  ipcMain.handle('cc:marketplace:remove', (_e, name: string) => mkt.removeMarketplace(name))
  ipcMain.handle('cc:marketplace:refresh', (_e, name: string) => mkt.refreshMarketplace(name))
  ipcMain.handle('cc:marketplace:refresh-all', () => mkt.refreshAllMarketplaces())
  ipcMain.handle('cc:marketplace:set-auto-update', (_e, name: string, enabled: boolean) => mkt.setMarketplaceAutoUpdate(name, enabled))
  ipcMain.handle('cc:plugin:install', (_e, pluginId: string) => cc.installPlugin(pluginId))
  ipcMain.handle('cc:plugin:uninstall', (_e, pluginId: string) => cc.uninstallPlugin(pluginId))
  ipcMain.handle('cc:skills:get', () => cc.getSkills())
  ipcMain.handle('cc:skill:get', (_e, id: string) => cc.getSkillFile(id))
  ipcMain.handle('cc:skill:save', (_e, id: string, content: string) => cc.saveSkillFile(id, content))
  ipcMain.handle('cc:skill:set-enabled', (_e, name: string, enabled: boolean) => cc.setSkillEnabled(name, enabled))
  ipcMain.handle('cc:commands:get', () => cc.getCommands())
  ipcMain.handle('cc:command:create', (_e, name: string, desc: string) => cc.createCommand(name, desc))
  ipcMain.handle('cc:command:get-file', (_e, source: string, name: string) => cc.getCommandFile(source, name))
  ipcMain.handle('cc:command:save', (_e, name: string, content: string) => cc.saveCommandFile(name, content))
  ipcMain.handle('cc:command:delete', (_e, name: string) => cc.deleteCommand(name))
  ipcMain.handle('cc:hooks:get', () => cc.getHooksFull())
  ipcMain.handle('cc:hooks:save', (_e, hooks) => cc.saveHooks(hooks))
  ipcMain.handle('cc:hooks:get-json', () => cc.getHooksJson())
  ipcMain.handle('cc:hooks:save-json', (_e, jsonText) => cc.saveHooksJson(jsonText))
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
    const result = await dialog.showOpenDialog(getActiveWin()!, {
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
      if (t) getActiveWin()!.webContents.send('claude:backend-task', { localSessionId, op: 'update', task: t })
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

  // 应用更新
  ipcMain.handle('update:check', () => updateManager.checkNow())
  ipcMain.handle('update:install', () => updateManager.install())
  ipcMain.handle('update:download-and-open', () => updateManager.downloadDmgAndOpen())

  // 关于页版本信息
  ipcMain.handle('app:version', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }))

  // 开发者工具：开关 DevTools（受常规设置 devTools 控制）。同时重建菜单更新可见性。
  ipcMain.handle('app:set-devtools', (_e, enabled: boolean) => {
    const w = getActiveWin()
    if (!w) return
    if (enabled) w.webContents.openDevTools({ mode: 'detach' })
    else w.webContents.closeDevTools()
    // 重建菜单让「开发者工具」项可见性跟随设置
    Menu.setApplicationMenu(buildAppMenu(updateManager))
  })
}

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

  // 更新状态转发到当前窗口（窗口重建时在 did-finish-load 重绑）
  updateManager.setEmit((s) => win.webContents.send('update:state', s))

  // IPC handler 在 app ready 时只注册一次（见 registerIpcHandlers），
  // 不随 createWindow 重复注册，避免窗口重建时报 'second handler' 错误。

  // 开发态加载 dev server，生产态加载打包文件
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 刷新页面快捷键（Cmd/Ctrl+Shift+R）— 菜单 accelerator 已注册，这里做兜底防止菜单被覆盖
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const isReload = (process.platform === 'darwin'
      ? input.meta && input.shift && input.key.toLowerCase() === 'r'
      : input.control && input.shift && input.key.toLowerCase() === 'r')
    if (isReload) {
      win.webContents.reload()
      _event.preventDefault()
    }
  })

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
    // 窗口刷新后重绑 update emit 并重发当前态，让按钮立即恢复
    updateManager.setEmit((s) => win.webContents.send('update:state', s))
    updateManager.sendCurrentState()
  })
}

app.whenReady().then(() => {
  // macOS dev 下 BrowserWindow.icon 不覆盖 dock 图标，需显式设 dock icon
  if (process.platform === 'darwin') {
    try { app.dock?.setIcon(iconPath) } catch { /* ignore */ }
  }
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  startArchiveTimer()
  updateManager.startAutoCheck()
  // 注册原生应用菜单（mac 补 Edit 菜单避免 Cmd+C 失效；各平台加「检查更新」）
  Menu.setApplicationMenu(buildAppMenu(updateManager))
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
  updateManager.dispose()
  await sessionQueryManager.closeAll()
})

app.on('window-all-closed', () => {
  ptyManager.killAll()
  if (process.platform !== 'darwin') app.quit()
})

// 原生应用菜单：mac 应用菜单 / 其他平台帮助菜单各加「检查更新」。
// mac 必须有 Edit 菜单，否则 Cmd+C/Cmd+V 失效（Electron 已知行为）。
function buildAppMenu(updateMgr: UpdateManager): Menu {
  const isMac = process.platform === 'darwin'
  const lang = getSettings().lang
  const t = (key: string) => menuT(lang, key)
  const checkUpdate: Electron.MenuItemConstructorOptions = {
    label: t('menu.checkUpdate'),
    click: () => updateMgr.checkNow(),
  }
  // 刷新页面（Cmd/Ctrl+Shift+R）
  const reloadPage: Electron.MenuItemConstructorOptions = {
    label: t('menu.reload'),
    accelerator: 'CmdOrCtrl+Shift+R',
    click: () => { getActiveWin()?.webContents.reload() },
  }
  // 开发者工具（Cmd/Ctrl+Option/Alt+I）— 仅当设置开启时可见可用
  const toggleDevTools: Electron.MenuItemConstructorOptions = {
    label: t('menu.devTools'),
    accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
    visible: getSettings().devTools,
    click: () => {
      const wc = getActiveWin()?.webContents
      if (!wc) return
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      else wc.openDevTools({ mode: 'detach' })
    },
  }
  const template: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        { role: 'appMenu', submenu: [checkUpdate, { type: 'separator' }, { role: 'quit' }] },
        { role: 'editMenu' },
        {
          label: t('menu.view'),
          submenu: [reloadPage, { type: 'separator' }, toggleDevTools],
        },
        { role: 'windowMenu', submenu: [{ role: 'close' }, { role: 'minimize' }] },
      ]
    : [
        { label: t('menu.file'), submenu: [{ role: 'quit' }] },
        {
          label: t('menu.view'),
          submenu: [reloadPage, { type: 'separator' }, toggleDevTools],
        },
        { label: t('menu.help'), submenu: [checkUpdate, { role: 'about' }] },
      ]
  return Menu.buildFromTemplate(template)
}
