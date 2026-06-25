import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

const TMP_HOME = path.join(os.tmpdir(), `cc-desk-test-${Date.now()}`)
const ORIG_HOME = process.env.HOME
beforeEach(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
  fs.mkdirSync(TMP_HOME, { recursive: true })
  process.env.HOME = TMP_HOME
  vi.resetModules()
})
afterAll(() => { process.env.HOME = ORIG_HOME; fs.rmSync(TMP_HOME, { recursive: true, force: true }) })

describe('cc-desk-store', () => {
  it('无文件时返回空初始值', async () => {
    const { getModelProvidersConfig } = await import('../src/main/cc-desk-store')
    expect(getModelProvidersConfig()).toEqual({
      providers: [], models: [], modelRoleMap: {}, activeModelId: '',
    })
  })

  it('saveModelProvidersConfig 浅合并写回，再读能拿到', async () => {
    const { getModelProvidersConfig, saveModelProvidersConfig } = await import('../src/main/cc-desk-store')
    saveModelProvidersConfig({ providers: [{ id: 'p1', name: 'ai', apiKey: 'sk', baseUrl: 'http://x', enabled: true }] })
    expect(getModelProvidersConfig().providers.length).toBe(1)
    saveModelProvidersConfig({ models: [{ id: 'm1', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true }] })
    const cfg = getModelProvidersConfig()
    expect(cfg.providers.length).toBe(1)
    expect(cfg.models.length).toBe(1)
  })

  it('resolveActiveProviderModel: activeModelId 指向 enabled 模型时返回它', async () => {
    const { resolveActiveProviderModel } = await import('../src/main/cc-desk-store')
    const cfg = {
      providers: [{ id: 'p1', name: 'ai', apiKey: 'sk', baseUrl: 'http://x', enabled: true }],
      models: [{ id: 'm1', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true }],
      modelRoleMap: {}, activeModelId: 'm1',
    }
    const r = resolveActiveProviderModel(cfg)
    expect(r?.provider.id).toBe('p1')
    expect(r?.model.sdkModelId).toBe('glm-5.2')
  })

  it('resolveActiveProviderModel: activeModelId 为空时回退首个 enabled provider 的首个 enabled 模型', async () => {
    const { resolveActiveProviderModel } = await import('../src/main/cc-desk-store')
    const cfg = {
      providers: [{ id: 'p1', name: 'ai', apiKey: 'sk', baseUrl: 'http://x', enabled: true }],
      models: [{ id: 'm1', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true }],
      modelRoleMap: {}, activeModelId: '',
    }
    expect(resolveActiveProviderModel(cfg)?.model.id).toBe('m1')
  })

  it('resolveActiveProviderModel: 无任何 enabled provider+model 时返回 null', async () => {
    const { resolveActiveProviderModel } = await import('../src/main/cc-desk-store')
    expect(resolveActiveProviderModel({ providers: [], models: [], modelRoleMap: {}, activeModelId: '' })).toBeNull()
  })

  it('resolveActiveProviderModel: active 模型的 provider 被 disabled 时回退到其它 enabled provider', async () => {
    const { resolveActiveProviderModel } = await import('../src/main/cc-desk-store')
    const cfg = {
      providers: [
        { id: 'p1', name: 'disabled', apiKey: '', baseUrl: '', enabled: false },
        { id: 'p2', name: 'active', apiKey: 'sk', baseUrl: 'http://x', enabled: true },
      ],
      models: [
        { id: 'm1', providerId: 'p1', sdkModelId: 'glm-a', contextLength: '200K', enabled: true },
        { id: 'm2', providerId: 'p2', sdkModelId: 'glm-b', contextLength: '200K', enabled: true },
      ],
      modelRoleMap: {}, activeModelId: 'm1',
    }
    // m1 虽是 active 但其 provider p1 disabled，应回退到首个 enabled provider(p2) 的首个 enabled 模型(m2)
    const r = resolveActiveProviderModel(cfg)
    expect(r?.provider.id).toBe('p2')
    expect(r?.model.id).toBe('m2')
  })

  it('buildSdkEnv: 注入 apiKey/baseUrl/选中模型 + roleMap', async () => {
    const { buildSdkEnv } = await import('../src/main/cc-desk-store')
    const resolved = {
      provider: { id: 'p1', name: 'ai', apiKey: 'sk-x', baseUrl: 'http://127.0.0.1:17860', enabled: true },
      model: { id: 'm1', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true },
    }
    const modelRoleMap = { 'p1:sonnet': 'm1' }
    const env = buildSdkEnv(resolved, modelRoleMap, [resolved.model])
    expect(env.ANTHROPIC_API_KEY).toBe('sk-x')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:17860')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.2')
    // 无条目的 role 回退到选中模型 sdkModelId
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.2')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-5.2')
    // 关闭 SDK 归因 header 注入，避免第三方代理下 cch 每轮变化导致 KV Cache 失效
    expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('0')
  })

  it('buildSdkEnv: baseUrl 为空时不注入 ANTHROPIC_BASE_URL', async () => {
    const { buildSdkEnv } = await import('../src/main/cc-desk-store')
    const resolved = {
      provider: { id: 'p1', name: 'ai', apiKey: 'sk-x', baseUrl: '', enabled: true },
      model: { id: 'm1', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true },
    }
    const env = buildSdkEnv(resolved, {})
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('sk-x')
  })
})
