import { app, BrowserWindow, shell, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { WebSocket } from 'ws'
import QRCode from 'qrcode'
import { ClaudeService } from './claude-service'
import { SessionQueryManager } from './session-query-manager'
import { PtyManager } from './pty-manager'
import { readDirTree, readFileContent, searchFiles, writeFileContent, pathExists, statKind } from './file-service'
import { getSettings, saveSettings } from './settings-store'
import { menuT } from './menu-i18n'
import { getModelProvidersConfig, saveModelProvidersConfig } from './cc-desk-store'
import { getProjectsSnapshot, saveProjectsSnapshot } from './projects-store'
import * as cc from './claude-config'
import * as mkt from './marketplace-manager'
import * as gitSvc from './git-service'
import { getMemoryFile, saveMemoryFile } from './memory-file'
import { BackendTaskRegistry } from './backend-task-registry'
import { ensureClaudeConfigDir } from './paths'
import { migrateFromClaude } from './migrate-from-claude'
import { UpdateManager } from './update-manager'
import { fixEnvSync } from './fix-env'
import {
  getRemoteConfig, saveRemoteConfig, ensureDeviceIdentity,
  shouldRecordPaired, markUnpaired, clearUnpaired, type RemoteConfig,
} from './remote-config'
import {
  createRemoteBridge, createDispatcher, createDialogReplayer, createEventForwarder,
  buildSessionListPayload,
  type RemoteBridge, type DialogReplayer,
} from './remote-bridge'
import { makeEnvelope, type Envelope, type MessageType } from '../shared/remote-protocol'
import {
  buildPairCodeRequest, buildPairUrl, isPairCodeResponse, isPairErrorResponse,
  isPairRequestEnvelope,
} from './remote-pair'

// 启动第一件事：修正 PATH/env。打包成 .app 后 GUI 不执行用户 shell 启动脚本，
// process.env.PATH 只有 /usr/bin:/bin:...，SDK 子进程（继承 process.env）会找不到
// node/npm/pnpm（它们来自 nvm/homebrew/pnpm，由 shell 启动脚本注入）。
// 跑 login shell 取回完整用户环境合并进 process.env，必须早于任何 query()。
fixEnvSync()

// 紧接着：把 Claude Agent SDK / CLI 的配置目录隔离到 ~/.cc-desk/claude，
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


// ===== 远程控制 bridge 生命周期 =====
//
// 关键设计决策（不确定点 1：webContents 能否监听自身 send 的事件）：
// Electron 的 webContents.send 是单向出口（主→渲染），主进程无法用 wc.on('claude:xxx')
// 监听自身发出的 IPC 事件——webContents 作为 EventEmitter 只发渲染侧事件（did-finish-load 等），
// 不会回放它自己 send 的消息。简报里的 `wc.on('claude:dialog-request', ...)` 旁路监听方案不可行。
//
// 采用「包装 webContents.send」方案（拼多多式去中间层，不新增事件总线、不改 ClaudeService 一行）：
// 启动 bridge 时，把当前 webContents.send 替换为一个代理：先喂给 forwarder，再调用原 send。
// 这样 ClaudeService 内所有 webContents.send('claude:*') 自动被 forwarder 捕获并转发给手机端。
// 停止 bridge 时还原原 send，零侵入、可逆。
//
// 注意：仅包装「业务事件」通道（claude:delta/blocks/notice/result/dialog-request），
// 其他通道（update:state 等）不进 forwarder，避免噪音。

type ForwarderHandle = {
  onClaudeDelta(data: any): void
  onClaudeBlocks(data: any): void
  onNotice(data: any): void
  onResult(data: any): void
  onDialogRequest(data: any): void
  sendSessionList(sessions: { localSessionId: string; title: string; status: 'running' | 'completed' | 'error' | 'idle' }[]): void
}

/** 需要旁路转发给手机端的 claude:* 业务事件通道白名单。 */
const REMOTE_FORWARD_CHANNELS = new Set([
  'claude:delta', 'claude:blocks', 'claude:notice', 'claude:result', 'claude:dialog-request',
])

let remoteBridge: RemoteBridge | null = null
let remoteReplayer: DialogReplayer | null = null
/** 原始 webContents.send 的引用，停止 bridge 时还原。 */
let originalSend: ((channel: string, ...args: any[]) => void) | null = null
/** 当前已包装 send 的 webContents，用于判断是否需要重新包装（窗口刷新时 webContents 对象不变）。 */
let wrappedWebContents: Electron.WebContents | null = null
/** 配对事件订阅者：手机配对成功时通知渲染端刷新已配对列表。 */
let pairTimer: NodeJS.Timeout | null = null

function emitRemoteState(connected: boolean) {
  const wc = getActiveWin()?.webContents
  if (wc) {
    try { wc.send('remote:state', { connected }) } catch { /* 窗口可能已销毁 */ }
  }
}

function emitPairEvent(data: unknown) {
  const wc = getActiveWin()?.webContents
  if (wc) {
    try { wc.send('remote:pair-event', data) } catch { /* noop */ }
  }
}

/**
 * 启动远程 bridge：建立到中继的长连接、包装 webContents.send 接管出站事件、
 * 装配 dispatcher（入站分发）+ replayer（dialog 断线补发）+ forwarder（出站转发）。
 *
 * 幂等：重复调用会先停掉旧实例。
 */
function startRemoteBridge(cfg: RemoteConfig): void {
  if (!cfg.enabled || !cfg.deviceId || !cfg.deviceKey) return
  if (remoteBridge) return // 已启动

  const win = getActiveWin()
  if (!win) return
  const wc = win.webContents

  // replayer 补发的是 forwarder 早先 enqueue 的「占位信封」（sig 为空），
  // 必须和 forwarder 的 sendFn 一样用 makeEnvelope 重签后发给中继，
  // 否则中继会以 bad_sig 拒收，手机重连后永远看不到挂起的批准请求。
  remoteReplayer = createDialogReplayer((env) => {
    const signed = makeEnvelope(cfg.deviceKey, env.type as MessageType, cfg.deviceId, env.payload)
    remoteBridge?.send(signed)
  })

  const dispatcher = createDispatcher({
    send: (opts) => claude.send({ ...opts, webContents: wc }),
    interrupt: (lsid) => { void claude.interrupt(lsid, wc) },
    resolveDialog: (reqId, result) => claude.resolveDialog(reqId, result),
  })

  // 出站转发：把 forwarder 产出的占位信封用 deviceKey 重签后发中继。
  const forwarder = createEventForwarder(
    (env) => {
      const signed = makeEnvelope(cfg.deviceKey, env.type as MessageType, cfg.deviceId, env.payload)
      remoteBridge?.send(signed)
    },
    { enqueueDialog: (reqId, env) => remoteReplayer?.enqueue(reqId, env) },
  ) as ForwarderHandle

  // 配对设备增补：中继把手机的业务信封转发过来时，env.deviceId 即手机设备 ID。
  // 收到任意业务信封说明该设备已配对上线，补进 pairedDevices（去重）并通知渲染端刷新。
  const recordPairedDevice = (mobileId: string) => {
    const cur = getRemoteConfig()
    if (!shouldRecordPaired(cur, mobileId)) return
    saveRemoteConfig({ pairedDevices: [...cur.pairedDevices, mobileId] })
    emitPairEvent({ kind: 'paired', deviceId: mobileId })
  }

  // 入站：手机→桌面的业务信封 + bind.ok 后重连补发挂起 dialog。
  remoteBridge = createRemoteBridge({
    relayUrl: cfg.relayUrl,
    deviceId: cfg.deviceId,
    deviceKey: cfg.deviceKey,
    onInbound: (env) => {
      // pair.request（手机请求配对，当前中继 v1 不发，协议预留）：弹原生 dialog 让用户确认。
      if (isPairRequestEnvelope(env)) {
        void handlePairRequest(env, cfg)
        return
      }
      // 业务信封：发送方为已配对手机，补进 pairedDevices。
      recordPairedDevice(env.deviceId)
      void dispatcher(env)
      // bind.ok 不走 onInbound（remote-bridge 在握手处拦截），这里收到的均为业务信封；
      // bind 成功后补发挂起 dialog（手机可能在 dialog 挂起期间掉线）。
      remoteReplayer?.replayFor('mobile')
    },
  })

  // 状态轮询：bridge.isConnected() 在握手成功后变 true。每 2s 探测一次推给渲染端。
  // 用轮询而非回调：remote-bridge 未暴露 onConnect 回调，轮询最简且零侵入。
  if (pairTimer) clearInterval(pairTimer)
  let lastState = false
  pairTimer = setInterval(() => {
    if (!remoteBridge) return
    const cur = remoteBridge.isConnected()
    if (cur !== lastState) {
      lastState = cur
      emitRemoteState(cur)
      // I2：连上中继（false→true）后下发当前会话清单，让手机端 SessionListPage 有数据。
      // 从 projects-store 读快照、扁平化、转协议 payload。用 forwarder.sendSessionList
      // 统一经 makeEnvelope 重签后发中继。重连也会重发（手机重连后能重新拿到列表）。
      if (cur) {
        try {
          const snap = getProjectsSnapshot()
          forwarder.sendSessionList(
            buildSessionListPayload(snap.projects).sessions.map((s) => ({
              localSessionId: s.localSessionId,
              title: s.title,
              status: s.status,
            })),
          )
        } catch {
          // 读快照失败不应影响连接状态上报
        }
      }
    }
  }, 2000)

  // 包装 webContents.send：仅对业务事件通道旁路转发，其余直接放行。
  // 防御：若已包装同一 webContents（窗口刷新后对象不变），不重复包装。
  if (wrappedWebContents !== wc) {
    originalSend = wc.send.bind(wc)
    wrappedWebContents = wc
    wc.send = ((channel: string, ...args: any[]) => {
      try {
        if (REMOTE_FORWARD_CHANNELS.has(channel)) {
          switch (channel) {
            case 'claude:delta': forwarder.onClaudeDelta(args[0]); break
            case 'claude:blocks': forwarder.onClaudeBlocks(args[0]); break
            case 'claude:notice': forwarder.onNotice(args[0]); break
            case 'claude:result': forwarder.onResult(args[0]); break
            case 'claude:dialog-request': forwarder.onDialogRequest(args[0]); break
          }
        }
      } catch {
        // forwarder 异常不影响主进程渲染通道
      }
      return originalSend!(channel, ...args)
    }) as typeof wc.send
  }

  void remoteBridge.start()
  console.log('[remote] bridge started for device', cfg.deviceId)
}

/** 停止 bridge 并还原 webContents.send。 */
function stopRemoteBridge(): void {
  if (pairTimer) { clearInterval(pairTimer); pairTimer = null }
  if (remoteBridge) {
    void remoteBridge.stop()
    remoteBridge = null
  }
  remoteReplayer = null
  // 还原 send：仅当当前 wc 仍是被包装的那个（窗口可能已销毁重建）。
  if (wrappedWebContents && originalSend) {
    try {
      wrappedWebContents.send = originalSend as typeof wrappedWebContents.send
    } catch { /* noop */ }
    wrappedWebContents = null
    originalSend = null
  }
  emitRemoteState(false)
}

/**
 * 处理手机的配对请求（pair.request）：弹原生 dialog 让桌面用户确认。
 * 确认后向中继发 pair.approve；拒绝则不发（手机侧超时即视为拒绝）。
 * 注：当前中继 v1 配对走手机单方 consume，不主动发 pair.request；此为协议预留的防御性实现。
 */
async function handlePairRequest(env: Envelope, cfg: RemoteConfig): Promise<void> {
  const win = getActiveWin()
  if (!win) return
  const mobileId = (env.payload as any)?.deviceId ?? env.deviceId
  const choice = await dialog.showMessageBox(win, {
    type: 'question',
    title: '远程控制配对',
    message: '有设备请求配对本机',
    detail: `设备 ID：${mobileId}\n\n是否同意该设备远程控制？`,
    buttons: ['拒绝', '同意'],
    defaultId: 0,
    cancelId: 0,
  })
  if (choice.response === 1) {
    const approve = makeEnvelope(cfg.deviceKey, 'pair.approve', cfg.deviceId, { mobileId })
    remoteBridge?.send(approve)
  }
}

/**
 * 经中继 /pair 端点申请配对码：起一条临时 ws 连接，发 pair.code，等回包即关。
 * 返回 { code, qr, expiresAt }；失败返回 { error }。
 *
 * 注：pair 阶段桌面尚未与手机建立绑定，不能走 /ws（需已 bind）；
 * 中继的 /pair 端点接受明文 {type,deviceId,deviceKey}（pair 阶段无对端，无需签名信封）。
 */
async function requestPairCode(cfg: RemoteConfig): Promise<{ code: string; qr: string; expiresAt: number } | { error: string }> {
  return new Promise((resolve) => {
    const base = cfg.relayUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
    const url = `${base}/pair`
    let settled = false
    let ws: WebSocket | null = null
    const cleanup = () => {
      try { ws?.close() } catch { /* noop */ }
      try { ws?.terminate() } catch { /* noop */ }
    }
    const fail = (err: string) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ error: err })
    }
    try {
      ws = new WebSocket(url)
    } catch (e) {
      fail(`无法连接中继：${String(e)}`)
      return
    }
    // 10s 超时兜底
    const timer = setTimeout(() => fail('配对超时，请确认中继地址可达'), 10_000)
    ws.on('open', () => {
      const req = buildPairCodeRequest(cfg.deviceId, cfg.deviceKey)
      ws!.send(JSON.stringify(req))
    })
    ws.on('message', (raw) => {
      if (settled) return
      let msg: unknown
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (isPairCodeResponse(msg)) {
        settled = true
        clearTimeout(timer)
        const code = msg.payload.code
        const pairUrl = buildPairUrl(cfg.relayUrl, code)
        QRCode.toDataURL(pairUrl).then((qr) => {
          cleanup()
          resolve({ code, qr, expiresAt: msg.payload.expiresAt })
        }).catch((e) => {
          cleanup()
          resolve({ error: `二维码生成失败：${String(e)}` })
        })
        return
      }
      if (isPairErrorResponse(msg)) {
        fail(`中继拒绝：${msg.payload.code}`)
        return
      }
      // 其他消息忽略
    })
    ws.on('error', (e) => fail(`连接中继失败：${String(e)}`))
  })
}


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
    const wc = getActiveWin()?.webContents
    await claude.interrupt(localSessionId, wc)
    // 兜底：interrupt 不保证 SDK 一定再吐 result，主动发 aborted 让渲染端清 streaming 状态。
    wc?.send('claude:aborted', { localSessionId })
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
  ipcMain.handle('cc:mcp:get-json', () => cc.getMcpServersJson())
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
  ipcMain.handle('fs:stat-kind', async (_e, filePath: string) => statKind(filePath))

  // Git（审查 tab）
  ipcMain.handle('git:status', (_e, cwd: string) => gitSvc.status(cwd))
  ipcMain.handle('git:diff', (_e, cwd: string, scope: string, filePath?: string) => gitSvc.diff(cwd, scope as any, filePath))
  ipcMain.handle('git:add', (_e, cwd: string, paths: string[]) => gitSvc.add(cwd, paths))
  ipcMain.handle('git:restore', (_e, cwd: string, paths: string[], staged: boolean) => gitSvc.restore(cwd, paths, { staged }))
  // git:commit / git:reset-hard 仅纯转发：成功反馈由 ReviewTab 本地 notice 状态管理
  // （主进程 claude:notice 带 localSessionId:'' 会被 ChatArea 的 if(!sid) 丢弃，属死代码）
  ipcMain.handle('git:commit', (_e, cwd: string, message: string) => gitSvc.commit(cwd, message))
  ipcMain.handle('git:reset-hard', (_e, cwd: string) => gitSvc.resetHard(cwd))
  ipcMain.handle('git:generate-commit-message', (_e, cwd: string) => claude.generateCommitMessage(cwd))

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

  // 远程控制：配置读写 + bridge 启停 + 配对 + 解绑
  ipcMain.handle('remote:get-config', () => getRemoteConfig())
  ipcMain.handle('remote:save-config', (_e, patch) => {
    const prev = getRemoteConfig()
    saveRemoteConfig(patch)
    const next = getRemoteConfig()
    // enabled 切换 → 启停 bridge
    if (patch.enabled !== undefined && patch.enabled !== prev.enabled) {
      if (next.enabled) {
        // 首次启用：生成设备身份（幂等），再启动
        ensureDeviceIdentity()
        startRemoteBridge(getRemoteConfig())
      } else {
        stopRemoteBridge()
      }
    }
    // relayUrl 变更时重建 bridge（若当前在跑）
    if (next.enabled && patch.relayUrl !== undefined && patch.relayUrl !== prev.relayUrl) {
      stopRemoteBridge()
      startRemoteBridge(next)
    }
    return next
  })
  ipcMain.handle('remote:pair', async () => {
    const cfg = getRemoteConfig()
    if (!cfg.enabled || !cfg.deviceId || !cfg.deviceKey) {
      return { error: '请先启用远程控制' }
    }
    // 用户主动重新发起配对：清空解绑名单，允许被解绑设备重新登记。
    clearUnpaired()
    return requestPairCode(cfg)
  })
  ipcMain.handle('remote:cancel-pair', () => {
    // v1：配对码在中继侧 60s 自动过期，桌面端无状态可清，返回 ok 让 UI 清展示态
    return { ok: true }
  })
  ipcMain.handle('remote:unpair', (_e, deviceId: string) => {
    const cfg = getRemoteConfig()
    saveRemoteConfig({ pairedDevices: cfg.pairedDevices.filter(d => d !== deviceId) })
    // 标记为「最近解绑」：防止该设备仍在中继 binding 里时，收到其业务信封被自动加回。
    markUnpaired(deviceId)
    emitPairEvent({ kind: 'unpaired', deviceId })
    return { ok: true }
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
  // dev 模式不自动检测更新：mac 下 checkNow 会 fetch GitHub latest-mac.yml 比对版本，
  // dev 时无意义且耗费网络请求；win/linux 的 autoUpdater 本就仅打包后可用。
  // 手动「检查更新」菜单仍可用（checkNow 内部已处理 dev 跳过 autoUpdater 分支）。
  if (!isDev) updateManager.startAutoCheck()
  // 注册原生应用菜单（mac 补 Edit 菜单避免 Cmd+C 失效；各平台加「检查更新」）
  Menu.setApplicationMenu(buildAppMenu(updateManager))
  // 应用启动时若远程控制已启用且身份就绪，自动建立 bridge。
  // 延迟到首个窗口 did-finish-load 后再起：包装 webContents.send 需要窗口已就绪。
  const firstWin = BrowserWindow.getAllWindows()[0]
  if (firstWin) {
    const cfg = getRemoteConfig()
    if (cfg.enabled && cfg.deviceId && cfg.deviceKey) {
      firstWin.webContents.once('did-finish-load', () => startRemoteBridge(getRemoteConfig()))
    }
  }
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
  stopRemoteBridge()
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
  // macOS app 菜单：显式设置 label 以覆盖系统语言，与 app 语言设置保持一致
  const appMenu: Electron.MenuItemConstructorOptions = isMac
    ? {
        label: app.name,
        submenu: [
          { role: 'about', label: t('menu.about') },
          checkUpdate,
          { type: 'separator' },
          { role: 'quit', label: t('menu.quit') },
        ],
      }
    : { label: t('menu.file'), submenu: [{ role: 'quit', label: t('menu.quit') }] }

  const editMenu: Electron.MenuItemConstructorOptions = {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.undo') },
      { role: 'redo', label: t('menu.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('menu.cut') },
      { role: 'copy', label: t('menu.copy') },
      { role: 'paste', label: t('menu.paste') },
      { role: 'selectAll', label: t('menu.selectAll') },
    ],
  }

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: t('menu.view'),
    submenu: [reloadPage, { type: 'separator' }, toggleDevTools],
  }

  const windowMenu: Electron.MenuItemConstructorOptions = {
    label: t('menu.window'),
    submenu: [
      { role: 'minimize', label: t('menu.minimize') },
      { role: 'zoom', label: t('menu.zoom') },
      ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const, label: t('menu.bringToFront') }] : [{ role: 'close' as const, label: t('menu.close') }]),
    ],
  }

  const helpMenu: Electron.MenuItemConstructorOptions = {
    label: t('menu.help'),
    submenu: [checkUpdate, ...(isMac ? [] : [{ role: 'about' as const, label: t('menu.about') }])],
  }

  const template: Electron.MenuItemConstructorOptions[] = isMac
    ? [appMenu, editMenu, viewMenu, windowMenu]
    : [appMenu, editMenu, viewMenu, helpMenu]

  return Menu.buildFromTemplate(template)
}
