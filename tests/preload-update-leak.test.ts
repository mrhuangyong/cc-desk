// preload 跨命名空间监听器泄漏测试：claude.removeAllListeners() 不应清掉
// update / ccDesk 命名空间的监听器。
//
// 背景 BUG：「检查更新」首次能用、之后无响应。
// 根因：ChatArea 卸载时调用 api.removeAllListeners()，其通道清单错误包含了
// 'update:state'（和 'cc-desk:model:changed'），把 App.tsx 全局注册的 update 订阅
// 一并清掉，导致后续主进程推送的 update:state 渲染端再也收不到。
// 本测试复现并锁定该契约：removeAllListeners 仅清理 claude:* 通道。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock electron 的 contextBridge + ipcRenderer（捕获 on/removeListener/removeAllListeners）
const onSpies: Record<string, ((...args: any[]) => void)[]> = {}
const ipcRenderer = {
  on: vi.fn((channel: string, handler: (...a: any[]) => void) => {
    ;(onSpies[channel] ??= []).push(handler)
  }),
  removeListener: vi.fn((channel: string, handler: (...a: any[]) => void) => {
    onSpies[channel] = (onSpies[channel] ?? []).filter(h => h !== handler)
  }),
  // removeAllListeners：与真实 ipcRenderer 语义一致，清空该 channel 全部监听器
  removeAllListeners: vi.fn((channel: string) => {
    onSpies[channel] = []
  }),
  invoke: vi.fn(),
}
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: any) => {
      ;(globalThis as any).__exposedApi = api
    }),
  },
  ipcRenderer,
}))

describe('removeAllListeners 不应跨命名空间清理', () => {
  let api: any
  beforeEach(async () => {
    Object.keys(onSpies).forEach(k => delete onSpies[k])
    vi.clearAllMocks()
    vi.resetModules()
    await import('../src/preload/index')
    api = (globalThis as any).__exposedApi
  })

  it('update.onState 注册后 update:state 监听 +1', () => {
    expect((onSpies['update:state'] ?? []).length).toBe(0)
    api.update.onState(() => {})
    expect((onSpies['update:state'] ?? []).length).toBe(1)
  })

  it('claude.removeAllListeners() 不清除 update:state 监听器（BUG 核心）', () => {
    // App.tsx 全局订阅 update:state
    api.update.onState(() => {})
    expect((onSpies['update:state'] ?? []).length).toBe(1)
    // ChatArea 卸载 cleanup 调用 removeAllListeners —— 不应波及 update:state
    api.claude.removeAllListeners()
    expect((onSpies['update:state'] ?? []).length).toBe(1)
  })

  it('claude.removeAllListeners() 不清除 cc-desk:model:changed 监听器', () => {
    api.ccDesk.model.onChange(() => {})
    expect((onSpies['cc-desk:model:changed'] ?? []).length).toBe(1)
    api.claude.removeAllListeners()
    expect((onSpies['cc-desk:model:changed'] ?? []).length).toBe(1)
  })

  it('claude.removeAllListeners() 仍正确清理 claude:* 通道（不误删合法逻辑）', () => {
    // claude:system 由 claude.onSystem 风格注册——这里直接用底层 on 验证清单仍含 claude:*
    api.claude.onSystem?.(() => {})
    // 若无 onSystem 入口，回退用底层 on 直接注册一个 claude:delta 监听
    if ((onSpies['claude:system'] ?? []).length === 0) {
      ipcRenderer.on('claude:delta', () => {})
    }
    const claudeChannel = (onSpies['claude:system'] ?? []).length > 0 ? 'claude:system' : 'claude:delta'
    expect((onSpies[claudeChannel] ?? []).length).toBe(1)
    api.claude.removeAllListeners()
    expect((onSpies[claudeChannel] ?? []).length).toBe(0)
  })
})
