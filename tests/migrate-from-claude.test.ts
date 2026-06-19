// 迁移逻辑测试：从 ~/.claude 迁移插件/技能/设置到 CLAUDE_CONFIG_DIR。
// 全程隔离到临时目录，构造假源、验证迁移结果（路径改写、字段合并、排除 env/model、幂等）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import fsp from 'fs/promises'

const TMP = path.join(os.tmpdir(), `cc-desk-migrate-${Date.now()}-${process.pid}`)
const ORIG_HOME = process.env.HOME
const ORIG_DIR = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  process.env.HOME = TMP
  delete process.env.CLAUDE_CONFIG_DIR
  vi.resetModules()
})

afterEach(() => {
  process.env.HOME = ORIG_HOME
  if (ORIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIG_DIR
  vi.resetModules()
  fs.rmSync(TMP, { recursive: true, force: true })
})

// 构造假的 ~/.claude 源目录
async function buildFakeSource(home: string) {
  const srcClaude = path.join(home, '.claude')
  // settings.json：含 env（应排除）+ enabledPlugins/hooks/theme（应迁移）
  await fsp.mkdir(srcClaude, { recursive: true })
  await fsp.writeFile(path.join(srcClaude, 'settings.json'), JSON.stringify({
    env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5-turbo', ANTHROPIC_API_KEY: 'sk-should-exclude' },
    model: 'mimo-v2.5-pro',
    theme: 'dark',
    language: 'Chinese',
    enabledPlugins: { 'demo@market': true },
    extraKnownMarketplaces: { market: { source: { source: 'github', repo: 'x/y' } } },
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo' }] }] },
    permissions: { allow: ['Bash(ls)'] },
  }, null, 2))
  // installed_plugins.json：含指向 ~/.claude 的绝对路径
  await fsp.mkdir(path.join(srcClaude, 'plugins'), { recursive: true })
  await fsp.writeFile(path.join(srcClaude, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'demo@market': [{
        scope: 'user',
        installPath: path.join(srcClaude, 'plugins', 'cache', 'market', 'demo', '1.0'),
        version: '1.0',
        installedAt: '2026-01-01T00:00:00Z',
      }],
    },
  }))
  await fsp.writeFile(path.join(srcClaude, 'plugins', 'known_marketplaces.json'), JSON.stringify({
    market: {
      source: { source: 'github', repo: 'x/y' },
      installLocation: path.join(srcClaude, 'plugins', 'marketplaces', 'market'),
      lastUpdated: '2026-01-01T00:00:00Z',
    },
  }))
  // 插件缓存实体（含 SKILL.md）
  const skillDir = path.join(srcClaude, 'plugins', 'cache', 'market', 'demo', '1.0', 'skills', 'my-skill')
  await fsp.mkdir(skillDir, { recursive: true })
  await fsp.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: my-skill\ndescription: test\n---\n')
  // 用户级 skills
  const userSkill = path.join(srcClaude, 'skills', 'user-skill')
  await fsp.mkdir(userSkill, { recursive: true })
  await fsp.writeFile(path.join(userSkill, 'SKILL.md'), '---\nname: user-skill\ndescription: user\n---\n')
}

describe('从 ~/.claude 迁移到 CLAUDE_CONFIG_DIR', () => {
  it('迁移 plugins 目录并改写 installPath / installLocation 指向隔离目录', async () => {
    await buildFakeSource(TMP)
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    const { CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    await migrateFromClaude()

    const installed = JSON.parse(fs.readFileSync(path.join(CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), 'utf-8'))
    expect(installed.plugins['demo@market'][0].installPath).toBe(
      path.join(CLAUDE_CONFIG_DIR, 'plugins', 'cache', 'market', 'demo', '1.0'),
    )
    const known = JSON.parse(fs.readFileSync(path.join(CLAUDE_CONFIG_DIR, 'plugins', 'known_marketplaces.json'), 'utf-8'))
    expect(known.market.installLocation).toBe(path.join(CLAUDE_CONFIG_DIR, 'plugins', 'marketplaces', 'market'))
  })

  it('迁移插件缓存实体文件（SKILL.md 可读）', async () => {
    await buildFakeSource(TMP)
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    const { CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    await migrateFromClaude()
    const skillMd = path.join(CLAUDE_CONFIG_DIR, 'plugins', 'cache', 'market', 'demo', '1.0', 'skills', 'my-skill', 'SKILL.md')
    expect(fs.existsSync(skillMd)).toBe(true)
    expect(fs.readFileSync(skillMd, 'utf-8')).toContain('my-skill')
  })

  it('迁移用户级 skills/ 目录', async () => {
    await buildFakeSource(TMP)
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    const { CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    await migrateFromClaude()
    const userSkill = path.join(CLAUDE_CONFIG_DIR, 'skills', 'user-skill', 'SKILL.md')
    expect(fs.existsSync(userSkill)).toBe(true)
  })

  it('合并 settings.json：迁移 enabledPlugins/theme/hooks，排除 env 和 model', async () => {
    await buildFakeSource(TMP)
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    const { CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    await migrateFromClaude()
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_CONFIG_DIR, 'settings.json'), 'utf-8'))
    expect(s.enabledPlugins['demo@market']).toBe(true)
    expect(s.theme).toBe('dark')
    expect(s.language).toBe('Chinese')
    expect(s.hooks.PreToolUse).toBeDefined()
    // env 和 model 必须排除（避免污染 cc-desk 运行时）
    expect(s.env).toBeUndefined()
    expect(s.model).toBeUndefined()
  })

  it('settings.json 不覆盖隔离目录已有内容（只合并缺失字段）', async () => {
    await buildFakeSource(TMP)
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    const { CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    // 预置隔离目录已有 settings.json（cc-desk 自己写的）
    await fsp.mkdir(CLAUDE_CONFIG_DIR, { recursive: true })
    await fsp.writeFile(path.join(CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({
      env: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen' },
      model: 'qwen',
    }))
    await migrateFromClaude()
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_CONFIG_DIR, 'settings.json'), 'utf-8'))
    // 已有的 cc-desk 运行时配置保留
    expect(s.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('qwen')
    expect(s.model).toBe('qwen')
    // 迁移的字段补充进来
    expect(s.enabledPlugins['demo@market']).toBe(true)
  })

  it('幂等：已迁移后再次调用不重复迁移（plugins 已存在则跳过）', async () => {
    await buildFakeSource(TMP)
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    const { CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    await migrateFromClaude()
    const marker = JSON.parse(fs.readFileSync(path.join(CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), 'utf-8'))
    // 第二次迁移应跳过（plugins 目录已存在），installPath 不变
    await migrateFromClaude()
    const marker2 = JSON.parse(fs.readFileSync(path.join(CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), 'utf-8'))
    expect(marker2).toEqual(marker)
  })

  it('源目录不存在时安全返回（不报错）', async () => {
    // TMP 下没有 .claude
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    await expect(migrateFromClaude()).resolves.not.toThrow()
  })

  it('返回迁移状态摘要', async () => {
    await buildFakeSource(TMP)
    const { migrateFromClaude } = await import('../src/main/migrate-from-claude')
    const result = await migrateFromClaude()
    expect(result.migrated).toBe(true)
    expect(result.plugins).toBeGreaterThan(0)
  })
})
