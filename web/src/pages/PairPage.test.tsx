// web/src/pages/PairPage.test.tsx
// PairPage 组件测试。
//
// 测试边界（Musk Algorithm）：
// - 协议不 mock：用真实 Web Crypto 生成的身份、真实的中继消息格式、真实 localStorage。
// - 传输隔离：注入可控 FakeWebSocket，模拟中继 /pair 的 open/message/close/error，
//   避免依赖真实 ws server（那是 e2e 范畴）。
// - 验证：扫码自动触发、输码手动触发、pair.success 后持久化 + onPaired、
//   bad_pair_code 错误提示、超时降级。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import PairPage from './PairPage'
import {
  loadDeviceIdentity,
  loadDesktopIdentity,
  clearPairingStorage,
} from '../lib/pair'

// ---------- FakeWebSocket：可控的中继传输替身 ----------
// 仅模拟 ws 的事件分发与 send 捕获，不 mock 协议消息格式。
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static last() { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1] }
  static reset() { FakeWebSocket.instances = [] }

  readyState = 0 // CONNECTING
  url: string
  listeners: Record<string, ((e: any) => void)[]> = {}
  sent: any[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: string, cb: (e: any) => void) {
    (this.listeners[type] ||= []).push(cb)
  }
  removeEventListener(type: string, cb: (e: any) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== cb)
  }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3; this.emit('close') }

  // 测试驱动方法
  emit(type: string, e?: any) {
    (this.listeners[type] || []).forEach((cb) => cb(e ?? {}))
  }
  open() { this.readyState = 1; this.emit('open') }
  message(data: any) { this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }) }
}

beforeEach(() => {
  FakeWebSocket.reset()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PairPage 配对页', () => {
  it('初始渲染：渲染标题与配对输入框', () => {
    render(<PairPage initialUrl="" WS={FakeWebSocket as any} />)
    expect(screen.getByText('cc-desk')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('6 位数字')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '配对' })).toBeDisabled()
  })

  it('从 URL ?pair= 自动填入并自动发起配对', async () => {
    const onPaired = vi.fn()
    render(<PairPage initialUrl="https://ccdesk.mrhua.top/?pair=123456" WS={FakeWebSocket as any} onPaired={onPaired} />)

    // 自动发起：ws 已建立
    await waitFor(() => expect(FakeWebSocket.last()).toBeTruthy())
    expect(FakeWebSocket.last().url).toMatch(/\/pair$/)

    // 输入框被预填
    expect((screen.getByPlaceholderText('6 位数字') as HTMLInputElement).value).toBe('123456')

    // 模拟中继 open 后手机应发 pair.consume
    FakeWebSocket.last().open()
    expect(FakeWebSocket.last().sent[0]).toMatchObject({
      type: 'pair.consume',
      code: '123456',
    })
    expect(FakeWebSocket.last().sent[0].deviceId).toBeTruthy()
    expect(FakeWebSocket.last().sent[0].deviceKey).toBeTruthy()
  })

  it('手动输入码并点配对按钮发起流程', async () => {
    render(<PairPage initialUrl="" WS={FakeWebSocket as any} />)
    const input = screen.getByPlaceholderText('6 位数字') as HTMLInputElement
    fireEvent.change(input, { target: { value: '654321' } })
    expect(screen.getByRole('button', { name: '配对' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '配对' }))
    await waitFor(() => expect(FakeWebSocket.last()).toBeTruthy())
    FakeWebSocket.last().open()
    expect(FakeWebSocket.last().sent[0].code).toBe('654321')
  })

  it('pair.success 后持久化身份并触发 onPaired', async () => {
    const onPaired = vi.fn()
    render(<PairPage initialUrl="?pair=111222" WS={FakeWebSocket as any} onPaired={onPaired} />)
    await waitFor(() => expect(FakeWebSocket.last()).toBeTruthy())
    FakeWebSocket.last().open()

    act(() => {
      FakeWebSocket.last().message({
        type: 'pair.success',
        payload: { desktopId: 'desk-xyz', deviceKey: 'deskKeyBase64=' },
      })
    })

    // 持久化落盘
    const dev = loadDeviceIdentity()
    expect(dev).toBeTruthy()
    expect(dev!.deviceId).toMatch(/^m-/)
    const desk = loadDesktopIdentity()
    expect(desk).toEqual({ desktopId: 'desk-xyz', desktopKey: 'deskKeyBase64=' })

    // 回调
    expect(onPaired).toHaveBeenCalledWith('desk-xyz')

    // UI 反馈
    expect(await screen.findByText('配对成功，正在跳转…')).toBeInTheDocument()
  })

  it('pair.consume 上报的 deviceId 与本地存的设备身份一致（落盘可复用）', async () => {
    // 预置已有设备身份（模拟「之前生成过、刷新页面」场景）
    localStorage.setItem('ccdesk.device', JSON.stringify({ deviceId: 'm-reuse', deviceKey: 'k=' }))
    render(<PairPage initialUrl="?pair=222333" WS={FakeWebSocket as any} />)
    await waitFor(() => expect(FakeWebSocket.last()).toBeTruthy())
    FakeWebSocket.last().open()
    expect(FakeWebSocket.last().sent[0].deviceId).toBe('m-reuse')
    expect(FakeWebSocket.last().sent[0].deviceKey).toBe('k=')
  })

  it('error / bad_pair_code 显示错误提示并可重试', async () => {
    render(<PairPage initialUrl="?pair=333444" WS={FakeWebSocket as any} />)
    await waitFor(() => expect(FakeWebSocket.last()).toBeTruthy())
    FakeWebSocket.last().open()

    act(() => {
      FakeWebSocket.last().message({ type: 'error', payload: { code: 'bad_pair_code' } })
    })

    expect(await screen.findByText(/配对码无效或已过期/)).toBeInTheDocument()

    // 重试：按钮回到可点击
    const btn = screen.getByRole('button')
    expect(btn).not.toBeDisabled()
  })

  it('输入框过滤非数字、截断到 6 位', () => {
    render(<PairPage initialUrl="" WS={FakeWebSocket as any} />)
    const input = screen.getByPlaceholderText('6 位数字') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc12-3456789' } })
    expect(input.value).toBe('123456')
  })

  it('clearPairingStorage 后 PairPage 会重新生成新设备身份', async () => {
    // 先有身份
    localStorage.setItem('ccdesk.device', JSON.stringify({ deviceId: 'm-old', deviceKey: 'ok=' }))
    clearPairingStorage()
    expect(loadDeviceIdentity()).toBeNull()

    render(<PairPage initialUrl="?pair=444555" WS={FakeWebSocket as any} />)
    await waitFor(() => expect(FakeWebSocket.last()).toBeTruthy())
    FakeWebSocket.last().open()
    const sentId = FakeWebSocket.last().sent[0].deviceId
    expect(sentId).not.toBe('m-old')
    expect(sentId).toMatch(/^m-/)
  })
})
