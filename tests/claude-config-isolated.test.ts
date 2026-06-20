// 验证 claude-config 的所有读写都落在 CLAUDE_CONFIG_DIR（~/.cc-desk/claude），
// 不再触碰 ~/.claude。隔离到临时 HOME，断言落盘路径精确。
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import fsp from 'fs/promises'

const TMP_HOME = path.join(os.tmpdir(), `cc-desk-cfgiso-${Date.now()}-${process.pid}`)
const ORIG_HOME = process.env.HOME
const ORIG_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
  fs.mkdirSync(TMP_HOME, { recursive: true })
  process.env.HOME = TMP_HOME
  delete process.env.CLAUDE_CONFIG_DIR
  vi.resetModules()
})

afterAll(() => {
  process.env.HOME = ORIG_HOME
  if (ORIG_CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIG_CLAUDE_CONFIG_DIR
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

// 缓存 paths 模块，beforeEach 后动态导入取最新 CLAUDE_CONFIG_DIR
let pathsMod: any
beforeEach(async () => { pathsMod = await import('../src/main/paths') })

function expectedPaths() {
  const { CLAUDE_CONFIG_DIR } = pathsMod
  return {
    claudeConfigDir: CLAUDE_CONFIG_DIR,
    settingsPath: path.join(CLAUDE_CONFIG_DIR, 'settings.json'),
    globalPath: path.join(CLAUDE_CONFIG_DIR, '.claude.json'),
    installedPluginsPath: path.join(CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'),
  }
}

describe('claude-config 数据源隔离到 CLAUDE_CONFIG_DIR', () => {
  it('settings.json 读写落在隔离目录，不碰 ~/.claude', async () => {
    const { mod } = { mod: await import('../src/main/claude-config') }
    const { settingsPath } = expectedPaths()
    await mod.saveModelConfig({ apiKey: 'sk-iso', model: 'qwen' })
    expect(fs.existsSync(settingsPath)).toBe(true)
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(raw.env.ANTHROPIC_API_KEY).toBe('sk-iso')
    expect(raw.model).toBe('qwen')
    // 真实 ~/.claude 不应被创建
    const realClaude = path.join(TMP_HOME, '.claude', 'settings.json')
    expect(fs.existsSync(realClaude)).toBe(false)
  })

  it('.claude.json (mcpServers) 读写落在隔离目录', async () => {
    const mod = await import('../src/main/claude-config')
    const { globalPath } = expectedPaths()
    await mod.saveMcpServers([
      { id: 'm1', name: 'm1', transport: 'stdio', command: 'node', args: 'a.js', env: '', headers: '', enabled: true, scope: '用户' },
    ])
    expect(fs.existsSync(globalPath)).toBe(true)
    const raw = JSON.parse(fs.readFileSync(globalPath, 'utf-8'))
    expect(raw.mcpServers.m1.command).toBe('node')
    const realGlobal = path.join(TMP_HOME, '.claude.json')
    expect(fs.existsSync(realGlobal)).toBe(false)
  })

  it('getModelConfig / getGeneralConfig 读隔离目录', async () => {
    const mod = await import('../src/main/claude-config')
    const { settingsPath } = expectedPaths()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify({
      model: 'glm', theme: 'dark', language: 'Chinese',
      env: { ANTHROPIC_API_KEY: 'sk-x', HTTPS_PROXY: 'http://p:1' },
    }))
    const mc = await mod.getModelConfig()
    expect(mc.model).toBe('glm')
    expect(mc.apiKey).toBe('sk-x')
    const gc = await mod.getGeneralConfig()
    expect(gc.theme).toBe('dark')
    expect(gc.proxy).toBe('http://p:1')
  })

  it('hooks 读写落在隔离目录', async () => {
    const mod = await import('../src/main/claude-config')
    const { settingsPath } = expectedPaths()
    await mod.saveHooks({ PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'echo test' }] }] })
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(Array.isArray(raw.hooks.PreToolUse)).toBe(true)
  })

  it('setPluginEnabled 写隔离目录的 settings.json', async () => {
    const mod = await import('../src/main/claude-config')
    const { settingsPath } = expectedPaths()
    await mod.setPluginEnabled('demo@market', true)
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(raw.enabledPlugins['demo@market']).toBe(true)
  })

  it('saveSettingsJson 深合并落在隔离目录', async () => {
    const mod = await import('../src/main/claude-config')
    const { settingsPath } = expectedPaths()
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify({ env: { A: '1' }, keep: 1 }))
    await mod.saveSettingsJson({ env: { B: '2' }, model: 'm' })
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    expect(raw.env).toEqual({ A: '1', B: '2' })
    expect(raw.model).toBe('m')
    expect(raw.keep).toBe(1)
  })
})
