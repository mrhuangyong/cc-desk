// web/src/hooks/useRelay.ts
// 手机端 PWA 中继客户端 hook（连接 / bind 握手 / 指数退避重连 / 签名）。
//
// 镜像桌面端 src/main/remote-bridge.ts 的 createRemoteBridge（手机侧）：
// - 连 {relayUrl}/ws，open 后发一条用 deviceKey 签名的 bind 信封。
// - 收到 bind.ok → connected=true 且重置退避。
// - 收到 error → connected=false，主动关连接触发重连（与桌面侧对称）。
// - 断线 → 指数退避重连（1s → 2s → … 封顶 30s）。
// - 业务信封（session.* 等）走 onInbound 回调；bind.ok/error 不触发。
//
// 协议类型从 @shared/remote-protocol 复用（单一真相源）；签名用 web/src/lib/sign
// 的 Web Crypto 实现（浏览器无 node:crypto，见 sign.ts 说明）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { PROTOCOL_VERSION, type Envelope, type MessageType } from '@shared/remote-protocol-types'
import { signEnvelope, genNonceWeb, makeSignedEnvelope } from '../lib/sign'

const MIN_BACKOFF = 1000
const MAX_BACKOFF = 30000

/**
 * 构造一个 token 模式的业务信封（Task 4：分享链接认证，不签名）。
 *
 * 中继 Task 2-fix：token 手机 bind 后 boundDeviceId = virtualId(share:xxx)，
 * 后续业务消息 env.deviceId 被 server 强制替换为 boundDeviceId，
 * 且已 bind 连接的业务消息不再重验 sig（身份由 bind 握手钉死）。
 * 故 token 模式下 sig 可留空（格式合法但无意义），无需 deviceKey 签名。
 */
export function buildTokenEnvelope(type: MessageType, payload: unknown): Envelope {
  return {
    v: PROTOCOL_VERSION,
    type,
    deviceId: '', // server 会用 boundDeviceId 覆盖
    ts: Date.now(),
    nonce: genNonceWeb(),
    sig: '', // token 模式不签名
    payload,
  }
}

/**
 * 指数退避计算（纯函数，便于单测）。
 * @param attempt 已重连次数（0 表示首次失败后第一次重连）
 * @returns delay = min(min * 2^attempt, max)
 */
export function computeBackoff(attempt: number, min: number, max: number): number {
  const raw = min * Math.pow(2, attempt)
  return Math.min(raw, max)
}

/**
 * 构造 bind 信封（未签名，sig 占位为空字符串）。
 * 签名由调用方在发送前用 signEnvelope 填充 —— 与桌面侧 remote-bridge 一致
 * （桌面侧 makeEnvelope 内部同步签名；浏览器异步，故拆成构造+异步签名两步）。
 */
export function buildBindEnvelope(deviceId: string): Envelope {
  return {
    v: PROTOCOL_VERSION,
    type: 'bind',
    deviceId,
    ts: Date.now(),
    nonce: genNonceWeb(),
    sig: '', // 占位，发送前由 signEnvelope 填充
    payload: {},
  }
}

/**
 * 构造基于分享 token 的 bind 信封（Task 4：分享链接认证）。
 *
 * 与 buildBindEnvelope 的区别：分享模式下「token 即凭证」，不签名
 * （sig 留空、deviceId 留空 —— 中继侧靠 token 校验而非设备密钥验签）。
 * 向后兼容：旧 deviceId+签名路径仍由 buildBindEnvelope + signEnvelope 提供。
 *
 * Envelope 类型本身无 token 字段，这里用扩展类型承载（中继侧读 env.token）。
 */
export interface BindTokenEnvelope extends Envelope {
  token: string
}

export function buildBindTokenEnvelope(token: string): BindTokenEnvelope {
  return {
    v: PROTOCOL_VERSION,
    type: 'bind',
    token,
    deviceId: '', // token 模式无设备身份，留空
    ts: Date.now(),
    nonce: genNonceWeb(),
    sig: '', // token 模式不签名，token 即凭证
    payload: {},
  }
}

export interface UseRelayOptions {
  /** 中继 ws 基地址，如 ws://host:port 或 wss://host:port。自动追加 /ws。 */
  relayUrl: string
  /** 手机设备 ID（配对阶段确立）。 */
  deviceId: string
  /** 设备密钥（base64），用于信封签名。 */
  deviceKey: string
  /**
   * 分享 token（Task 4：分享链接认证）。
   * 存在时走 token 模式 bind（不签名，token 即凭证），跳过旧 deviceId+签名路径。
   * 不存在时保留旧配对路径（向后兼容已配对设备）。
   */
  shareToken?: string
  /** 收到对端（桌面）发来的业务信封时调用；bind.ok/error 等控制消息不触发。 */
  onInbound?: (env: Envelope) => void
  /** WebSocket 构造器注入（测试用）；默认全局 WebSocket。 */
  WS?: typeof WebSocket
}

export interface UseRelayHandle {
  /** 是否已完成 bind 握手。 */
  connected: boolean
  /** 建立连接（异步触发，不等待握手）。幂等：重复 start 不会创建多个连接。 */
  start(): void
  /** 停止并禁止后续重连，关闭当前连接。 */
  stop(): void
  /**
   * 发送一条已签名的业务信封；未连接时静默丢弃。
   * @returns true 表示已写入 socket，false 表示丢弃（未连接）。
   */
  send(type: ClientMsgType, payload: unknown): Promise<boolean>
  /** 便捷方法：发送 session.attach。 */
  attach(localSessionId: string): Promise<boolean>
}

// 手机→桌面的业务消息白名单（控制类 bind 之外）。
type ClientMsgType = Extract<
  MessageType,
  'session.attach' | 'session.create' | 'session.archive' | 'session.message' | 'session.interrupt' | 'dialog.response' | 'session.sync' | 'session.setActiveModel' | 'session.history.request'
>

export function useRelay(opts: UseRelayOptions): UseRelayHandle {
  const { relayUrl, deviceId, deviceKey, shareToken, onInbound, WS } = opts
  const WSImpl = WS ?? WebSocket
  const [connected, setConnected] = useState(false)
  // connected 的 ref 镜像：send 闭包需要同步读到最新连接态，
  // 否则 bind.ok 的 setConnected（异步批处理）尚未 flush 时 send 会误判为未连接。
  const connectedRef = useRef(false)
  const setConn = useCallback((v: boolean) => {
    connectedRef.current = v
    setConnected(v)
  }, [])

  // 用 ref 存所有可变状态：避免重渲染时重建闭包、避免定时器泄漏。
  const wsRef = useRef<WebSocket | null>(null)
  const stoppedRef = useRef(false)
  const attemptRef = useRef(0) // 重连尝试次数，用于退避计算
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // onInbound 用 ref 持有最新值，避免把回调动进依赖导致频繁重连。
  const onInboundRef = useRef(onInbound)
  onInboundRef.current = onInbound
  // 活跃连接的代次（每次 start/重连 +1），用于回调里判断是否仍属于当前连接。
  const generationRef = useRef(0)

  const wsEndpoint = useCallback(() => {
    return relayUrl.endsWith('/ws') ? relayUrl : `${relayUrl}/ws`
  }, [relayUrl])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (stoppedRef.current) return
    clearTimer()
    const delay = computeBackoff(attemptRef.current, MIN_BACKOFF, MAX_BACKOFF)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      attemptRef.current += 1
      connect()
    }, delay)
  }, [clearTimer])

  const connect = useCallback(() => {
    if (stoppedRef.current) return
    const gen = generationRef.current
    console.warn('[useRelay] connect 尝试, endpoint=', wsEndpoint(), 'deviceId=', deviceId.slice(0, 8), 'gen=', gen)
    let ws: WebSocket
    try {
      ws = new WSImpl(wsEndpoint())
    } catch (e) {
      console.warn('[useRelay] new WebSocket 抛错:', e)
      // URL 非法等：直接排重连
      scheduleReconnect()
      return
    }
    wsRef.current = ws

    ws.addEventListener('open', () => {
      if (stoppedRef.current || generationRef.current !== gen) return
      console.warn('[useRelay] WS open, 发 bind...', shareToken ? '(token 模式)' : '(签名模式)')
      // bind 握手分两路径（Task 4：分享链接认证）：
      // - token 模式：shareToken 存在 → 发带 token 的 bind 信封，不签名（token 即凭证）。
      // - 旧路径：无 token → 构造信封后异步签名（deviceId + deviceKey），向后兼容已配对设备。
      if (shareToken) {
        const env = buildBindTokenEnvelope(shareToken)
        if (ws.readyState === WebSocket.OPEN) {
          console.warn('[useRelay] bind(token) 发送, readyState=', ws.readyState)
          ws.send(JSON.stringify(env))
        } else {
          console.warn('[useRelay] bind(token) 未发: readyState 不是 OPEN(', ws.readyState, ')')
        }
        return
      }
      const env = buildBindEnvelope(deviceId)
      void signEnvelope(deviceKey, env).then((sig) => {
        if (stoppedRef.current || generationRef.current !== gen) return
        env.sig = sig
        if (ws.readyState === WebSocket.OPEN) {
          console.warn('[useRelay] bind 发送, readyState=', ws.readyState)
          ws.send(JSON.stringify(env))
        } else {
          console.warn('[useRelay] bind 未发: readyState 不是 OPEN(', ws.readyState, ')')
        }
      })
    })

    ws.addEventListener('close', (ev) => {
      console.warn('[useRelay] WS close, code=', (ev as any).code, 'reason=', (ev as any).reason, 'gen=', gen)
    })
    ws.addEventListener('error', (ev) => {
      console.warn('[useRelay] WS error', ev)
    })

    ws.addEventListener('message', (event) => {
      if (generationRef.current !== gen) return
      let env: any
      try {
        // 兼容 MessageEvent.data 是 string 或 {data} 包裹（测试 FakeWebSocket 传 {data}）。
        const raw = typeof event === 'string' ? event : (event as any).data
        env = JSON.parse(raw)
      } catch {
        return
      }
      const t = env.type as string
      console.warn('[useRelay] recv msg type=', t)
      if (t === 'bind.ok') {
        // 握手成功：重置退避，置连接态。
        console.warn('[useRelay] bind.ok 收到, 连接成功!')
        attemptRef.current = 0
        setConn(true)
        connectedRef.current = true
        // 上线后主动请求重推会话列表（session.sync）。
        // 修复「web 刷新后桌面 bridge 连接未断、不重推 list」的 bug：由手机主动拉，
        // 不依赖桌面检测到状态变化。直接 ws.send（不等 setConn flush，避免时序问题）。
        // token 模式无 deviceKey，用不签名信封；旧模式用签名信封。
        try {
          if (shareToken) {
            const sync = buildTokenEnvelope('session.sync', {})
            ws.send(JSON.stringify(sync))
          } else {
            makeSignedEnvelope(deviceKey, 'session.sync', deviceId, {}).then((sync) => {
              ws.send(JSON.stringify(sync))
            })
          }
        } catch { /* noop */ }
        return
      }
      if (t === 'error') {
        // bind 被拒（unbound/bad_sig）：保持未连接，主动关连接触发重连
        // （与桌面侧对称：server 在 bind 失败时只回 error 不关连接，需本端主动关）。
        setConn(false)
        try { ws.close() } catch { /* noop */ }
        return
      }
      // 其余为业务信封（来自对端桌面），交给回调。
      try {
        // 调试日志：确认收到业务信封
        console.warn('[useRelay] recv', env.type)
        onInboundRef.current?.(env as Envelope)
      } catch {
        // 回调异常不应影响连接稳定性
      }
    })

    const onGone = () => {
      if (generationRef.current !== gen) return
      setConn(false)
      if (stoppedRef.current) return
      scheduleReconnect()
    }
    ws.addEventListener('close', onGone)
    ws.addEventListener('error', () => {
      if (generationRef.current !== gen) return
      setConn(false)
      // 兜底：error 后通常跟 close，这里确保坏连接被关掉以触发 close。
      try { ws.close() } catch { /* noop */ }
    })
  }, [WSImpl, wsEndpoint, deviceId, deviceKey, shareToken, scheduleReconnect])

  const start = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return // 幂等：已有活跃连接
    }
    stoppedRef.current = false
    generationRef.current += 1
    connect()
  }, [connect])

  const stop = useCallback(() => {
    stoppedRef.current = true
    generationRef.current += 1 // 让所有挂起回调失效
    clearTimer()
    const ws = wsRef.current
    if (ws) {
      try { ws.close() } catch { /* noop */ }
    }
    wsRef.current = null
    setConn(false)
  }, [clearTimer])

  const send = useCallback(async (type: ClientMsgType, payload: unknown): Promise<boolean> => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !connectedRef.current) {
      return false // 未连接静默丢弃（与桌面 remote-bridge.send 一致语义）
    }
    // Task 4：token 模式不签名（已 bind 连接业务消息不重验 sig），旧模式签名。
    const env = shareToken
      ? buildTokenEnvelope(type, payload)
      : await makeSignedEnvelope(deviceKey, type, deviceId, payload)
    ws.send(JSON.stringify(env))
    return true
  }, [deviceKey, deviceId, shareToken])

  const attach = useCallback((localSessionId: string) => {
    return send('session.attach', { localSessionId })
  }, [send])

  // unmount 时清理：关闭连接、清定时器、禁止重连（防泄漏）。
  useEffect(() => {
    return () => {
      stoppedRef.current = true
      generationRef.current += 1
      clearTimer()
      const ws = wsRef.current
      if (ws) {
        try { ws.close() } catch { /* noop */ }
      }
      wsRef.current = null
    }
  }, [clearTimer])

  return { connected, start, stop, send, attach }
}
