import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'

const TMP_DIR = join(tmpdir(), `pi-${Math.random().toString(36).slice(2)}-${Date.now()}`)
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

// 构造一个完整的本地 marketplace（仓库目录结构），供安装测试用
async function makeLocalMarketplace(): Promise<string> {
  const mktDir = join(TMP_DIR, 'source-marketplace')
  const mktJsonDir = join(mktDir, '.claude-plugin')
  await mkdir(mktJsonDir, { recursive: true })
  await writeFile(join(mktJsonDir, 'marketplace.json'), JSON.stringify({
    name: 'install-test-market',
    owner: { name: 'tester' },
    plugins: [{ name: 'demo-plugin', description: 'A demo', source: './demo-plugin', version: '1.0.0' }],
  }))
  const pluginDir = join(mktDir, 'demo-plugin')
  const pluginManifestDir = join(pluginDir, '.claude-plugin')
  await mkdir(pluginManifestDir, { recursive: true })
  await writeFile(join(pluginManifestDir, 'plugin.json'), JSON.stringify({
    name: 'demo-plugin', version: '1.0.0', description: 'A demo',
  }))
  await mkdir(join(pluginDir, 'skills', 'greet'), { recursive: true })
  await writeFile(join(pluginDir, 'skills', 'greet', 'SKILL.md'), '---\nname: greet\ndescription: greet skill\n---\nHello')
  return mktDir
}

describe('installPlugin', () => {
  it('本地相对路径 source 安装成功', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const { installPlugin, getPlugins } = await import('../src/main/claude-config')

    const mktDir = await makeLocalMarketplace()
    await addMarketplace(mktDir)

    const result = await installPlugin('demo-plugin@install-test-market')
    expect(result.success).toBe(true)

    const plugins = await getPlugins()
    expect(plugins.find(p => p.id === 'demo-plugin@install-test-market')).toBeTruthy()

    const settings = JSON.parse(await readFile(join(TMP_DIR, 'settings.json'), 'utf-8'))
    expect(settings.enabledPlugins['demo-plugin@install-test-market']).toBe(true)
  })
  it('重复安装幂等（version 相同不报错）', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const { installPlugin } = await import('../src/main/claude-config')

    const mktDir = await makeLocalMarketplace()
    await addMarketplace(mktDir)
    await installPlugin('demo-plugin@install-test-market')
    const r2 = await installPlugin('demo-plugin@install-test-market')
    expect(r2.success).toBe(true)
  })
})

describe('uninstallPlugin', () => {
  it('删除 cache + 移除 installed_plugins + 移除 enabledPlugins', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const { installPlugin, uninstallPlugin, getPlugins } = await import('../src/main/claude-config')

    const mktDir = await makeLocalMarketplace()
    await addMarketplace(mktDir)
    await installPlugin('demo-plugin@install-test-market')

    const result = await uninstallPlugin('demo-plugin@install-test-market')
    expect(result.success).toBe(true)

    const plugins = await getPlugins()
    expect(plugins.find(p => p.id === 'demo-plugin@install-test-market')).toBeFalsy()

    const settings = JSON.parse(await readFile(join(TMP_DIR, 'settings.json'), 'utf-8'))
    expect(settings.enabledPlugins['demo-plugin@install-test-market']).toBeUndefined()
  })
  it('卸载未安装插件报错', async () => {
    const { uninstallPlugin } = await import('../src/main/claude-config')
    await expect(uninstallPlugin('not-installed@no-market')).rejects.toThrow()
  })
})
