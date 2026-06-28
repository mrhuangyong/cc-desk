// web/src/hooks/useRelay.test.ts
// useRelay hook 单元测试。
//
// 测试边界（Musk Algorithm：删除不可测的、只测真实可测的）：
// - WebSocket 连接本身依赖真实 ws server，放 e2e（后续任务），这里不 mock。
// - 可测纯逻辑：退避计算 computeBackoff、bind 信封构造 buildBindEnvelope、
//   签名 signEnvelope（用 Web Crypto 真算 HMAC，非 mock）。
// - hook 行为：bind.ok 后 connected=true、断线后退避递增、stop 后不再重连——
//   通过注入可控的 WebSocket 工厂 + 假时间/定时器驱动（不 mock 协议，只隔离传输）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeBackoff, buildBindEnvelope, buildBindTokenEnvelope, buildTokenEnvelope } from './useRelay'
import { signEnvelope, verifyEnvelopeSig } from '../lib/sign'
import { PROTOCOL_VERSION } from '../../../src/shared/remote-protocol'

// 一把固定的 base64 32 字节密钥，让签名可复现校验（非 mock：是真实可用密钥）。
const DEVICE_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
const DEVICE_ID = 'phone-test-1'

describe('computeBackoff 指数退避', () => {
  it('从 1000ms 起步，每次翻倍', () => {
    expect(computeBackoff(0, 1000, 30000)).toBe(1000)
    expect(computeBackoff(1, 1000, 30000)).toBe(2000)
    expect(computeBackoff(2, 1000, 30000)).toBe(4000)
    expect(computeBackoff(3, 1000, 30000)).toBe(8000)
  })

  it('封顶在 maxBackoff', () => {
    expect(computeBackoff(10, 1000, 30000)).toBe(30000)
    expect(computeBackoff(20, 1000, 30000)).toBe(30000)
  })

  it('attempt 为 0 时返回 min', () => {
    expect(computeBackoff(0, 1000, 30000)).toBe(1000)
  })
})

describe('buildBindEnvelope 构造 bind 信封', () => {
  it('返回协议 v=PROTOCOL_VERSION、type=bind、deviceId 来自参数', () => {
    const env = buildBindEnvelope(DEVICE_ID)
    expect(env.v).toBe(PROTOCOL_VERSION)
    expect(env.type).toBe('bind')
    expect(env.deviceId).toBe(DEVICE_ID)
    expect(env.payload).toEqual({})
  })

  it('ts 为正数毫秒时间戳，nonce 非空字符串', () => {
    const env = buildBindEnvelope(DEVICE_ID)
    expect(typeof env.ts).toBe('number')
    expect(env.ts).toBeGreaterThan(0)
    expect(typeof env.nonce).toBe('string')
    expect(env.nonce.length).toBeGreaterThan(0)
  })

  it('每次调用 nonce 不同（防重放）', () => {
    const a = buildBindEnvelope(DEVICE_ID)
    const b = buildBindEnvelope(DEVICE_ID)
    expect(a.nonce).not.toBe(b.nonce)
  })

  it('sig 字段为空字符串（占位，由签名层在发送前填充）', () => {
    const env = buildBindEnvelope(DEVICE_ID)
    expect(env.sig).toBe('')
  })
})

describe('buildBindTokenEnvelope 构造 token 模式 bind 信封（Task 4）', () => {
  it('返回 type=bind、token 来自参数、deviceId 为空（token 即凭证）', () => {
    const env = buildBindTokenEnvelope('share-tok')
    expect(env.type).toBe('bind')
    expect(env.token).toBe('share-tok')
    expect(env.deviceId).toBe('') // token 模式无设备身份
    expect(env.v).toBe(PROTOCOL_VERSION)
    expect(env.payload).toEqual({})
  })

  it('sig 为空（token 模式不签名）', () => {
    const env = buildBindTokenEnvelope('tok')
    expect(env.sig).toBe('')
  })

  it('ts 为正数毫秒时间戳，nonce 非空', () => {
    const env = buildBindTokenEnvelope('tok')
    expect(env.ts).toBeGreaterThan(0)
    expect(env.nonce.length).toBeGreaterThan(0)
  })

  it('每次调用 nonce 不同（防重放）', () => {
    expect(buildBindTokenEnvelope('t').nonce).not.toBe(buildBindTokenEnvelope('t').nonce)
  })
})

describe('buildTokenEnvelope 构造 token 模式业务信封（Task 4）', () => {
  it('返回 type/payload 来自参数，deviceId/sig 为空', () => {
    const env = buildTokenEnvelope('session.sync', { foo: 1 })
    expect(env.type).toBe('session.sync')
    expect(env.payload).toEqual({ foo: 1 })
    expect(env.deviceId).toBe('')
    expect(env.sig).toBe('')
    expect(env.v).toBe(PROTOCOL_VERSION)
  })

  it('nonce 每次不同', () => {
    const a = buildTokenEnvelope('session.sync', {})
    const b = buildTokenEnvelope('session.sync', {})
    expect(a.nonce).not.toBe(b.nonce)
  })
})

describe('signEnvelope / verifyEnvelopeSig（Web Crypto 真实 HMAC）', () => {
  it('signEnvelope 返回 base64 字符串', async () => {
    const env = buildBindEnvelope(DEVICE_ID)
    const sig = await signEnvelope(DEVICE_KEY, env)
    expect(typeof sig).toBe('string')
    // base64 字符集
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it('verifyEnvelopeSig 对正确签名返回 true', async () => {
    const env = buildBindEnvelope(DEVICE_ID)
    env.sig = await signEnvelope(DEVICE_KEY, env)
    expect(await verifyEnvelopeSig(DEVICE_KEY, env)).toBe(true)
  })

  it('verifyEnvelopeSig 对错误密钥签名返回 false', async () => {
    const env = buildBindEnvelope(DEVICE_ID)
    env.sig = await signEnvelope(DEVICE_KEY, env)
    const wrongKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    expect(await verifyEnvelopeSig(wrongKey, env)).toBe(false)
  })

  it('签名与输入 ts/nonce/payload 绑定：改 payload 后验签失败', async () => {
    const env = buildBindEnvelope(DEVICE_ID)
    env.sig = await signEnvelope(DEVICE_KEY, env)
    env.payload = { tampered: true }
    expect(await verifyEnvelopeSig(DEVICE_KEY, env)).toBe(false)
  })

  it('相同输入产生相同签名（确定性）', async () => {
    const env = buildBindEnvelope(DEVICE_ID)
    const a = await signEnvelope(DEVICE_KEY, env)
    const b = await signEnvelope(DEVICE_KEY, env)
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// hook 行为测试：用 fake timers + 可注入的 WebSocket 工厂驱动状态机。
// 不 mock 协议（bind 信封真实构造、签名真实计算），只隔离传输层。
// ---------------------------------------------------------------------------
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  url: string
  closed = false

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  addEventListener(ev: string, cb: (...args: unknown[]) => void) {
    (this.listeners[ev] ||= []).push(cb)
  }
  removeEventListener(ev: string, cb: (...args: unknown[]) => void) {
    this.listeners[ev] = (this.listeners[ev] || []).filter((c) => c !== cb)
  }
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true; this.readyState = FakeWebSocket.CLOSED; this._emit('close', {}) }
  // 测试驱动用：模拟服务端发来一条消息
  emitMessage(env: unknown) { this._emit('message', { data: JSON.stringify(env) }) }
  emitOpen() { this._emit('open', {}) }
  emitClose() { this.readyState = FakeWebSocket.CLOSED; this._emit('close', {}) }
  private _emit(ev: string, payload: unknown) {
    for (const cb of this.listeners[ev] || []) cb(payload)
  }
}

import { renderHook, act } from '@testing-library/react'
import { useRelay } from './useRelay'

describe('useRelay hook', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('start 后打开到 relayUrl/ws 并发送签名的 bind 信封', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    // 连接已创建
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe('ws://relay.test/ws')

    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen() })

    await vi.waitFor(() => {
      expect(ws.sent).toHaveLength(1)
    })
    const env = JSON.parse(ws.sent[0])
    expect(env.type).toBe('bind')
    expect(env.deviceId).toBe(DEVICE_ID)
    // 签名非空且合法
    expect(env.sig).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(await verifyEnvelopeSig(DEVICE_KEY, env)).toBe(true)
  })

  it('收到 bind.ok 后 connected=true', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    expect(result.current.connected).toBe(true)
  })

  it('收到 error 后 connected=false', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    expect(result.current.connected).toBe(true)
    act(() => { ws.emitMessage({ type: 'error', payload: { code: 'bad_sig' } }) })
    expect(result.current.connected).toBe(false)
  })

  it('断线后按指数退避重连（连续失败 1s → 2s）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    let ws = FakeWebSocket.instances[0]
    // 第一次失败：open 后不回 bind.ok（模拟 bind 失败/连接异常），直接断开
    act(() => { ws.emitOpen(); ws.emitClose() })

    // 首次重连退避 1s（attempt 0）
    act(() => { vi.advanceTimersByTime(1000) })
    expect(FakeWebSocket.instances).toHaveLength(2)
    ws = FakeWebSocket.instances[1]
    // 第二次失败：退避应 2s（attempt 1）
    act(() => { ws.emitOpen(); ws.emitClose() })
    act(() => { vi.advanceTimersByTime(1999) })
    expect(FakeWebSocket.instances).toHaveLength(2) // 还没到 2s，未重连
    act(() => { vi.advanceTimersByTime(1) })
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('bind.ok 成功后退避重置为最小值', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    let ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    // 断一次再连成功
    act(() => { ws.emitClose() })
    act(() => { vi.advanceTimersByTime(1000) })
    ws = FakeWebSocket.instances[1]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    // 成功后再断，退避应回到 1s（证明被重置）
    act(() => { ws.emitClose() })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('stop 后不再重连', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    act(() => { result.current.stop() })
    expect(ws.closed).toBe(true)
    // 推进很久也不应重连
    act(() => { vi.advanceTimersByTime(60000) })
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('send 在未连接时静默丢弃', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen() }) // 只 open，未 bind.ok
    const before = ws.sent.length
    act(() => { result.current.send('session.message', { text: 'hi' }) })
    expect(ws.sent.length).toBe(before) // 未 bind，丢弃
  })

  it('send 在已连接时发送带签名的信封', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    expect(result.current.connected).toBe(true)
    // bind.ok 后发两条：bind（握手）+ session.sync（上线请求重推列表）
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(2) })
    let sentOk = false
    await act(async () => { sentOk = await result.current.send('session.message', { localSessionId: 's1', text: 'hi' }) })
    expect(sentOk).toBe(true)
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(3) })
    const env = JSON.parse(ws.sent[2])
    expect(env.type).toBe('session.message')
    expect(env.payload).toEqual({ localSessionId: 's1', text: 'hi' })
    expect(await verifyEnvelopeSig(DEVICE_KEY, env)).toBe(true)
  })

  it('attach 发送 session.attach 类型信封', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(2) }) // bind + session.sync
    await act(async () => { await result.current.attach('session-abc') })
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(3) })
    const env = JSON.parse(ws.sent[2])
    expect(env.type).toBe('session.attach')
    expect(env.payload).toEqual({ localSessionId: 'session-abc' })
  })

  it('收到业务信封时触发 onInbound 回调', async () => {
    vi.useFakeTimers()
    const onInbound = vi.fn()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket, onInbound }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    const biz = { v: PROTOCOL_VERSION, type: 'session.delta', deviceId: 'desktop-1', ts: Date.now(), nonce: 'n1', sig: 'x', payload: { text: 'hello' } }
    act(() => { ws.emitMessage(biz) })
    expect(onInbound).toHaveBeenCalledWith(biz)
  })

  it('unmount 后清理：不再重连、定时器清空', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { result, unmount } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    unmount()
    act(() => { vi.advanceTimersByTime(60000) })
    expect(FakeWebSocket.instances).toHaveLength(1) // 无新增重连
  })

  // -------------------------------------------------------------------------
  // Task 4：分享 token 模式 —— bind 不签名（token 即凭证），业务消息也不签名。
  // -------------------------------------------------------------------------
  it('token 模式：start 后发送带 token 的 bind 信封（sig 为空，不签名）', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, shareToken: 'SHARE_TOK', WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    expect(FakeWebSocket.instances).toHaveLength(1)
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen() })
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(1) })
    const env = JSON.parse(ws.sent[0])
    expect(env.type).toBe('bind')
    expect(env.token).toBe('SHARE_TOK')
    expect(env.deviceId).toBe('') // token 模式无设备身份
    expect(env.sig).toBe('')     // 不签名
  })

  it('token 模式：bind.ok 后 session.sync 不签名（sig 为空）', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, shareToken: 'TOK', WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    expect(result.current.connected).toBe(true)
    // bind(token) + session.sync 两条
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(2) })
    const syncEnv = JSON.parse(ws.sent[1])
    expect(syncEnv.type).toBe('session.sync')
    expect(syncEnv.sig).toBe('') // token 模式不签名
  })

  it('token 模式：send 业务消息不签名', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, shareToken: 'TOK', WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(2) }) // bind + sync
    let sentOk = false
    await act(async () => { sentOk = await result.current.send('session.message', { text: 'hi' }) })
    expect(sentOk).toBe(true)
    await vi.waitFor(() => { expect(ws.sent).toHaveLength(3) })
    const env = JSON.parse(ws.sent[2])
    expect(env.type).toBe('session.message')
    expect(env.payload).toEqual({ text: 'hi' })
    expect(env.sig).toBe('') // token 模式不签名
  })

  it('token 模式：收到 error 后 connected=false（与旧模式对称）', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useRelay({ relayUrl: 'ws://relay.test', deviceId: DEVICE_ID, deviceKey: DEVICE_KEY, shareToken: 'TOK', WS: FakeWebSocket as unknown as typeof WebSocket }),
    )
    act(() => { result.current.start() })
    const ws = FakeWebSocket.instances[0]
    act(() => { ws.emitOpen(); ws.emitMessage({ type: 'bind.ok' }) })
    expect(result.current.connected).toBe(true)
    act(() => { ws.emitMessage({ type: 'error', payload: { code: 'invalid_token' } }) })
    expect(result.current.connected).toBe(false)
  })
})
