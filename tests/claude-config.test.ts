// claude-config 读取行为测试。
// 隔离到临时 CLAUDE_CONFIG_DIR，验证模块对设置页数据源的正确读取：
// 空目录优雅返回、内置命令恒在、hooks 7 事件恒返回、字段类型正确、有数据时结构完整。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm } from 'fs/promises'

const TMP_DIR = join(tmpdir(), `cc-cfg-read-${Math.random().toString(36).slice(2)}-${Date.now()}`)
let origDir: string | undefined

beforeEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true })
  await mkdir(TMP_DIR, { recursive: true })
  origDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = TMP_DIR
  vi.resetModules()
})

afterEach(async () => {
  if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = origDir
  vi.resetModules()
  await rm(TMP_DIR, { recursive: true, force: true })
})

describe('claude-config 读取行为（隔离目录）', () => {
  it('MCP: 空目录返回空数组，结构合法', async () => {
    const { getMcpServers } = await import('../src/main/claude-config')
    const servers = await getMcpServers()
    expect(Array.isArray(servers)).toBe(true)
    expect(servers.length).toBe(0)
  })

  it('MCP: 有配置时结构完整', async () => {
    const { getMcpServers } = await import('../src/main/claude-config')
    await writeFile(join(TMP_DIR, '.claude.json'), JSON.stringify({
      mcpServers: { s1: { command: 'node', args: ['a.js'] } },
    }))
    const servers = await getMcpServers()
    expect(servers.length).toBe(1)
    expect(servers[0].name).toBe('s1')
    expect(servers[0].transport).toBe('stdio')
    expect(servers[0].id).toBe(servers[0].name)
  })

  it('插件: 空目录返回空数组', async () => {
    const { getPlugins } = await import('../src/main/claude-config')
    const plugins = await getPlugins()
    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBe(0)
  })

  it('技能: 空目录返回空数组', async () => {
    const { getSkills } = await import('../src/main/claude-config')
    const skills = await getSkills()
    expect(Array.isArray(skills)).toBe(true)
    expect(skills.length).toBe(0)
  })

  it('hooks: 始终返回 7 个标准事件', async () => {
    const { getHooks } = await import('../src/main/claude-config')
    const hooks = await getHooks()
    expect(hooks.length).toBe(7)
    expect(hooks.map(h => h.name)).toEqual([
      'PreToolUse', 'PostToolUse', 'Notification',
      'UserPromptSubmit', 'Stop', 'SubagentStop', 'PreCompact',
    ])
  })

  it('模型配置: 空目录所有字段为空字符串', async () => {
    const { getModelConfig } = await import('../src/main/claude-config')
    const cfg = await getModelConfig()
    for (const k of ['model', 'apiKey', 'baseUrl', 'authToken', 'opusModel', 'sonnetModel', 'haikuModel'] as const) {
      expect(typeof cfg[k]).toBe('string')
      expect(cfg[k]).toBe('')
    }
  })

  it('常规配置: 空目录返回默认值', async () => {
    const { getGeneralConfig } = await import('../src/main/claude-config')
    const g = await getGeneralConfig()
    expect(g.theme).toBe('dark')
    expect(g.language).toBe('English')
    expect(g.proxy).toBe('')
  })
})

describe('getCommands 含内置命令', () => {
  it('返回的命令里包含 /init /compact /clear 等 builtin', async () => {
    const { getCommands } = await import('../src/main/claude-config')
    const cmds = await getCommands()
    const names = cmds.map(c => c.name)
    expect(names).toContain('/init')
    expect(names).toContain('/compact')
    expect(names).toContain('/clear')
    expect(names).toContain('/review')
  })
  it('内置命令 kind 为 builtin 且带 builtinAction', async () => {
    const { getCommands } = await import('../src/main/claude-config')
    const cmds = await getCommands()
    const init = cmds.find(c => c.name === '/init')
    expect(init).toBeDefined()
    expect(init!.kind).toBe('builtin')
    expect(init!.builtinAction).toBeDefined()
    expect(init!.builtinAction!.type).toBe('init-project')
  })
  it('内置命令排在返回数组最前（前 17 条全是 builtin）', async () => {
    const { getCommands } = await import('../src/main/claude-config')
    const cmds = await getCommands()
    const first17 = cmds.slice(0, 17)
    expect(first17.every(c => c.kind === 'builtin')).toBe(true)
  })
})
