import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'

const TMP_DIR = join(tmpdir(), `mkt-${Math.random().toString(36).slice(2)}-${Date.now()}`)
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

describe('parseSource 智能识别', () => {
  it('github owner/repo 简写', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('anthropics/claude-plugins')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('github 完整 HTTPS URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://github.com/anthropics/claude-plugins')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('github SSH URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('git@github.com:anthropics/claude-plugins.git')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('git 非 github URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://gitlab.com/team/plugins.git')
    expect(s.source).toBe('git')
    expect((s as any).url).toBe('https://gitlab.com/team/plugins.git')
  })
  it('url 直链 json', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://example.com/marketplace.json')
    expect(s.source).toBe('url')
    expect((s as any).url).toBe('https://example.com/marketplace.json')
  })
  it('file 本地 json 路径', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    await writeFile(join(TMP_DIR, 'm.json'), '{}')
    const s = parseSource(join(TMP_DIR, 'm.json'))
    expect(s.source).toBe('file')
  })
  it('directory 本地目录路径', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    await mkdir(join(TMP_DIR, 'mydir'), { recursive: true })
    const s = parseSource(join(TMP_DIR, 'mydir'))
    expect(s.source).toBe('directory')
  })
})

// 构造一个合法的 marketplace.json 用于 url/file 测试
async function makeTmpMarketplace(): Promise<string> {
  const mp = join(TMP_DIR, 'fake-marketplace.json')
  await writeFile(mp, JSON.stringify({
    name: 'test-market',
    owner: { name: 'tester' },
    plugins: [
      { name: 'plugin-a', description: 'A plugin', source: './plugin-a', version: '1.0.0' },
    ],
  }))
  return mp
}

describe('addMarketplace + getMarketplaces', () => {
  it('file 类型添加成功', async () => {
    const { addMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    const result = await addMarketplace(mpPath)
    expect(result.name).toBe('test-market')
    const list = await getMarketplaces()
    expect(list.length).toBe(1)
    expect(list[0].source).toMatchObject({ source: 'file' })
    expect(list[0].name).toBe('test-market')
  })
  it('source 幂等：相同 source 不重复添加', async () => {
    const { addMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)
    const r2 = await addMarketplace(mpPath)
    expect(r2.alreadyExists).toBe(true)
    const list = await getMarketplaces()
    expect(list.length).toBe(1)
  })
  it('marketplace.json 校验失败时报错', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const badPath = join(TMP_DIR, 'bad.json')
    await writeFile(badPath, '{ not json')
    await expect(addMarketplace(badPath)).rejects.toThrow()
  })
  it('空目录 getMarketplaces 返回空数组', async () => {
    const { getMarketplaces } = await import('../src/main/marketplace-manager')
    const list = await getMarketplaces()
    expect(list).toEqual([])
  })
})

describe('removeMarketplace', () => {
  it('删除条目 + 清理缓存 + 级联移除 enabledPlugins', async () => {
    const { addMarketplace, removeMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const { writeInstalledPlugins } = await import('../src/main/claude-config')

    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)

    // 模拟已安装的插件：写 installed_plugins.json + settings.json
    await writeInstalledPlugins({
      plugins: {
        'plugin-a@test-market': [{ scope: 'user', installPath: join(TMP_DIR, 'fake-cache'), version: '1.0.0' }],
      },
    })
    await writeFile(join(TMP_DIR, 'settings.json'), JSON.stringify({
      enabledPlugins: { 'plugin-a@test-market': true, 'other@other-market': true },
    }))

    const result = await removeMarketplace('test-market')
    expect(result.cascadedPlugins).toContain('plugin-a')

    // known_marketplaces.json 已移除
    const list = await getMarketplaces()
    expect(list.find(m => m.name === 'test-market')).toBeUndefined()

    // settings.json 的 enabledPlugins 里 @test-market 后缀的已移除，保留 other
    const settings = JSON.parse(await readFile(join(TMP_DIR, 'settings.json'), 'utf-8'))
    expect(settings.enabledPlugins['plugin-a@test-market']).toBeUndefined()
    expect(settings.enabledPlugins['other@other-market']).toBe(true)
  })
  it('删除不存在的仓库报错', async () => {
    const { removeMarketplace } = await import('../src/main/marketplace-manager')
    await expect(removeMarketplace('nonexistent')).rejects.toThrow()
  })
})

describe('refreshMarketplace', () => {
  it('file 类型刷新成功并更新 lastUpdated', async () => {
    const { addMarketplace, refreshMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)
    const before = (await getMarketplaces())[0]
    await new Promise(r => setTimeout(r, 50))
    await refreshMarketplace('test-market')
    const after = (await getMarketplaces())[0]
    expect(new Date(after.lastUpdated).getTime()).toBeGreaterThan(new Date(before.lastUpdated).getTime())
  })
})

describe('setAutoUpdate', () => {
  it('切换 autoUpdate 标记', async () => {
    const { addMarketplace, setMarketplaceAutoUpdate, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath, { autoUpdate: true })
    await setMarketplaceAutoUpdate('test-market', false)
    const m = (await getMarketplaces())[0]
    expect(m.autoUpdate).toBe(false)
  })
})
