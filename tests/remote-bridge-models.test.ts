// tests/remote-bridge-models.test.ts
// buildModelsPayload：cc-desk-store 模型配置 → 手机端 session.models payload（纯函数测试）。
//
// 重点覆盖：provider 禁用时模型不下发 + activeModelId 失效时校正（对齐 resolveActiveProviderModel
// 的回退语义，保证手机端显示的「当前模型」= ClaudeService 实际使用的模型）。
import { describe, it, expect } from 'vitest'
import { buildModelsPayload } from '../src/main/remote-bridge'

describe('buildModelsPayload', () => {
  it('只下发 enabled 模型（model.enabled !== false）', () => {
    const p = buildModelsPayload({
      providers: [{ id: 'p1', enabled: true }],
      models: [
        { id: 'm1', sdkModelId: 'glm', providerId: 'p1', enabled: true },
        { id: 'm2', sdkModelId: 'qwen', providerId: 'p1', enabled: false },
      ],
      activeModelId: 'm1',
    })
    expect(p.models.map((m) => m.id)).toEqual(['m1'])
  })

  it('provider 禁用时其模型不下发（避免选到跑不起来的模型）', () => {
    const p = buildModelsPayload({
      providers: [
        { id: 'p1', enabled: false }, // aiproxy 禁用
        { id: 'p2', enabled: true },  // failover 启用
      ],
      models: [
        { id: 'm1', sdkModelId: 'qwen', providerId: 'p1', enabled: true },   // provider 禁用 → 不下发
        { id: 'm2', sdkModelId: 'opus', providerId: 'p2', enabled: true },
        { id: 'm3', sdkModelId: 'sonnet', providerId: 'p2', enabled: true },
      ],
      activeModelId: 'm1', // 指向 qwen(provider 已禁用,实际 ClaudeService 会回退到 opus)
    })
    expect(p.models.map((m) => m.id)).toEqual(['m2', 'm3'])
    // activeModelId 失效(m1 不在列表)→ 校正为列表首项 m2(opus),与 resolveActiveProviderModel 回退一致
    expect(p.activeModelId).toBe('m2')
  })

  it('activeModelId 在过滤后列表内 → 原样保留', () => {
    const p = buildModelsPayload({
      providers: [{ id: 'p1', enabled: true }],
      models: [
        { id: 'm1', sdkModelId: 'opus', providerId: 'p1', enabled: true },
        { id: 'm2', sdkModelId: 'sonnet', providerId: 'p1', enabled: true },
      ],
      activeModelId: 'm2',
    })
    expect(p.activeModelId).toBe('m2')
  })

  it('无可用模型(provider 全禁用 / 无 enabled 模型)→ 空列表 + 空 active', () => {
    const p = buildModelsPayload({
      providers: [{ id: 'p1', enabled: false }],
      models: [{ id: 'm1', sdkModelId: 'opus', providerId: 'p1', enabled: true }],
      activeModelId: 'm1',
    })
    expect(p.models).toEqual([])
    expect(p.activeModelId).toBe('')
  })

  it('thinking 由调用方注入（默认 medium）', () => {
    const p = buildModelsPayload({ models: [], activeModelId: '' })
    expect(p.thinking).toBe('medium')
    const p2 = buildModelsPayload({ models: [], activeModelId: '' }, 'high')
    expect(p2.thinking).toBe('high')
  })
})
