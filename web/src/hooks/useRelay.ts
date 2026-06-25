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

export interface UseRelayOptions {
  /** 中继 ws 基地址，如 ws://host:port 或 wss://host:port。自动追加 /ws。 */
  relayUrl: string
  /** 手机设备 ID（配对阶段确立）。 */
  deviceId: string
  /** 设备密钥（base64），用于信封签名。 */
  deviceKey: string
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
  'session.attach' | 'session.create' | 'session.message' | 'session.interrupt' | 'dialog.response'
>

export function useRelay(opts: UseRelayOptions): UseRelayHandle {
  const { relayUrl, deviceId, deviceKey, onInbound, WS } = opts
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
    let ws: WebSocket
    try {
      ws = new WSImpl(wsEndpoint())
    } catch {
      // URL 非法等：直接排重连
      scheduleReconnect()
      return
    }
    wsRef.current = ws

    ws.addEventListener('open', () => {
      if (stoppedRef.current || generationRef.current !== gen) return
      // bind 握手：构造信封后异步签名再发送。
      // payload 留空对象：中继只验整条信封签名，不读 payload；密钥只存在于签名计算。
      const env = buildBindEnvelope(deviceId)
      void signEnvelope(deviceKey, env).then((sig) => {
        if (stoppedRef.current || generationRef.current !== gen) return
        env.sig = sig
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env))
      })
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
      if (t === 'bind.ok') {
        // 握手成功：重置退避，置连接态。
        attemptRef.current = 0
        setConn(true)
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
  }, [WSImpl, wsEndpoint, deviceId, deviceKey, scheduleReconnect])

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
    // 构造已签名信封再发送。复用 buildBindEnvelope 的同款构造模式：先填占位再异步签名。
    const env = await makeSignedEnvelope(deviceKey, type, deviceId, payload)
    ws.send(JSON.stringify(env))
    return true
  }, [deviceKey, deviceId])

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
