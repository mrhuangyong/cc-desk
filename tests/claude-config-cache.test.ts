// claude-config 扫描缓存失效测试。
// 重点：验证 getSkills/getPlugins/getCommands/getHooksFull 的 bust-on-write 缓存——
// 写操作后，同一模块引用下的下次读取必须反映新数据（不能返回 stale 缓存）。
// 关键区别于 claude-config-write.test.ts：本测试在一次 import 内做 write→read，
// 不用 vi.resetModules()（resetModules 会重新加载模块、绕过缓存，测不出失效 bug）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, mkdir as mkdirP } from 'fs/promises'

async function withFakeConfigDir() {
  const fakeDir = join(tmpdir(), `cc-cfg-cache-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = fakeDir
  vi.resetModules()
  const mod = await import('../src/main/claude-config')
  return { mod, fakeDir }
}

// 在 fakeDir 下塞一个最小插件（manifest + 一个 skill），供 getPlugins/getSkills 扫到。
async function seedPlugin(fakeDir: string, pluginId: string, name: string, withSkill = true) {
  const installPath = join(fakeDir, 'plugins', 'cache', pluginId)
  const manifestDir = join(installPath, '.claude-plugin')
  await mkdirP(manifestDir, { recursive: true })
  await writeFile(join(manifestDir, 'plugin.json'), JSON.stringify({ name, description: `${name} desc`, version: '1.0.0' }))
  if (withSkill) {
    const skillDir = join(installPath, 'skills', 'my-skill')
    await mkdirP(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: my-skill\ndescription: a skill\n---\nbody`)
  }
  // 登记 installed_plugins.json + 启用
  const installedPath = join(fakeDir, 'plugins', 'installed_plugins.json')
  await mkdirP(join(fakeDir, 'plugins'), { recursive: true })
  await writeFile(installedPath, JSON.stringify({ version: 1, plugins: { [pluginId]: [{ scope: 'user', installPath, version: '1.0.0' }] } }))
  const settingsPath = join(fakeDir, 'settings.json')
  await writeFile(settingsPath, JSON.stringify({ enabledPlugins: { [pluginId]: true } }))
}

describe('claude-config 扫描缓存失效', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CLAUDE_CONFIG_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = origDir
    vi.resetModules()
  })

  it('getPlugins 命中缓存：二次调用不重扫（同引用），但 setPluginEnabled 后失效读到新状态', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await seedPlugin(fakeDir, 'p1@local', 'plugin-one')
    const first = await mod.getPlugins()
    expect(first).toHaveLength(1)
    expect(first[0].enabled).toBe(true)
    // 二次调用走缓存（同引用）
    const cached = await mod.getPlugins()
    expect(cached).toBe(first)
    // 禁用插件后，缓存必须失效，读到 enabled=false
    await mod.setPluginEnabled('p1@local', false)
    const after = await mod.getPlugins()
    expect(after[0].enabled).toBe(false)
  })

  it('setSkillEnabled 后 getSkills 失效：禁用的技能标记为 enabled=false', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await seedPlugin(fakeDir, 'p1@local', 'plugin-one', true)
    const before = await mod.getSkills()
    expect(before.some(s => s.name === 'my-skill' && s.enabled)).toBe(true)
    // 禁用 my-skill
    await mod.setSkillEnabled('my-skill', false)
    const after = await mod.getSkills()
    expect(after.some(s => s.name === 'my-skill' && s.enabled)).toBe(false)
  })

  it('saveSkillFile 后 getSkills 失效（frontmatter 可能变）', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await seedPlugin(fakeDir, 'p1@local', 'plugin-one', true)
    const before = await mod.getSkills()
    const skill = before.find(s => s.name === 'my-skill')!
    // 改写 SKILL.md 的 frontmatter name
    await mod.saveSkillFile(skill.id, `---\nname: renamed-skill\ndescription: x\n---\nbody`)
    const after = await mod.getSkills()
    expect(after.some(s => s.name === 'renamed-skill')).toBe(true)
    expect(after.some(s => s.name === 'my-skill')).toBe(false)
  })

  it('createCommand / deleteCommand 后 getCommands 失效', async () => {
    const { mod } = await withFakeConfigDir()
    const before = await mod.getCommands()
    const builtinCount = before.length
    // 创建命令
    await mod.createCommand('my-cmd', '测试')
    const afterCreate = await mod.getCommands()
    expect(afterCreate.length).toBe(builtinCount + 1)
    expect(afterCreate.some(c => c.name === '/my-cmd')).toBe(true)
    // 删除命令
    await mod.deleteCommand('my-cmd')
    const afterDelete = await mod.getCommands()
    expect(afterDelete.some(c => c.name === '/my-cmd')).toBe(false)
  })

  it('saveHooks 后 getHooksFull 失效', async () => {
    const { mod } = await withFakeConfigDir()
    const before = await mod.getHooksFull()
    expect(before.custom.length).toBe(0)
    // 加一个 hook（PreToolUse 是合法事件）
    await mod.saveHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] })
    const after = await mod.getHooksFull()
    expect(after.custom.length).toBeGreaterThan(0)
  })

  it('writeInstalledPlugins 后 getPlugins 失效（直接写 installed_plugins.json 不经过 setter）', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await seedPlugin(fakeDir, 'p1@local', 'plugin-one')
    const before = await mod.getPlugins()
    expect(before).toHaveLength(1)
    // 直接构造第二个插件文件结构，再调 writeInstalledPlugins 登记（触发 bust）
    await seedPlugin(fakeDir, 'p2@local', 'plugin-two')
    const installed = await mod.readInstalledPlugins()
    await mod.writeInstalledPlugins(installed)
    const after = await mod.getPlugins()
    expect(after.some(p => p.name === 'plugin-two')).toBe(true)
  })
})
