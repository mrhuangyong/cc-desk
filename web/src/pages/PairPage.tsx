// web/src/pages/PairPage.tsx
// 手机端 PWA 配对页（Task 13）。
//
// 流程：
// 1. 启动时读 URL ?pair=code（扫码直达），自动填入输入框。
// 2. 用户确认 / 手动输码后，真实 WSS 连中继 /pair 端点，
//    发 { type:'pair.consume', deviceId, code, deviceKey }（手机上报自身 deviceKey）。
// 3. 收到 pair.success → 本地存手机身份 {deviceId, deviceKey} + 桌面身份 {desktopId, desktopKey}，
//    调 onPaired 回调跳转。
// 4. 收到 error / bad_pair_code → 提示并允许重试。
//
// 真实现（非 mock）：
// - 中继连接用真实 WebSocket（不 stub）；WSS/WS 协议跟随页面协议。
// - 设备身份用 Web Crypto 真随机生成。
// - 中继地址：VITE_RELAY_URL 优先，否则同源（与 App.tsx 一致）。
//
// 传输层为何不走 useRelay：useRelay 是 /ws + bind 握手（已配对设备的常驻转发连接），
// 配对阶段是 /pair 一次性短连接、不发签名信封，是不同端点不同协议，故独立实现。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  parsePairCodeFromUrl,
  buildPairConsumeMessage,
  isPairSuccess,
  extractPairSuccess,
  isPairError,
  generateDeviceId,
  generateDeviceKey,
  saveDeviceIdentity,
  saveDesktopIdentity,
  loadDeviceIdentity,
} from '../lib/pair'

export type PairStatus = 'idle' | 'pairing' | 'success' | 'error'

export interface PairPageProps {
  /** 配对成功后回调（父组件据此切换到会话列表页）。 */
  onPaired?: (desktopId: string) => void
  /** 可选：注入 WebSocket 构造器（测试隔离传输用）；默认全局 WebSocket。 */
  WS?: typeof WebSocket
  /** 可选：覆盖中继基址；默认 VITE_RELAY_URL 或同源。 */
  relayUrl?: string
  /** 可选：覆盖初始 URL（测试用）；默认 location.href。 */
  initialUrl?: string
  /** header 右侧额外控件（主题切换等）。 */
  headerExtra?: React.ReactNode
}

const CODE_RE = /^\d{6}$/

export default function PairPage(props: PairPageProps) {
  const { onPaired, WS, relayUrl, initialUrl, headerExtra } = props
  const WSImpl = WS ?? WebSocket

  const relayBase =
    relayUrl ??
    import.meta.env.VITE_RELAY_URL ??
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

  // 启动时从 URL 解析 pair 码（扫码直达场景）。
  const [code, setCode] = useState(() => {
    const u = initialUrl ?? (typeof location !== 'undefined' ? location.href : '')
    return parsePairCodeFromUrl(u) ?? ''
  })
  const [status, setStatus] = useState<PairStatus>('idle')
  const [errMsg, setErrMsg] = useState<string>('')
  const wsRef = useRef<WebSocket | null>(null)

  // 扫码场景：URL 带了合法 6 位码时自动发起配对。
  useEffect(() => {
    if (CODE_RE.test(code) && status === 'idle') {
      void doPair(code)
    }
    // 仅初始挂载时触发一次自动配对；后续用户手动点按钮。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 卸载清理 ws（防泄漏）。
  useEffect(() => {
    return () => {
      const ws = wsRef.current
      if (ws) {
        try { ws.close() } catch { /* noop */ }
        wsRef.current = null
      }
    }
  }, [])

  const doPair = useCallback(
    async (codeVal: string) => {
      if (!CODE_RE.test(codeVal)) {
        setErrMsg('配对码必须是 6 位数字')
        setStatus('error')
        return
      }
      setStatus('pairing')
      setErrMsg('')

      // 设备身份：复用已生成的（防刷新即换身份），否则现生成。
      let identity = loadDeviceIdentity()
      if (!identity) {
        identity = { deviceId: generateDeviceId(), deviceKey: generateDeviceKey() }
      }
      const { deviceId, deviceKey } = identity

      const endpoint = relayBase.endsWith('/pair') ? relayBase : `${relayBase}/pair`

      let ws: WebSocket
      try {
        ws = new WSImpl(endpoint)
      } catch {
        setErrMsg('无法连接中继')
        setStatus('error')
        return
      }
      wsRef.current = ws

      // 超时兜底：10s 无响应判失败（避免用户卡在 pairing 态）。
      const timer = setTimeout(() => {
        try { ws.close() } catch { /* noop */ }
        setErrMsg('配对超时，请重试')
        setStatus('error')
      }, 10_000)

      ws.addEventListener('open', () => {
        const msg = buildPairConsumeMessage(deviceId, codeVal, deviceKey)
        ws.send(JSON.stringify(msg))
      })

      ws.addEventListener('message', (event) => {
        let resp: any
        try {
          const raw = typeof event === 'string' ? event : (event as any).data
          resp = JSON.parse(raw)
        } catch {
          return
        }
        if (isPairSuccess(resp)) {
          clearTimeout(timer)
          const desk = extractPairSuccess(resp)!
          // 持久化：手机自身身份 + 已配对桌面身份。
          saveDeviceIdentity(deviceId, deviceKey)
          saveDesktopIdentity(desk.desktopId, desk.desktopKey)
          setStatus('success')
          onPaired?.(desk.desktopId)
          try { ws.close() } catch { /* noop */ }
        } else if (isPairError(resp)) {
          clearTimeout(timer)
          setErrMsg('配对码无效或已过期，请在桌面端重新生成')
          setStatus('error')
          try { ws.close() } catch { /* noop */ }
        }
      })

      ws.addEventListener('error', () => {
        clearTimeout(timer)
        setErrMsg('中继连接错误')
        setStatus('error')
      })

      ws.addEventListener('close', () => {
        clearTimeout(timer)
        // 仅在仍 pairing 态时降级为 error（success 已自行 close）。
        setStatus((s) => (s === 'pairing' ? 'error' : s))
      })
    },
    [WSImpl, relayBase, onPaired],
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void doPair(code.trim())
  }

  const disabled = status === 'pairing'

  return (
    <div className="pair-page">
      {headerExtra && (
        <div style={{ position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', right: 16 }}>
          {headerExtra}
        </div>
      )}
      <header className="pair-header">
        <div className="pair-logo">⌘</div>
        <h1>cc-desk</h1>
        <p className="pair-subtitle">远程控制配对</p>
      </header>

      <form className="pair-form" onSubmit={handleSubmit}>
        <label className="pair-label" htmlFor="pair-code">
          配对码
        </label>
        <input
          id="pair-code"
          className="pair-input"
          type="input"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="off"
          placeholder="6 位数字"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={disabled}
          autoFocus
        />

        <button className="pair-btn" type="submit" disabled={disabled || !CODE_RE.test(code)}>
          {status === 'pairing' ? '配对中…' : '配对'}
        </button>
      </form>

      {status === 'success' && (
        <p className="pair-tip ok">配对成功，正在跳转…</p>
      )}
      {status === 'error' && errMsg && (
        <p className="pair-tip err">{errMsg}</p>
      )}

      <p className="pair-hint">
        打开桌面端 cc-desk → 设置 → 远程控制，点击「生成配对码」后扫码或手动输入。
      </p>
    </div>
  )
}
