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
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF)
  }

  function connect() {
    if (stopped) return
    try {
      ws = new WebSocket(wsEndpoint())
    } catch {
      // URL 非法等：直接排重连
      scheduleReconnect()
      return
    }

    ws.on('open', () => {
      if (stopped || !ws) return
      // bind 握手：用 deviceKey 签名一条 bind 信封上报身份。
      // payload 留空对象：server 验签整条信封，不读 payload 内容；
      // 密钥只存在于签名计算，不随 payload 传输。
      const bind = makeEnvelope(deps.deviceKey, 'bind', deps.deviceId, {})
      ws.send(JSON.stringify(bind))
    })

    ws.on('message', (raw) => {
      let env: Envelope
      try {
        env = JSON.parse(raw.toString()) as Envelope
      } catch {
        return // 非 JSON 直接忽略
      }
      const t = env.type as string
      if (t === 'bind.ok') {
        // 握手成功：重置退避，置连接态。
        // 注：'bind.ok' 是中继 wsWss 下发的控制消息，未在 MessageType 联合中声明，
        // 故此处用字符串比较而非字面量类型比较。
        backoff = MIN_BACKOFF
        connected = true
        return
      }
      if (t === 'error') {
        // bind 被拒（unbound/bad_sig 等）：保持未连接。
        // 重要：server 在 bind 失败时只回 error 信封、不主动关连接（见 server.ts wsWss 分支），
        // 所以 ws.on('close') 不会自然触发。这里必须主动 terminate，让 close 事件被触发，
        // 进而走 onGone → scheduleReconnect，否则退避重连链路死锁（Important-1 修复）。
        // 不清密钥/不 fatal——可能是中继临时重启且 keyRegistry 尚未持久化恢复。
        connected = false
        try { ws?.terminate() } catch { /* noop */ }
        return
      }
      // 其余均为业务信封（来自对端手机），交给注入的回调。
      try {
        deps.onInbound(env)
      } catch {
        // 回调异常不应影响连接稳定性
      }
    })

    const onGone = () => {
      connected = false
      if (stopped) return
      scheduleReconnect()
    }
    ws.on('close', onGone)
    // error 事件后 ws 通常会再抛 close，这里只兜底确保 connected 清零并触发一次重连。
    ws.on('error', () => {
      connected = false
      // 主动终止坏连接，确保 close 触发；若已在 closing 则无害。
      try { ws?.terminate() } catch { /* noop */ }
    })
  }

  return {
    async start() {
      stopped = false
      connect()
    },
    async stop() {
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
      // 调用方（dispatcher/replayer）负责自己的重试/排队，本层不做缓冲。
      if (ws && ws.readyState === WebSocket.OPEN && connected) {
        ws.send(JSON.stringify(env))
      }
    },
    isConnected() {
      return connected
    },
  }
}

export interface DispatchDeps {
  send: (opts: { prompt: string; localSessionId?: string; webContents?: any }) => Promise<void>
  interrupt: (localSessionId: string) => void
  resolveDialog: (reqId: string, result: any) => void
}

/** 入站消息分发：手机→桌面的命令白名单。未知 type 静默忽略（最小特权）。 */
export function createDispatcher(deps: DispatchDeps) {
  return async (env: Envelope) => {
    switch (env.type) {
      case 'session.message': {
        const p = env.payload as { localSessionId: string; text: string }
        await deps.send({ prompt: p.text, localSessionId: p.localSessionId })
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
      case 'session.attach':
      case 'session.create':
        // TODO Task 10: 会话清单/接管/新建
        break
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
  }
}
