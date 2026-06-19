// 守护测试：会话复用时，send() 传入的新权限标签必须实时生效。
//
// 根因：ClaudeService.send() 把 permissionMode 只写在 buildQuery 内部，
// 而 SessionQueryManager.ensureSession 对已存在会话直接复用、不再调 buildQuery。
// 结果：首个会话的权限被首次 send 锁死，之后切换下拉框（计划模式 / 完全访问 等）
// 传入的 permission 参数被完全忽略，SDK query 始终停在最初的模式。
// 「批准计划」路径之所以正常，是因为 handleExitPlanMode 显式调了 setPermissionMode。
//
// 本测试在主进程层断言：同一会话第二次 send 换权限时，必须调用 query.setPermissionMode
// 把新模式推给 SDK（控制请求，实时生效）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 记录构造时的初始 permissionMode，并暴露 setPermissionMode 供实时切换。
let constructedMode: string | null = null
let setModeCalls: string[] = []
function makeFakeQuery() {
  const asyncIter = { next: async () => ({ value: undefined, done: true }) }
  return {
    [Symbol.asyncIterator]() { return asyncIter },
    interrupt: async () => {},
    return: async () => ({ value: undefined, done: true }),
    setPermissionMode: async (mode: string) => { setModeCalls.push(mode) },
  }
}

// query 工厂：从 options.permissionMode 捕获构造时的模式，返回 fake query。
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (opts: any) => {
    constructedMode = opts?.options?.permissionMode ?? null
    return makeFakeQuery()
  },
}))
vi.mock('../src/main/cc-desk-store', () => ({
  getModelProvidersConfig: () => ({
    providers: [{ id: 'p1', name: 'p', enabled: true, apiKey: 'k', baseUrl: 'u' }],
    models: [{ id: 'm1', providerId: 'p1', enabled: true, sdkModelId: 'claude-3-5-sonnet' }],
    modelRoleMap: {},
    activeModelId: 'm1',
  }),
  resolveActiveProviderModel: () => ({
    provider: { id: 'p1', name: 'p', apiKey: 'k', baseUrl: 'u' },
    model: { id: 'm1', providerId: 'p1', sdkModelId: 'claude-3-5-sonnet' },
  }),
  buildSdkEnv: () => ({}),
}))
vi.mock('../src/main/settings-store', () => ({ getSettings: () => ({}) }))
vi.mock('../src/main/projects-store', () => ({ getProjectsSnapshot: () => [] }))
vi.mock('../src/main/claude-config', () => ({
  getMcpServers: async () => [], getPlugins: async () => [], getSkills: async () => [],
  getCommands: async () => [], getHooks: async () => [], getModelConfig: async () => ({}),
  getGeneralConfig: async () => ({}),
}))

describe('ClaudeService.send 权限模式在会话复用时实时生效', () => {
  beforeEach(() => { vi.resetModules(); constructedMode = null; setModeCalls = [] })
  afterEach(() => { vi.restoreAllMocks() })

  function mkWc() {
    const wc: any = { send: () => {} }
    return wc
  }

  it('第二次 send 换成「计划模式」时，构造模式是 default，但必须调 setPermissionMode("plan")', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const { SessionQueryManager } = await import('../src/main/session-query-manager')
    const svc = new ClaudeService()
    svc.setManager(new SessionQueryManager())
    // 首次发送：默认权限「变更前确认」→ default，创建会话
    await svc.send({ prompt: 'hi', localSessionId: 's1', permission: '变更前确认', webContents: mkWc() })
    expect(constructedMode).toBe('default')
    expect(setModeCalls).toEqual([])

    // 第二次发送：切换为「计划模式」，复用同一会话
    await svc.send({ prompt: '帮我规划', localSessionId: 's1', permission: '计划模式', webContents: mkWc() })
    // 复用时不该重建 query，所以构造模式不变；但必须通过 setPermissionMode 实时切到 plan
    expect(setModeCalls).toContain('plan')
  })
})
