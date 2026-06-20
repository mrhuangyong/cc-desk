// 技能文件读写测试：隔离 CLAUDE_CONFIG_DIR，验证 getSkills 带 path、getSkillFile/saveSkillFile 往返。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, readFile } from 'fs/promises'

async function withFakeConfigDir() {
  const fakeDir = join(tmpdir(), `cc-skill-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = fakeDir
  vi.resetModules()
  const mod = await import('../src/main/claude-config')
  return { mod, fakeDir }
}

describe('技能文件读写', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CLAUDE_CONFIG_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = origDir
    vi.resetModules()
  })

  it('getSkills 返回的技能含 path 字段（用户级技能）', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    const skillDir = join(fakeDir, 'skills', 'my-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: my-skill\ndescription: 测试技能\n---\n\n正文内容\n', 'utf-8')

    const list = await mod.getSkills()
    const s = list.find(x => x.name === 'my-skill')
    expect(s).toBeTruthy()
    expect(s!.path).toBe(join(skillDir, 'SKILL.md'))
  })

  it('getSkillFile 按 id 读取技能全文', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    const skillDir = join(fakeDir, 'skills', 'editor')
    await mkdir(skillDir, { recursive: true })
    const body = '---\nname: editor\ndescription: 编辑器\n---\n\n# 编辑器技能\n\n- 指令一\n'
    await writeFile(join(skillDir, 'SKILL.md'), body, 'utf-8')

    const content = await mod.getSkillFile('user:editor')
    expect(content).toBe(body)
  })

  it('saveSkillFile 按 id 写回，再读一致', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    const skillDir = join(fakeDir, 'skills', 'writer')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: writer\ndescription: 写\n---\n旧内容\n', 'utf-8')

    const next = '---\nname: writer\ndescription: 写\n---\n新内容\n- 更多指令\n'
    await mod.saveSkillFile('user:writer', next)

    const onDisk = await readFile(join(skillDir, 'SKILL.md'), 'utf-8')
    expect(onDisk).toBe(next)
    const back = await mod.getSkillFile('user:writer')
    expect(back).toBe(next)
  })

  it('getSkillFile 对不存在 id 返回空串', async () => {
    const { mod } = await withFakeConfigDir()
    const content = await mod.getSkillFile('user:nope')
    expect(content).toBe('')
  })
})

describe('技能启停（disabledSkills 黑名单）', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CLAUDE_CONFIG_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = origDir
    vi.resetModules()
  })

  it('getSkills：未在黑名单的技能 enabled=true', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    const skillDir = join(fakeDir, 'skills', 'on-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: on-skill\ndescription: 开\n---\n正文\n', 'utf-8')

    const list = await mod.getSkills()
    const s = list.find(x => x.name === 'on-skill')!
    expect(s.enabled).toBe(true)
  })

  it('setSkillEnabled(name,false) 加入黑名单后 getSkills 标记 enabled=false', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    const skillDir = join(fakeDir, 'skills', 'off-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: off-skill\ndescription: 关\n---\n正文\n', 'utf-8')

    await mod.setSkillEnabled('off-skill', false)
    const list = await mod.getSkills()
    const s = list.find(x => x.name === 'off-skill')!
    expect(s.enabled).toBe(false)

    // 落盘到 settings.json 的 disabledSkills
    const settings = JSON.parse(await readFile(join(fakeDir, 'settings.json'), 'utf-8'))
    expect(settings.disabledSkills).toContain('off-skill')
  })

  it('setSkillEnabled(name,true) 从黑名单移除', async () => {
    const { mod } = await withFakeConfigDir()
    await mod.setSkillEnabled('toggle-skill', false)
    await mod.setSkillEnabled('toggle-skill', true)
    const list = await mod.getSkills()
    // 技能文件不存在不影响黑名单状态判断；这里只验证黑名单已清空
    const settings = JSON.parse(await readFile(join(process.env.CLAUDE_CONFIG_DIR!, 'settings.json'), 'utf-8'))
    expect(settings.disabledSkills).not.toContain('toggle-skill')
  })
})
