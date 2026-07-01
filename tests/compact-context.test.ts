// compactContext：通过 pushMessage("/compact") 触发 CLI 真实压缩；流式中拒绝。
// 区别于手写 compactSession（UI 摘要、不降 token）——本方法走 CLI 原生 /compact（真降 token）。
// mock 依赖（settings/cc-desk-store/projects-store/claude-config/sdk），仅测 compactContext 自身逻辑。
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

describe('ClaudeService.compactContext', () => {
  let claude: any, manager: any, webContents: any

  beforeEach(async () => {
    vi.resetModules()
    const { ClaudeService } = await import('../src/main/claude-service')
    claude = new ClaudeService()
    manager = {
      sessions: new Map(),
      isIterating: vi.fn(() => false),
      pushMessage: vi.fn(),
      getContextUsage: vi.fn(async () => ({ totalTokens: 100, maxTokens: 1000 })),
    }
    claude.setManager(manager)
    webContents = { send: vi.fn() }
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('非流式时调用 pushMessage("/compact")', async () => {
    await claude.compactContext('s1', webContents)
    expect(manager.pushMessage).toHaveBeenCalledWith('s1', '/compact')
  })

  it('流式中拒绝压缩并发 warn notice', async () => {
    manager.isIterating = vi.fn(() => true)
    await claude.compactContext('s1', webContents)
    expect(manager.pushMessage).not.toHaveBeenCalled()
    const sent = webContents.send.mock.calls.find((c: any[]) => c[0] === 'claude:notice')
    expect(sent).toBeTruthy()
    expect(JSON.stringify(sent[1])).toContain('压缩')
    expect((sent[1] as any).level).toBe('warn')
  })

  it('manager 未初始化时安全返回（不抛错）', async () => {
    claude.setManager(null as any)
    await expect(claude.compactContext('s1', webContents)).resolves.toBeUndefined()
  })
})
