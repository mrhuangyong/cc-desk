// tests/claude-service-pending-dialogs.test.ts
// 守护测试：刷新页面后挂起的 dialog（AskUserQuestion / ExitPlanMode / 权限请求）必须可被补发。
//
// 根因：dialogResolvers 持有不可序列化的 resolver 函数，刷新后渲染端拿不回 dialog 信息，
// pendingDialog 归零 → 卡片消失 → 用户无法回答 → 主进程 Promise 永久挂起 → SDK 事件循环卡死。
// 解法：新增 pendingDialogInfos 可序列化快照 + listPendingDialogs()，与 resolver 同生命周期。
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

describe('ClaudeService 挂起 dialog 补发登记（刷新恢复）', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('挂起中的 dialog 出现在 listPendingDialogs，含完整可序列化字段', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const sendCalls: any[] = []
    const wc: any = { send: (_ch: string, data: any) => { sendCalls.push(data) } }

    // 发起一个 AskUserQuestion（会挂起等用户作答）
    const input = { questions: [{ question: '选哪个?', options: [{ label: 'A' }] }] }
    const p = (svc as any).handlePermissionRequest('s1', '变更前确认', 'AskUserQuestion', input, { toolUseID: 'tu-1' }, wc)
    await new Promise(r => setTimeout(r, 10))
    expect(sendCalls.length).toBe(1)

    // 挂起期间：listPendingDialogs 应返回该 dialog，且字段完整可序列化
    const pending = svc.listPendingDialogs()
    expect(pending.length).toBe(1)
    expect(pending[0]).toMatchObject({ localSessionId: 's1', dialogKind: 'ask_user_question', toolUseId: 'tu-1' })
    expect(pending[0].reqId).toBe(sendCalls[0].reqId)
    expect(pending[0].payload).toEqual(input)

    // 解决后：从登记表中移除（resolveDialog 同步清 info）
    svc.resolveDialog(sendCalls[0].reqId, { behavior: 'cancelled' })
    await p
    expect(svc.listPendingDialogs().length).toBe(0)
  })

  it('多个 session 各自挂起的 dialog 都能列出，分别解决后逐个消失', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const sendCalls: any[] = []
    const wc: any = { send: (_ch: string, data: any) => { sendCalls.push(data) } }

    // s1 挂一个 AskUserQuestion
    const p1 = (svc as any).handlePermissionRequest('s1', '变更前确认', 'AskUserQuestion', { questions: [] }, { toolUseID: 'tu-a' }, wc)
    await new Promise(r => setTimeout(r, 10))
    // s2 挂一个权限请求
    const p2 = (svc as any).handlePermissionRequest('s2', '变更前确认', 'Bash', { command: 'rm' }, { toolUseID: 'tu-b' }, wc)
    await new Promise(r => setTimeout(r, 10))

    expect(svc.listPendingDialogs().length).toBe(2)
    // 注意：同 session 串行锁，s1/s2 不同 session 故并发各自挂起

    // 解决 s1 的，应只剩 s2 的
    svc.resolveDialog(sendCalls[0].reqId, { behavior: 'cancelled' })
    await p1
    const after1 = svc.listPendingDialogs()
    expect(after1.length).toBe(1)
    expect(after1[0].localSessionId).toBe('s2')

    svc.resolveDialog(sendCalls[1].reqId, { behavior: 'completed' })
    await p2
    expect(svc.listPendingDialogs().length).toBe(0)
  })

  it('listPendingDialogs 以 resolver 存在性为准：过期残留 info 不返回', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const wc: any = { send: () => {} }

    // 构造一个 info 残留但没有 resolver 的场景（模拟时序窗口）
    ;(svc as any).pendingDialogInfos.set('dangling', { dialogKind: 'ask_user_question', payload: {}, toolUseId: 'x' })
    // dialogResolvers 里没有 'dangling' → 不应返回
    expect(svc.listPendingDialogs()).toEqual([])
  })
})
