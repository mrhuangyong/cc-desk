// 守护测试：ClaudeService.send 必须把 autoCompactEnabled:true 传给 SDK query options。
// 这是 /compact「真正减少 token」的关键——SDK 内置自动压缩在 context 满时真实摘要并替换
// 内部历史。手写 /compact 只压缩 UI；SDK 侧真实 context 压缩由 autoCompactEnabled 负责。
// 隔离临时 HOME，预置供应商配置，mock SDK query 捕获 options。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'

// 捕获传给 SDK query 的 options
let capturedQueryOptions: any = null
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (arg: any) => {
    // SDK query 签名：query({ prompt, options })
    capturedQueryOptions = arg?.options
    // 返回一个空 async iterable，供 manager 的 for-await 立即结束
    return (async function* () {})()
  },
}))

describe('ClaudeService.send → SDK query options', () => {
  let origHome: string | undefined

  beforeEach(async () => {
    origHome = process.env.HOME
    const fakeHome = join(tmpdir(), `cc-ac-${Math.random().toString(36).slice(2)}-${Date.now()}`)
    await mkdir(join(fakeHome, '.cc-desk'), { recursive: true })
    await mkdir(join(fakeHome, '.claude'), { recursive: true })
    process.env.HOME = fakeHome
    // 预置供应商 + 模型配置（cc-desk config.json）
    await writeFile(join(fakeHome, '.cc-desk', 'config.json'), JSON.stringify({
      config: {
        providers: [{ id: 'p1', name: 'P1', apiKey: 'k', baseUrl: 'http://x', enabled: true }],
        models: [{ id: 'm1', name: 'M1', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200000', enabled: true }],
        modelRoleMap: {}, activeModelId: 'm1',
      },
    }))
    // 预置 settings.json（含最小 settings）
    await writeFile(join(fakeHome, '.cc-desk', 'settings.json'), JSON.stringify({
      settings: { model: 'm1', cwd: fakeHome, lang: 'zh-CN', providers: [], models: [], modelRoleMap: {} },
    }))
    // 预置 ~/.claude/settings.json（getGeneralConfig 读）
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ theme: 'x', language: 'chinese' }))
    vi.resetModules()
    capturedQueryOptions = null
  })

  afterEach(() => { process.env.HOME = origHome; vi.resetModules() })

  it('query options.settings.autoCompactEnabled === true（SDK 真实自动压缩已启用）', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const { SessionQueryManager } = await import('../src/main/session-query-manager')
    const svc = new ClaudeService()
    svc.setManager(new SessionQueryManager())
    svc.setRegistry(new (await import('../src/main/backend-task-registry')).BackendTaskRegistry())
    const wc: any = { send: () => {} }

    await svc.send({ prompt: 'hi', localSessionId: 's1', webContents: wc })

    expect(capturedQueryOptions).not.toBeNull()
    expect(capturedQueryOptions.settings?.autoCompactEnabled).toBe(true)
  })

  it('query options 含 model / permissionMode / systemPrompt（核心调用配置不丢）', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const { SessionQueryManager } = await import('../src/main/session-query-manager')
    const svc = new ClaudeService()
    svc.setManager(new SessionQueryManager())
    svc.setRegistry(new (await import('../src/main/backend-task-registry')).BackendTaskRegistry())
    const wc: any = { send: () => {} }

    await svc.send({ prompt: 'hi', localSessionId: 's2', permission: '计划模式', thinking: 'high', webContents: wc })

    expect(capturedQueryOptions.model).toBe('glm-5.2')
    expect(capturedQueryOptions.permissionMode).toBe('plan')
    expect(capturedQueryOptions.effort).toBe('high')
    expect(capturedQueryOptions.systemPrompt?.preset).toBe('claude_code')
  })
})
