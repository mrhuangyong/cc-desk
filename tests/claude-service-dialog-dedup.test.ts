// tests/claude-service-dialog-dedup.test.ts
// 守护测试：修复4（反复弹授权框）—— 同一 tool_use.id 的阻塞式工具（AskUserQuestion）
// 被 SDK 重放/重复触发时，必须只弹一次，第二次直接返回缓存结果，不重复弹窗。
//
// 根因：claude-service 的 isBlockingHandled/markBlockingHandled 定义了却无任何调用点（失效）。
// SDK 在 resume / includePartialMessages 场景会重放同一 assistant 消息，导致同一个
// AskUserQuestion 的 tool_use 被多次 canUseTool → 重复弹同一问题（用户看到「点确认又弹」）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    const asyncIter = { next: async () => ({ value: undefined, done: true }) }
    return { [Symbol.asyncIterator]() { return asyncIter }, interrupt: async () => {}, return: async () => ({ value: undefined, done: true }) }
  },
}))
vi.mock('../src/main/cc-desk-store', () => ({
  getModelProvidersConfig: () => ({ providers: [], models: [], modelRoleMap: {}, activeModelId: '' }),
  resolveActiveProviderModel: () => null,
  buildSdkEnv: () => ({}),
}))
vi.mock('../src/main/settings-store', () => ({ getSettings: () => ({}) }))
vi.mock('../src/main/projects-store', () => ({ getProjectsSnapshot: () => ({ projects: [] }) }))
vi.mock('../src/main/claude-config', () => ({
  getMcpServers: async () => [], getPlugins: async () => [], getSkills: async () => [],
  getCommands: async () => [], getHooks: async () => [], getModelConfig: async () => ({}),
  getGeneralConfig: async () => ({}),
}))

describe('ClaudeService 阻塞式工具去重（修复反复弹框）', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('同一 toolUseId 的 AskUserQuestion 第二次触发：不重复弹窗，返回缓存结果', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    // 统计 dialog-request 发送次数（弹窗次数）
    const sendCalls: any[] = []
    const wc: any = {
      send: (_ch: string, data: any) => { sendCalls.push(data) },
    }
    // 第一次：发起调用（会挂起等用户作答），同时模拟用户「取消」解决它
    const input = { questions: [{ question: '选哪个?', options: [{ label: 'A' }, { label: 'B' }] }] }
    const opts = { toolUseID: 'tu-1' }
    const firstP = (svc as any).handlePermissionRequest('s1', '变更前确认', 'AskUserQuestion', input, opts, wc)
    // 等一拍让 askUserViaPanel 发出 dialog-request 并挂起
    await new Promise(r => setTimeout(r, 10))
    expect(sendCalls.length).toBe(1)
    // 模拟用户取消：解决挂起的 dialog（首次完成弹窗 + 缓存结果）
    const reqId = sendCalls[0].reqId
    svc.resolveDialog(reqId, { behavior: 'cancelled' })
    const r1 = await firstP

    // 第二次：SDK 重放同一 toolUseId（resume 场景）—— 不应再弹窗，直接返回缓存结果
    sendCalls.length = 0
    const r2 = await (svc as any).handlePermissionRequest('s1', '变更前确认', 'AskUserQuestion', input, opts, wc)
    expect(sendCalls.length).toBe(0)
    // 第二次结果应与第一次一致（deny，message 含取消语义），不重新挂起
    expect(r2?.behavior).toBe('deny')
    expect(r2?.behavior).toBe(r1?.behavior)
  })
})
