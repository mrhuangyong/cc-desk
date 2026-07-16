// 守护测试：会话权限变化时，必须重建 query（而非依赖 setPermissionMode control request）。
//
// 根因演进（本测试守护新设计）：
// 旧设计认为「复用 query + setPermissionMode 控制请求」能让权限切换实时生效。但诊断发现：
// 「完全访问」会往 CLI 子进程注入 --allow-dangerously-skip-permissions 进程级一次性标志，
// 切回计划/默认时 control request 无法收紧（skip 进程里权限检查被全局短路），表现为
// 「切了计划模式仍直接写文件」。且 canUseTool 闭包捕获首条消息的 permission，复用 query 时
// 闭包永不更新。
// 新设计：send() 检测权限标签变化 → closeSession 销毁旧子进程 → ensureSession 重建，
// buildQuery 用新 permissionMode + 跟随权限的 allowDangerouslySkipPermissions 重新创建，
// resume 续接历史。control request 仅在「复用且权限未变」的兜底场景调用。
//
// 本测试在主进程层断言：
// 1. 权限变化时重新构造 query（新进程 permissionMode = 新值），且不调 setPermissionMode。
// 2. allowDangerouslySkipPermissions 跟随权限：完全访问=true，计划模式=false。
// 3. 权限未变复用时，才调 setPermissionMode 兜底。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 记录每次构造时的 permissionMode / allowDangerouslySkipPermissions，并暴露 setPermissionMode。
let constructed: Array<{ mode: string | null; skip: boolean }> = []
let setModeCalls: string[] = []
let queryConstructCount = 0
function makeFakeQuery() {
  const asyncIter = { next: async () => ({ value: undefined, done: true }) }
  return {
    [Symbol.asyncIterator]() { return asyncIter },
    interrupt: async () => {},
    return: async () => ({ value: undefined, done: true }),
    setPermissionMode: async (mode: string) => { setModeCalls.push(mode) },
  }
}

// query 工厂：每次构造捕获 permissionMode + allowDangerouslySkipPermissions。
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (opts: any) => {
    queryConstructCount++
    constructed.push({
      mode: opts?.options?.permissionMode ?? null,
      skip: opts?.options?.allowDangerouslySkipPermissions ?? false,
    })
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

describe('ClaudeService.send 权限变化重建 query', () => {
  beforeEach(() => { vi.resetModules(); constructed = []; setModeCalls = []; queryConstructCount = 0 })
  afterEach(() => { vi.restoreAllMocks() })

  function mkWc() {
    return { send: () => {} } as any
  }

  it('权限变化（变更前确认 → 计划模式）时重建 query：新进程 permissionMode=plan 且不调 setPermissionMode', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const { SessionQueryManager } = await import('../src/main/session-query-manager')
    const svc = new ClaudeService()
    svc.setManager(new SessionQueryManager())
    // 首次：默认权限「变更前确认」→ default，创建会话（第 1 次构造）
    await svc.send({ prompt: 'hi', localSessionId: 's1', permission: '变更前确认', webContents: mkWc() })
    expect(queryConstructCount).toBe(1)
    expect(constructed[0].mode).toBe('default')
    expect(setModeCalls).toEqual([])

    // 第二次：切换为「计划模式」→ 必须重建（第 2 次构造），permissionMode=plan
    await svc.send({ prompt: '帮我规划', localSessionId: 's1', permission: '计划模式', webContents: mkWc() })
    expect(queryConstructCount).toBe(2)
    expect(constructed[1].mode).toBe('plan')
    // 重建路径下不应再调 setPermissionMode（buildQuery 已直接用新 permissionMode）
    expect(setModeCalls).toEqual([])
  })

  it('allowDangerouslySkipPermissions 跟随权限：完全访问=true，计划模式=false', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const { SessionQueryManager } = await import('../src/main/session-query-manager')
    const svc = new ClaudeService()
    svc.setManager(new SessionQueryManager())
    // 完全访问 → skip=true
    await svc.send({ prompt: 'hi', localSessionId: 's2', permission: '完全访问', webContents: mkWc() })
    expect(constructed[0].skip).toBe(true)
    // 切到计划模式重建 → skip=false（进程级标志必须摘掉，否则 plan 拦截被短路）
    await svc.send({ prompt: '规划', localSessionId: 's2', permission: '计划模式', webContents: mkWc() })
    expect(constructed[1].skip).toBe(false)
    expect(constructed[1].mode).toBe('plan')
  })

  it('权限未变复用时，才调 setPermissionMode 兜底（不重建）', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const { SessionQueryManager } = await import('../src/main/session-query-manager')
    const svc = new ClaudeService()
    svc.setManager(new SessionQueryManager())
    await svc.send({ prompt: 'hi', localSessionId: 's3', permission: '变更前确认', webContents: mkWc() })
    expect(queryConstructCount).toBe(1)
    // 再次同权限发送 → 复用，不重建
    await svc.send({ prompt: 'again', localSessionId: 's3', permission: '变更前确认', webContents: mkWc() })
    expect(queryConstructCount).toBe(1)
    // 复用且权限未变 → 调 setPermissionMode 兜底（幂等）
    expect(setModeCalls).toEqual(['default'])
  })
})
