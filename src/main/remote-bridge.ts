// src/main/remote-bridge.ts
// 桌面端中继客户端：维护到中继的 WSS 长连接，bind 握手 + 指数退避重连。
//
// 边界（重要）：
// - 不直接 import 主进程单例（ClaudeService/SessionQueryManager/webContents）。
//   所有协作通过 deps 注入的回调完成，便于在 node 环境下用真实中继测试。
// - 本任务（Task 7）只实现连接核心：start/stop/send/isConnected + onInbound。
//   后续 Task 8-10 会往本文件追加 dispatcher/replayer/forwarder。
//
// 安全要点：
// - bind 信封用 deviceKey 签名（HMAC-SHA256），中继据 keyRegistry 验签身份。
//   deviceKey 本身不放进 payload 传输（payload 不携带密钥），验签只用已登记密钥。
// - 中继下发 error（unbound/bad_sig）时不清 deviceKey，仅置未连接；
//   因 server 在 bind 失败时不关连接，本端收到 error 后主动 terminate 触发 close → 退避重连。
import { WebSocket } from 'ws'
import { makeEnvelope, PROTOCOL_VERSION, type Envelope, type MessageType } from '../shared/remote-protocol'

export interface BridgeDeps {
  /** 中继 ws 基地址，如 ws://host:port 或 wss://host:port。会自动追加 /ws。 */
  relayUrl: string
  /** 本机设备 ID（配对阶段确立）。 */
  deviceId: string
  /** 本机设备密钥（base64），用于信封签名。 */
  deviceKey: string
  /** 收到对端（手机）发来的信封时调用。bind.ok/error 等控制消息不触发。 */
  onInbound: (env: Envelope) => void
}

export interface RemoteBridge {
  /** 建立连接（异步触发，不等待握手；握手完成后 isConnected 返回 true）。 */
  start(): Promise<void>
  /** 停止并禁止后续重连。 */
  stop(): Promise<void>
  /** 发送一条信封到中继；未连接时静默丢弃。 */
  send(env: Envelope): void
  /** bind 握手是否已完成。 */
  isConnected(): boolean
}

const MIN_BACKOFF = 1000
const MAX_BACKOFF = 30000

/**
 * 详细 WS 日志开关：CC_REMOTE_DEBUG 未显式置 "0" 时开启。
 * 打印连接/握手/收发/错误/重连/丢弃等全链路事件，带 [remote-ws] 前缀和毫秒时间戳。
 * 生产可设 process.env.CC_REMOTE_DEBUG=0 关闭。
 */
const REMOTE_DEBUG = process.env.CC_REMOTE_DEBUG !== '0'
function rlog(...args: unknown[]): void {
  if (!REMOTE_DEBUG) return
  const ts = new Date().toISOString()
  console.log('[remote-ws]', ts, ...args)
}
/** 精简打印信封（避免大 payload 刷屏，只显示 type/deviceId/payload 摘要）。 */
function envSummary(env: Envelope): string {
  const p = env.payload
  let pSummary: string
  try {
    const s = typeof p === 'string' ? p : JSON.stringify(p)
    pSummary = s.length > 120 ? s.slice(0, 120) + `…(+${s.length - 120})` : s
  } catch {
    pSummary = String(p)
  }
  return `type=${env.type} deviceId=${env.deviceId} payload=${pSummary}`
}

export function createRemoteBridge(deps: BridgeDeps): RemoteBridge {
  let ws: WebSocket | null = null
  let connected = false
  let stopped = false
  let backoff = MIN_BACKOFF
  let reconnectTimer: NodeJS.Timeout | null = null

  /** 拼 /ws 路径：兼容调用方传或不传结尾 /ws。 */
  function wsEndpoint(): string {
    const base = deps.relayUrl
    return base.endsWith('/ws') ? base : `${base}/ws`
  }

  function clearTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function scheduleReconnect() {
    if (stopped) return
    clearTimer()
    // 指数退避：1s → 2s → 4s → … 封顶 30s。
    // 成功 bind 后会在握手处重置回 MIN_BACKOFF。
    rlog(`scheduleReconnect: ${backoff}ms 后重试`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF)
  }

  function connect() {
    if (stopped) return
    const url = wsEndpoint()
    rlog(`connect → ${url}`)
    try {
      ws = new WebSocket(url)
    } catch (e) {
      rlog('connect 失败（URL 非法等）:', e instanceof Error ? e.message : e)
      scheduleReconnect()
      return
    }

    ws.on('open', () => {
      if (stopped || !ws) {
        rlog('open 收到但已 stopped，放弃')
        return
      }
      rlog('open ✓ 连接已建立，发送 bind 握手')
      // bind 握手：用 deviceKey 签名一条 bind 信封上报身份。
      const bind = makeEnvelope(deps.deviceKey, 'bind', deps.deviceId, {})
      ws.send(JSON.stringify(bind))
    })

    ws.on('message', (raw) => {
      let env: Envelope
      try {
        env = JSON.parse(raw.toString()) as Envelope
      } catch {
        rlog('message: 非 JSON，忽略:', raw.toString().slice(0, 80))
        return
      }
      const t = env.type as string
      if (t === 'bind.ok') {
        // 握手成功：重置退避，置连接态。
        backoff = MIN_BACKOFF
        connected = true
        rlog('bind.ok ✓ 握手成功，已连接，退避重置为', MIN_BACKOFF, 'ms')
        return
      }
      if (t === 'error') {
        // bind 被拒（unbound/bad_sig 等）：保持未连接。
        rlog('error 信封（bind 被拒或路由失败）:', envSummary(env), '→ terminate 触发重连')
        connected = false
        try { ws?.terminate() } catch { /* noop */ }
        return
      }
      // 其余均为业务信封（来自对端手机），交给注入的回调。
      rlog('← inbound 业务信封:', envSummary(env))
      try {
        deps.onInbound(env)
      } catch (e) {
        rlog('onInbound 回调异常（不影响连接）:', e instanceof Error ? e.message : e)
      }
    })

    const onGone = () => {
      rlog('close: 连接断开')
      connected = false
      if (stopped) {
        rlog('close: 已 stopped，不重连')
        return
      }
      scheduleReconnect()
    }
    ws.on('close', onGone)
    // error 事件后 ws 通常会再抛 close，这里只兜底确保 connected 清零并触发一次重连。
    ws.on('error', (err) => {
      rlog('error 事件:', err instanceof Error ? err.message : err)
      connected = false
      // 主动终止坏连接，确保 close 触发；若已在 closing 则无害。
      try { ws?.terminate() } catch { /* noop */ }
    })
  }

  return {
    async start() {
      stopped = false
      rlog(`start: deviceId=${deps.deviceId}, relayUrl=${deps.relayUrl}`)
      connect()
    },
    async stop() {
      rlog('stop: 停止连接，禁止后续重连')
      stopped = true
      clearTimer()
      const w = ws
      if (w) {
        try { w.close() } catch { /* noop */ }
        try { w.terminate() } catch { /* noop */ }
      }
      ws = null
      connected = false
    },
    send(env) {
      // 仅在握手完成且 socket 打开时发送；否则静默丢弃。
      if (ws && ws.readyState === WebSocket.OPEN && connected) {
        rlog('→ outbound:', envSummary(env))
        ws.send(JSON.stringify(env))
      } else {
        rlog('→ outbound 丢弃（未连接）:', envSummary(env))
      }
    },
    isConnected() {
      return connected
    },
  }
}

export interface DispatchDeps {
  send: (opts: { prompt: string; localSessionId?: string; modelId?: string; thinking?: 'low' | 'medium' | 'high'; cwd?: string; webContents?: any }) => Promise<void>
  interrupt: (localSessionId: string) => void
  resolveDialog: (reqId: string, result: any) => void
  /** 手机接管某会话（标记"手机在看"）。可选：当前 forwarder 转发所有会话事件，attach 仅做记录。 */
  onAttach?: (localSessionId: string) => void
  /**
   * 手机请求新建会话。返回新建会话的信息（含 localSessionId）；返回 null/undefined 表示桌面端
   * 不支持远程新建（主进程无建会话 API 时走此分支，由调用方决定如何回告手机）。
   * 可选：未注入时 dispatcher 对 session.create 不做实质处理。
   * 返回值会原样传给 onSessionCreated（不局限于 localSessionId，调用方可携带 title/cwd 等附加字段）。
   */
  onSessionCreate?: (projectId?: string) =>
    | { localSessionId: string; projectId?: string; title?: string; cwd?: string }
    | null
    | undefined
  /**
   * 新建会话成功后的回告：把 onSessionCreate 返回的会话信息经 forwarder 转 session.created
   * 下发给手机，手机端据此自动进入该会话。仅当 onSessionCreate 返回有效对象时调用。
   */
  onSessionCreated?: (info: { localSessionId: string; projectId?: string; title?: string; cwd?: string }) => void
  /**
   * 手机请求归档会话。由 index.ts 注入：关 SDK query + 清后台任务 + 标记 archived + 落盘 +
   * 通知桌面渲染端 + 推更新后的列表给手机。
   */
  onArchive?: (localSessionId: string) => void
  /**
   * 反查会话所属项目的 cwd（工作目录）。由 index.ts 注入：从 projects-store 找该会话所属项目的 path。
   * 用于 session.message 时让 SDK 在正确目录运行（否则回退 process.cwd()）。
   */
  resolveCwd?: (localSessionId: string) => string | undefined
  /**
   * 手机请求拉取会话历史。由 index.ts 注入：从 projects-store 读该会话 messages，
   * 用 toHistoryMessages 转换后经 forwarder.sendHistory 下发。
   * 可选：未注入时静默（手机端拿不到历史，不报错）。
   */
  onHistoryRequest?: (localSessionId: string, limit: number) => void
  /**
   * 手机上线/刷新后请求重推会话列表（session.sync）。
   * 由 index.ts 注入：重新读 projects-store 快照 + runningIds，经 forwarder.sendSessionList 下发。
   */
  onSync?: () => void
  /**
   * 手机切换激活模型。由 index.ts 注入：改 cc-desk-store 的 activeModelId（saveModelProvidersConfig）。
   * 之后所有 send 用新模型（resolveActiveModel 读 activeModelId）。
   */
  onSetActiveModel?: (modelId: string) => void
}

/**
 * 入站消息分发：手机→桌面的命令白名单。未知 type 静默忽略（最小特权）。
 *
 * session.attach：记录"手机在看"某会话（当前 forwarder 转发所有会话事件，attach 仅通知，
 *   不改变转发过滤——简化实现，避免漏推关键事件）。
 * session.create：主进程目前没有"建会话"API（会话由渲染端 reducer NEW_SESSION 创建，
 *   主进程 projects-store 只整体读写快照）。故 onSessionCreate 未注入时不做实质处理；
 *   注入后返回新 localSessionId。详见报告「session.create 遗留缺口」。
 */
export function createDispatcher(deps: DispatchDeps) {
  return async (env: Envelope) => {
    switch (env.type) {
      case 'session.message': {
        const p = env.payload as { localSessionId: string; text: string; modelId?: string; thinking?: 'low' | 'medium' | 'high' }
        // 反查会话所属项目的 cwd（让 SDK 在正确目录运行，否则回退到 process.cwd()）
        const cwd = deps.resolveCwd?.(p.localSessionId)
        console.warn('[remote-disp] session.message → send', p.localSessionId, p.text.slice(0, 50), 'cwd:', cwd)
        await deps.send({ prompt: p.text, localSessionId: p.localSessionId, cwd, thinking: p.thinking })
        console.warn('[remote-disp] session.message send done')
        break
      }
      case 'session.interrupt': {
        const p = env.payload as { localSessionId: string }
        deps.interrupt(p.localSessionId)
        break
      }
      case 'dialog.response': {
        const p = env.payload as { reqId: string; result: any }
        deps.resolveDialog(p.reqId, p.result)
        break
      }
      case 'session.attach': {
        const p = env.payload as { localSessionId: string }
        deps.onAttach?.(p.localSessionId)
        break
      }
      case 'session.create': {
        // 真实现：交由注入的 onSessionCreate（主进程有建会话能力时）。
        // 未注入时不 mock —— 静默忽略（最小特权），由手机端超时/缺省处理。
        // 注：signature 加 projectId 参数（从 payload 提取），手机端 create 会带 projectId。
        const c = env.payload as { projectId?: string }
        const created = deps.onSessionCreate?.(c.projectId)
        // 建会话成功：回告手机新会话信息（session.created），手机端据此自动进入会话。
        // 返回 null/undefined（不支持远程新建）时静默，不回告。
        if (created) {
          deps.onSessionCreated?.(created)
        }
        break
      }
      case 'session.archive': {
        // 手机请求归档会话：交由注入的 onArchive（关 SDK query + 清任务 + 标记 archived + 落盘 + 推列表）。
        const a = env.payload as { localSessionId: string }
        deps.onArchive?.(a.localSessionId)
        break
      }
      case 'session.history.request': {
        const p = env.payload as { localSessionId: string; limit?: number }
        deps.onHistoryRequest?.(p.localSessionId, p.limit ?? 50)
        break
      }
      case 'session.sync': {
        // 手机上线/刷新后请求重推会话列表（无需桌面 bridge 状态变化触发）。
        // 解决「web 刷新后桌面 bridge 连接未断、lastState 不变 → 不推 list」的 bug。
        deps.onSync?.()
        break
      }
      case 'session.setActiveModel': {
        // 切换激活模型：改桌面 cc-desk-store 的 activeModelId，之后所有 send 用新模型。
        const p = env.payload as { modelId: string }
        deps.onSetActiveModel?.(p.modelId)
        break
      }
      default:
        // 白名单外，静默忽略（最小特权）
        break
    }
  }
}

const DIALOG_TTL_MS = 24 * 3600_000 // 24h 兜底硬上限，防挂起请求泄漏

export interface DialogReplayer {
  /** 登记一条挂起的 dialog.request（用于断线重连后补发）。 */
  enqueue(reqId: string, env: Envelope): void
  /** 重连后按目标设备补发所有未取消/未过期的登记（deviceId 预留给路由扩展，当前广播）。 */
  replayFor(deviceId: string): void
  /** dialog 已被解决或取消时移除登记。 */
  cancel(reqId: string): void
  /** 清理超过 24h 的陈旧登记（兜底硬上限防泄漏）。 */
  cleanupExpired(): void
}

/**
 * 登记挂起的 dialog.request，断线重连后补发给手机。24h 兜底清理防泄漏。
 *
 * 协议里 dialog.request 是唯一状态化出站消息（spec §5.3）：桌面端 dialogResolvers
 * 持有 Promise，remote-bridge 额外登记一份用于重连补发。一旦手机回 dialog.response
 * 或桌面侧 cancel，即从登记中移除。
 *
 * 注：内部用 Date.now() 计算过期时间，测试可用 vi.setSystemTime 控制。
 */
export function createDialogReplayer(sendFn: (env: Envelope) => void): DialogReplayer {
  const pending = new Map<string, { env: Envelope; expiresAt: number }>()
  return {
    enqueue(reqId, env) {
      pending.set(reqId, { env, expiresAt: Date.now() + DIALOG_TTL_MS })
    },
    replayFor(_deviceId) {
      // 当前 broadcast 语义：把所有未取消/未过期的登记按入队顺序补发。
      // Map 保持插入顺序，所以重连后补发顺序与原 enqueue 一致。
      for (const { env } of pending.values()) sendFn(env)
    },
    cancel(reqId) {
      pending.delete(reqId)
    },
    cleanupExpired() {
      const now = Date.now()
      for (const [id, { expiresAt }] of pending) {
        if (now > expiresAt) pending.delete(id)
      }
    },
  }
}

export interface EventForwarderOpts {
  /** dialog.request 登记回调（用于断线重连补发）；为空时仅转发不登记。 */
  enqueueDialog?: (reqId: string, env: Envelope) => void
}

/** 待签名占位信封：sig/deviceId/ts/nonce 由 remote-bridge 的 send 统一用 makeEnvelope 重签。 */
function placeholderEnv(type: MessageType, payload: unknown): Envelope {
  return { v: PROTOCOL_VERSION, type, deviceId: '', ts: 0, nonce: '', sig: '', payload }
}

/**
 * 出站事件旁路转发（Task 10）：监听桌面 claude:* IPC 事件，转成协议消息发中继。
 *
 * 设计：forwarder 只负责「业务事件 → 协议 type/payload 映射」，产出「待签名」信封
 * （sig 等字段占位为空）。真正的签名由 remote-bridge 注入的 sendFn 完成 —— 调用方
 * 应把 sendFn 实现成「取传入 env 的 type/payload，用 makeEnvelope 重签后 bridge.send」。
 * 这样测试只需断言 type/payload 映射，不依赖密钥；线上发中继时签名仍由 deviceKey 兜底。
 *
 * 注意：dialog.request 是唯一状态化出站消息（spec §5.3）：除转发外，还须 enqueue 到
 * dialogReplayer，以便断线重连后补发给手机（手机可能在 dialog 挂起期间掉线）。
 */
export function createEventForwarder(
  sendFn: (env: Envelope) => void,
  opts: EventForwarderOpts = {},
) {
  return {
    /** claude:delta —— text/thinking 流式增量。thinking 走独立字段，便于手机端折叠展示。 */
    onClaudeDelta(data: { kind: 'text' | 'thinking'; delta: string; localSessionId: string }) {
      const payload =
        data.kind === 'thinking'
          ? { localSessionId: data.localSessionId, thinking: data.delta }
          : { localSessionId: data.localSessionId, text: data.delta }
      sendFn(placeholderEnv('session.delta', payload))
    },
    /** claude:blocks —— tool_use_start / assistant_blocks / tool_result / 计划卡片。payload 透传。 */
    onClaudeBlocks(data: unknown) {
      sendFn(placeholderEnv('session.blocks', data))
    },
    /** claude:notice —— 系统提示 info/warn/error。payload 透传。 */
    onNotice(data: unknown) {
      sendFn(placeholderEnv('session.notice', data))
    },
    /** claude:result —— query 结束。payload 透传。 */
    onResult(data: unknown) {
      sendFn(placeholderEnv('session.result', data))
    },
    /** claude:dialog-request —— 批准请求。转发 + 同步 enqueue 到 replayer 供重连补发。 */
    onDialogRequest(data: { reqId: string; localSessionId: string; dialogKind: string; payload: unknown }) {
      const env = placeholderEnv('dialog.request', data)
      opts.enqueueDialog?.(data.reqId, env)
      sendFn(env)
    },
    /** session.list —— 桌面连上中继后下发当前可远程操作的会话清单 + 项目元信息。 */
    sendSessionList(payload: { sessions: SessionListItem[]; projectsMeta: SessionListProjectMeta[] }) {
      sendFn(placeholderEnv('session.list', payload))
    },
    /** session.history —— 响应手机的历史拉取，下发转换后的历史消息。 */
    sendHistory(payload: { localSessionId: string; items: HistoryItem[]; hasMore: boolean }) {
      sendFn(placeholderEnv('session.history', payload))
    },
    /** session.models —— 下发可用模型清单 + 当前激活，手机端切换用。 */
    sendModels(payload: ModelsPayload) {
      sendFn(placeholderEnv('session.models', payload))
    },
    /** session.created —— 新建会话成功后回告手机（手机端据此自动进入该会话）。 */
    sendSessionCreated(payload: { localSessionId: string; projectId?: string; title?: string; cwd?: string }) {
      sendFn(placeholderEnv('session.created', payload))
    },
  }
}

/**
 * session.list payload 的单条会话项。
 * localSessionId 是协议路由键（与 claude:* 事件的 localSessionId 对齐）；
 * status 取运行态（running/completed/error/idle）供手机端列表区分进行中/已结束；
 * updatedAt 会话最后活动时间戳（ms），手机端展示「N 天前」。
 */
export interface SessionListItem {
  localSessionId: string
  title: string
  status: 'running' | 'completed' | 'error' | 'idle'
  updatedAt?: number
}

/** buildSessionListPayload 的输入：从 projects-store 快照抽取的字段。 */
export interface SessionListInputSession {
  id: string
  title: string
  archived?: boolean
  updatedAt?: number       // 会话最后活动时间戳（ms）
  lastUserSentAt?: number  // 用户最后发消息时间戳（ms，排序用）
}
export interface SessionListInputProject {
  id: string
  name: string
  path?: string            // 项目绝对路径
  sessions: SessionListInputSession[]
}

/** 手机端项目分组卡片需要的项目级元信息（随 session.list 下发）。 */
export interface SessionListProjectMeta {
  projectId: string
  projectName: string
  projectPath?: string
}

/**
 * 从工作区快照构造 session.list 的 payload（纯函数，可单测）。
 *
 * 设计：
 * - 扁平化所有项目的会话，每条带 projectId/projectName 便于手机端分组展示。
 * - 排除已归档会话（archived=true）—— 远程操作归档会话无意义。
 * - status：runningIds 集合命中→running，否则 idle（手机端据后续实时事件更新）。
 *   runningIds 由调用方从 claude.runningSessionIds() 注入。
 * - projectsMeta：按首次出现顺序的项目元信息（含路径），手机端渲染分组卡片用。
 *   只下发含可远程会话的项目（避免空项目刷屏）。
 */
export function buildSessionListPayload(
  projects: SessionListInputProject[],
  runningIds?: string[],
): {
  sessions: (SessionListItem & { projectId: string; projectName: string })[]
  projectsMeta: SessionListProjectMeta[]
} {
  const runningSet = new Set(runningIds ?? [])
  const sessions: (SessionListItem & { projectId: string; projectName: string })[] = []
  const projectsMeta: SessionListProjectMeta[] = []
  for (const p of projects) {
    let hasSession = false
    for (const s of p.sessions) {
      if (s.archived) continue
      sessions.push({
        localSessionId: s.id,
        title: s.title || '(未命名会话)',
        status: runningSet.has(s.id) ? 'running' : 'idle',
        updatedAt: s.updatedAt ?? s.lastUserSentAt,
        projectId: p.id,
        projectName: p.name,
      })
      hasSession = true
    }
    if (hasSession) {
      projectsMeta.push({ projectId: p.id, projectName: p.name, projectPath: p.path })
    }
  }
  return { sessions, projectsMeta }
}

// ===================== 历史对话 =====================

/** 历史消息的渲染块（精简，不含原始大对象，省带宽）。 */
export interface HistoryBlock {
  kind: 'tool_use' | 'tool_result' | 'plan'
  /** 可读标签：如 "Bash: git status"、"已批准"、"计划" */
  label: string
}

/** 历史消息项（手机端渲染用）。 */
export interface HistoryItem {
  role: 'user' | 'assistant'
  text?: string
  thinking?: string
  blocks?: HistoryBlock[]
}

/** toHistoryMessages 的输入：桌面端 ContentBlock 的子集（结构化，不依赖渲染端类型）。 */
export interface HistoryInputBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  name?: string         // tool_use 的工具名
  input?: any           // tool_use 的入参
  status?: string       // tool_use 的状态
  content?: string      // tool_result 的内容
  isError?: boolean
  planFilePath?: string // tool_use(ExitPlanMode) 的计划路径
}
export interface HistoryInputMessage {
  id: string
  role: 'user' | 'assistant'
  content: HistoryInputBlock[]
  isError?: boolean
}

/** 工具入参 → 简短可读标签（如 Bash 命令取首行、Edit 取文件名）。 */
function toolUseLabel(name: string | undefined, input: any): string {
  if (!name) return '工具调用'
  const i = input ?? {}
  // 常见工具的友好标签
  if (name === 'Bash' && typeof i.command === 'string') {
    const first = i.command.split('\n')[0].trim()
    return `Bash: ${first.slice(0, 60)}`
  }
  if ((name === 'Edit' || name === 'Write' || name === 'Read') && typeof i.file_path === 'string') {
    const base = i.file_path.split('/').pop() ?? i.file_path
    return `${name}: ${base}`
  }
  if (name === 'ExitPlanMode') return '计划批准'
  return name
}

/**
 * 把桌面端 Message[] 转成手机端历史消息（精简、可渲染、省带宽）。
 *
 * - 跳过空消息（content 全空）。
 * - tool_use 带结果时合并为一个 block（label 含状态）。
 * - ExitPlanMode（planFilePath）→ plan 块。
 * - 分页：取最后 limit 条（beforeTs 暂未用，保留扩展）；hasMore 表示是否还有更早的。
 *
 * 纯函数，可单测。
 */
export function toHistoryMessages(
  messages: HistoryInputMessage[],
  limit = 50,
): { items: HistoryItem[]; hasMore: boolean } {
  // 从后往前取 limit 条非空消息
  const nonEmpty = messages.filter((m) => m.content.some((b) => {
    if (b.type === 'text' || b.type === 'thinking') return !!b.text
    return true
  }))
  const hasMore = nonEmpty.length > limit
  const slice = hasMore ? nonEmpty.slice(-limit) : nonEmpty

  const items: HistoryItem[] = slice.map((m) => {
    // user 消息：桌面端把 user 文本也放 content[0].text
    if (m.role === 'user') {
      const texts = m.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim()
      return { role: 'user', text: texts || '(空消息)' }
    }
    // assistant：text + thinking + blocks
    const text = m.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim()
    const thinking = m.content.filter((b) => b.type === 'thinking').map((b) => b.text ?? '').join('\n').trim()
    const blocks: HistoryBlock[] = []
    for (const b of m.content) {
      if (b.type === 'tool_use') {
        if (b.planFilePath) {
          blocks.push({ kind: 'plan', label: '计划' })
        } else {
          blocks.push({ kind: 'tool_use', label: toolUseLabel(b.name, b.input) })
        }
      } else if (b.type === 'tool_result') {
        blocks.push({
          kind: 'tool_result',
          label: b.isError ? '出错' : '完成',
        })
      }
    }
    return { role: 'assistant', text: text || undefined, thinking: thinking || undefined, blocks }
  })

  return { items, hasMore }
}

// ===================== 模型清单 =====================

/** 手机端模型选择用的单条模型。 */
export interface ModelOption {
  id: string          // 模型 id（cc-desk-store 的 ModelItem.id，传回 session.message.modelId）
  name: string        // 展示名（sdkModelId）
}
/** session.models 的 payload。 */
export interface ModelsPayload {
  models: ModelOption[]
  activeModelId: string
  thinking: 'low' | 'medium' | 'high'  // 当前思考强度
}

/** buildModelsPayload 的输入：cc-desk-store 的模型配置子集。 */
export interface ModelsInput {
  models: { id: string; sdkModelId: string; enabled?: boolean }[]
  activeModelId: string
}

/**
 * 从 cc-desk-store 配置构造 session.models payload（纯函数，可单测）。
 * 只取 enabled 的模型；activeModelId 原样回传（手机端据此高亮当前）。
 * thinking 由调用方注入（桌面端当前没有全局 thinking 配置，默认 medium，后续可扩展）。
 */
export function buildModelsPayload(
  input: ModelsInput,
  thinking: 'low' | 'medium' | 'high' = 'medium',
): ModelsPayload {
  const models: ModelOption[] = (input.models ?? [])
    .filter((m) => m.enabled !== false)
    .map((m) => ({ id: m.id, name: m.sdkModelId }))
  return { models, activeModelId: input.activeModelId ?? '', thinking }
}
