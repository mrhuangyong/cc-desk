// claude-config 写操作真实落盘测试。
// 用动态导入 + 临时 HOME 隔离，验证 save*/set*Enabled 真实写盘、读回一致、保留未知字段。
// 不写真实 ~/.claude —— 全程隔离到 os.tmpdir()。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

// 隔离 HOME 的工厂：返回一个动态导入的 claude-config 模块，其路径指向临时目录。
async function withFakeHome() {
  const fakeHome = join(tmpdir(), `cc-cfg-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(join(fakeHome, '.claude'), { recursive: true })
  process.env.HOME = fakeHome
  vi.resetModules()
  const mod = await import('../src/main/claude-config')
  return { mod, fakeHome }
}

async function readJsonFile(p: string): Promise<any> {
  if (!existsSync(p)) return undefined
  return JSON.parse(await readFile(p, 'utf-8'))
}

describe('claude-config 写操作真实落盘', () => {
  let origHome: string | undefined
  beforeEach(() => { origHome = process.env.HOME })
  afterEach(() => { process.env.HOME = origHome; vi.resetModules() })

  it('saveMcpServers：写 ~/.claude.json 的 mcpServers，http 与 stdio 两种形态', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await mod.saveMcpServers([
      { id: 'stdio1', name: 'stdio1', transport: 'stdio', command: 'node', args: 'a.js b', env: 'K=V', enabled: true, scope: '用户' },
      { id: 'http1', name: 'http1', transport: 'http', command: 'https://x.io', args: '', env: '', enabled: true, scope: '用户' },
    ])
    const data = await readJsonFile(join(fakeHome, '.claude.json'))
    expect(data.mcpServers.stdio1.command).toBe('node')
    expect(data.mcpServers.stdio1.args).toEqual(['a.js', 'b'])
    expect(data.mcpServers.stdio1.env).toEqual({ K: 'V' })
    expect(data.mcpServers.http1.type).toBe('http')
    expect(data.mcpServers.http1.url).toBe('https://x.io')
    // 读回应可还原
    const back = await mod.getMcpServers()
    expect(back.find(s => s.name === 'http1')?.transport).toBe('http')
  })

  it('saveMcpServers：保留 ~/.claude.json 顶层未知字段（append-only）', async () => {
    const { mod, fakeHome } = await withFakeHome()
    // 预置含未知顶层字段
    await writeFile(join(fakeHome, '.claude.json'), JSON.stringify({ otherGlobals: { x: 1 }, numInline: 5 }))
    await mod.saveMcpServers([
      { id: 'm', name: 'm', transport: 'stdio', command: 'c', args: '', env: '', enabled: true, scope: '用户' },
    ])
    const data = await readJsonFile(join(fakeHome, '.claude.json'))
    expect(data.otherGlobals).toEqual({ x: 1 })
    expect(data.numInline).toBe(5)
    expect(data.mcpServers.m.command).toBe('c')
  })

  it('saveModelConfig：写 settings.json 的 env + model', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await mod.saveModelConfig({ apiKey: 'sk-1', baseUrl: 'http://x', opusModel: 'glm-5.2', model: 'glm-5.2' })
    const settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(settings.env.ANTHROPIC_API_KEY).toBe('sk-1')
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://x')
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.2')
    expect(settings.model).toBe('glm-5.2')
    // 读回一致
    const cfg = await mod.getModelConfig()
    expect(cfg.apiKey).toBe('sk-1')
    expect(cfg.opusModel).toBe('glm-5.2')
  })

  it('saveModelConfig：保留 settings.json 已有 env 字段（深合并）', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ env: { OTHER: 'keep', ANTHROPIC_API_KEY: 'old' } }))
    await mod.saveModelConfig({ baseUrl: 'http://new' })
    const settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(settings.env.OTHER).toBe('keep')          // 未知 env 保留
    expect(settings.env.ANTHROPIC_API_KEY).toBe('old') // 未传入的字段保留
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://new')
  })

  it('saveGeneralConfig：写 theme/language/proxy 到 settings.json', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await mod.saveGeneralConfig({ theme: 'dark', language: 'english', proxy: 'http://proxy:8080' })
    const settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(settings.theme).toBe('dark')
    expect(settings.language).toBe('english')
    expect(settings.env?.HTTP_PROXY).toBe('http://proxy:8080')
  })

  it('saveSettingsJson：对象字段深合并，标量字段覆盖', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ env: { A: '1', B: '2' }, model: 'old', keep: 1 }))
    await mod.saveSettingsJson({ env: { B: '22', C: '3' }, model: 'new' })
    const settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(settings.env).toEqual({ A: '1', B: '22', C: '3' })  // 深合并
    expect(settings.model).toBe('new')                          // 标量覆盖
    expect(settings.keep).toBe(1)                               // 未知保留
  })

  it('setPluginEnabled(true)：写 enabledPlugins', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await mod.setPluginEnabled('superpowers@anthropic', true)
    const settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(settings.enabledPlugins['superpowers@anthropic']).toBe(true)
  })

  it('setPluginEnabled(false)：从 enabledPlugins 删除', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await writeFile(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'a@b': true, 'c@d': true } }))
    await mod.setPluginEnabled('a@b', false)
    const settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(settings.enabledPlugins['a@b']).toBeUndefined()
    expect(settings.enabledPlugins['c@d']).toBe(true)  // 其他插件保留
  })

  it('setHookEnabled(true/false)：hooks[name] 数组化 / 清空', async () => {
    const { mod, fakeHome } = await withFakeHome()
    await mod.setHookEnabled('PreToolUse', true)
    let settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true)
    expect(settings.hooks.PreToolUse.length).toBeGreaterThan(0)

    await mod.setHookEnabled('PreToolUse', false)
    settings = await readJsonFile(join(fakeHome, '.claude', 'settings.json'))
    expect(settings.hooks.PreToolUse).toEqual([])
  })
})
