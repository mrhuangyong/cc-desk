// 守护测试：evaluateGoal 的 A3 容错——runSideQuery 抛错时必须返回 {met:false},
// 而非把异常上抛(否则 /goal Stop hook 会被 reject,SDK 兜底继续轮但报错噪音)。
//
// catch 分支在 goal-evaluator.test.ts 只测了 parseGoalVerdict 的解析失败,
// 这里专门覆盖"runSideQuery 本身抛错"的路径:无激活模型时 resolveActiveModel() 返 null,
// runSideQuery 抛 '请先在...添加并启用供应商与模型',evaluateGoal 应吞掉并返回 met:false。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock SDK:query 不会被走到(resolveActiveModel 先返 null),但 import ClaudeService 时会读,必须桩。
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => (async function* () {})(),
}))
// 无激活供应商 → resolveActiveModel() 返 null → runSideQuery 抛错 → 触发 evaluateGoal catch。
vi.mock('../src/main/cc-desk-store', () => ({
  getModelProvidersConfig: () => ({ providers: [], models: [], modelRoleMap: {}, activeModelId: '' }),
  resolveActiveProviderModel: () => null,
  buildSdkEnv: () => ({}),
}))
vi.mock('../src/main/settings-store', () => ({ getSettings: () => ({}) }))
vi.mock('../src/main/projects-store', () => ({ getProjectsSnapshot: () => [] }))
vi.mock('../src/main/claude-config', () => ({
  getMcpServers: async () => [], getPlugins: async () => [], getSkills: async () => [],
  getCommands: async () => [], getHooks: async () => [], getModelConfig: async () => ({}),
  getGeneralConfig: async () => ({}),
}))

describe('ClaudeService.evaluateGoal A3 容错(runSideQuery 抛错)', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  it('runSideQuery 抛错 → {met:false, reason 含 "评估调用失败"}(不向上传播)', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const verdict = await svc.evaluateGoal('所有测试通过', '当前进展:2 个失败')
    expect(verdict.met).toBe(false)
    expect(verdict.reason).toContain('评估调用失败')
    expect(verdict.reason).toContain('默认继续')
  })
})
