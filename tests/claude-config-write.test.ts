// claude-config 写操作真实落盘测试。
// 用动态导入 + 临时 CLAUDE_CONFIG_DIR 隔离，验证 save*/set*Enabled 真实写盘、读回一致、保留未知字段。
// 全程隔离到 os.tmpdir()，不触碰真实 ~/.cc-desk/claude。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

// 隔离 CLAUDE_CONFIG_DIR 的工厂：返回动态导入的 claude-config 模块，路径指向临时目录。
// claude-config 所有读写（settings.json / .claude.json / plugins/）均落在此目录下。
async function withFakeConfigDir() {
  const fakeDir = join(tmpdir(), `cc-cfg-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = fakeDir
  vi.resetModules()
  const mod = await import('../src/main/claude-config')
  return { mod, fakeDir }
}

async function readJsonFile(p: string): Promise<any> {
  if (!existsSync(p)) return undefined
  return JSON.parse(await readFile(p, 'utf-8'))
}

describe('claude-config 写操作真实落盘', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CLAUDE_CONFIG_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = origDir
    vi.resetModules()
  })

  it('saveMcpServers：写 .claude.json 的 mcpServers，http 与 stdio 两种形态', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.saveMcpServers([
      { id: 'stdio1', name: 'stdio1', transport: 'stdio', command: 'node', args: 'a.js b', env: 'K=V', enabled: true, scope: '用户' },
      { id: 'http1', name: 'http1', transport: 'http', command: 'https://x.io', args: '', env: '', enabled: true, scope: '用户' },
    ])
    const data = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(data.mcpServers.stdio1.command).toBe('node')
    expect(data.mcpServers.stdio1.args).toEqual(['a.js', 'b'])
    expect(data.mcpServers.stdio1.env).toEqual({ K: 'V' })
    expect(data.mcpServers.http1.type).toBe('http')
    expect(data.mcpServers.http1.url).toBe('https://x.io')
    const back = await mod.getMcpServers()
    expect(back.find(s => s.name === 'http1')?.transport).toBe('http')
  })

  it('buildMcpEntry 归一化：args/env 字符串形态正确落盘（现有行为回归）', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.saveMcpServers([
      { id: 's', name: 's', transport: 'stdio', command: 'npx',
        args: '-y @playwright/mcp@latest', env: 'API_KEY=secret\nNODE_ENV=prod',
        headers: '', enabled: true, scope: '用户' } as any,
    ])
    const data = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(data.mcpServers.s.args).toEqual(['-y', '@playwright/mcp@latest'])
    expect(data.mcpServers.s.env).toEqual({ API_KEY: 'secret', NODE_ENV: 'prod' })
  })

  it('http 类型 headers 写盘与往返', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.saveMcpServers([
      { id: 'h', name: 'h', transport: 'http', command: 'https://api.example.com',
        args: '', env: '', headers: 'Authorization: Bearer xxx\nContent-Type: application/json',
        enabled: true, scope: '用户' } as any,
    ])
    const data = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(data.mcpServers.h.type).toBe('http')
    expect(data.mcpServers.h.url).toBe('https://api.example.com')
    expect(data.mcpServers.h.headers).toEqual({
      Authorization: 'Bearer xxx',
      'Content-Type': 'application/json',
    })
    const back = await mod.getMcpServers()
    const h = back.find(s => s.name === 'h')!
    expect(h.transport).toBe('http')
    expect(h.headers).toBe('Authorization: Bearer xxx\nContent-Type: application/json')
  })

  it('saveMcpServers：保留 .claude.json 顶层未知字段（append-only）', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await writeFile(join(fakeDir, '.claude.json'), JSON.stringify({ otherGlobals: { x: 1 }, numInline: 5 }))
    await mod.saveMcpServers([
      { id: 'm', name: 'm', transport: 'stdio', command: 'c', args: '', env: '', enabled: true, scope: '用户' },
    ])
    const data = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(data.otherGlobals).toEqual({ x: 1 })
    expect(data.numInline).toBe(5)
    expect(data.mcpServers.m.command).toBe('c')
  })

  it('saveMcpServers：禁用 MCP 时从 mcpServers 移除并可读回为 disabled', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.saveMcpServers([
      { id: 'enabled-one', name: 'enabled-one', transport: 'stdio', command: 'node', args: 'ok.js', env: '', enabled: true, scope: '用户' },
      { id: 'disabled-one', name: 'disabled-one', transport: 'stdio', command: 'node', args: 'off.js', env: 'K=V', enabled: false, scope: '用户' },
    ])

    const global = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(global.mcpServers['enabled-one']).toBeDefined()
    expect(global.mcpServers['disabled-one']).toBeUndefined()

    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.ccDeskDisabledMcpServers['disabled-one']).toEqual({
      command: 'node',
      args: ['off.js'],
      env: { K: 'V' },
    })

    const back = await mod.getMcpServers()
    expect(back.find(s => s.name === 'enabled-one')?.enabled).toBe(true)
    expect(back.find(s => s.name === 'disabled-one')?.enabled).toBe(false)
  })

  it('saveMcpServers：重新启用暂存 MCP 时写回 mcpServers 并清理 disabled stash', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mkdir(join(fakeDir), { recursive: true })
    await writeFile(join(fakeDir, 'settings.json'), JSON.stringify({
      ccDeskDisabledMcpServers: {
        stashed: { command: 'node', args: ['stashed.js'] },
      },
    }))

    await mod.saveMcpServers([
      { id: 'stashed', name: 'stashed', transport: 'stdio', command: 'node', args: 'stashed.js', env: '', enabled: true, scope: '用户' },
    ])

    const global = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(global.mcpServers.stashed.command).toBe('node')
    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.ccDeskDisabledMcpServers).toEqual({})
  })

  it('saveModelConfig：写 settings.json 的 env + model', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.saveModelConfig({ apiKey: 'sk-1', baseUrl: 'http://x', opusModel: 'glm-5.2', model: 'glm-5.2' })
    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.env.ANTHROPIC_API_KEY).toBe('sk-1')
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://x')
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.2')
    expect(settings.model).toBe('glm-5.2')
    const cfg = await mod.getModelConfig()
    expect(cfg.apiKey).toBe('sk-1')
    expect(cfg.opusModel).toBe('glm-5.2')
  })

  it('saveModelConfig：保留 settings.json 已有 env 字段（深合并）', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await writeFile(join(fakeDir, 'settings.json'), JSON.stringify({ env: { OTHER: 'keep', ANTHROPIC_API_KEY: 'old' } }))
    await mod.saveModelConfig({ baseUrl: 'http://new' })
    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.env.OTHER).toBe('keep')
    expect(settings.env.ANTHROPIC_API_KEY).toBe('old')
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://new')
  })

  it('saveGeneralConfig：写 theme/language/proxy 到 settings.json', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.saveGeneralConfig({ theme: 'dark', language: 'english', proxy: 'http://proxy:8080' })
    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.theme).toBe('dark')
    expect(settings.language).toBe('english')
    expect(settings.env?.HTTP_PROXY).toBe('http://proxy:8080')
  })

  it('saveSettingsJson：对象字段深合并，标量字段覆盖', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await writeFile(join(fakeDir, 'settings.json'), JSON.stringify({ env: { A: '1', B: '2' }, model: 'old', keep: 1 }))
    await mod.saveSettingsJson({ env: { B: '22', C: '3' }, model: 'new' })
    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.env).toEqual({ A: '1', B: '22', C: '3' })
    expect(settings.model).toBe('new')
    expect(settings.keep).toBe(1)
  })

  it('setPluginEnabled(true)：写 enabledPlugins', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.setPluginEnabled('superpowers@anthropic', true)
    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.enabledPlugins['superpowers@anthropic']).toBe(true)
  })

  it('setPluginEnabled(false)：从 enabledPlugins 删除', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await writeFile(join(fakeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'a@b': true, 'c@d': true } }))
    await mod.setPluginEnabled('a@b', false)
    const settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.enabledPlugins['a@b']).toBeUndefined()
    expect(settings.enabledPlugins['c@d']).toBe(true)
  })

  it('setHookEnabled(true/false)：hooks[name] 数组化 / 清空', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.setHookEnabled('PreToolUse', true)
    let settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true)
    expect(settings.hooks.PreToolUse.length).toBeGreaterThan(0)

    await mod.setHookEnabled('PreToolUse', false)
    settings = await readJsonFile(join(fakeDir, 'settings.json'))
    expect(settings.hooks.PreToolUse).toEqual([])
  })
})
