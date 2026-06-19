// preload IPC 监听器泄漏测试：onArchiveTick 必须返回 unsubscribe，
// 调用它应移除监听器（避免 React 重 mount 时 ipcRenderer.on 累加）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock electron 的 contextBridge + ipcRenderer（捕获 on/removeListener）
const onSpies: Record<string, ((...args: any[]) => void)[]> = {}
const ipcRenderer = {
  on: vi.fn((channel: string, handler: (...a: any[]) => void) => {
    ;(onSpies[channel] ??= []).push(handler)
  }),
  removeListener: vi.fn((channel: string, handler: (...a: any[]) => void) => {
    onSpies[channel] = (onSpies[channel] ?? []).filter(h => h !== handler)
  }),
  invoke: vi.fn(),
}
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn((_name: string, api: any) => { ;(globalThis as any).__exposedApi = api }) },
  ipcRenderer,
}))

describe('preload onArchiveTick 监听器清理', () => {
  let api: any
  beforeEach(async () => {
    Object.keys(onSpies).forEach(k => delete onSpies[k])
    vi.clearAllMocks()
    vi.resetModules()
    await import('../src/preload/index')
    api = (globalThis as any).__exposedApi
  })

  it('onArchiveTick 返回 unsubscribe 函数', () => {
    const unsub = api.onArchiveTick(() => {})
    expect(typeof unsub).toBe('function')
  })

  it('注册后 archive:tick 监听计数+1，unsubscribe 后恢复', () => {
    expect((onSpies['archive:tick'] ?? []).length).toBe(0)
    const unsub = api.onArchiveTick(() => {})
    expect((onSpies['archive:tick'] ?? []).length).toBe(1)
    unsub()
    expect((onSpies['archive:tick'] ?? []).length).toBe(0)
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('archive:tick', expect.any(Function))
  })

  it('模拟 React 重 mount：两次注册 + 两次 cleanup 不残留', () => {
    // 第一次 mount
    const u1 = api.onArchiveTick(() => {})
    expect((onSpies['archive:tick'] ?? []).length).toBe(1)
    // 第二次 mount（StrictMode / hot reload）——若无 cleanup 会累加到 2，泄漏
    const u2 = api.onArchiveTick(() => {})
    expect((onSpies['archive:tick'] ?? []).length).toBe(2)
    u1()
    u2()
    expect((onSpies['archive:tick'] ?? []).length).toBe(0)
  })
})
