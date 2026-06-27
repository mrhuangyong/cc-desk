// remote-config 写操作真实落盘测试。
// 隔离方式：设置 process.env.CC_DESK_DIR 指向 os.tmpdir() 下临时目录 + vi.resetModules() 动态重导入。
// 说明：paths.ts 的 CC_DESK_DIR = process.env.CC_DESK_DIR || join(homedir(), '.cc-desk')，
// env 覆盖与 CLAUDE_CONFIG_DIR 同模式，故可用 env 隔离，不触碰真实 ~/.cc-desk/config.json。
// 全程落盘真实，禁止 mock（参考 claude-config-write.test.ts）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// 隔离 CC_DESK_DIR 的工厂：返回动态导入的 remote-config 模块，路径指向临时目录。
// remote-config 落 ~/.cc-desk/config.json 的 remote 段。
async function withFakeCcDeskDir() {
  const fakeDir = join(tmpdir(), `cc-desk-remote-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CC_DESK_DIR = fakeDir
  vi.resetModules()
  const mod = await import('../src/main/remote-config')
  return { mod, fakeDir }
}

async function readJsonFile(p: string): Promise<any> {
  if (!existsSync(p)) return undefined
  return JSON.parse(await readFile(p, 'utf-8'))
}

describe('remote-config', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CC_DESK_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CC_DESK_DIR
    else process.env.CC_DESK_DIR = origDir
    vi.resetModules()
  })

  it('getRemoteConfig 默认值：disabled，默认域名，无 deviceId', async () => {
    const { mod } = await withFakeCcDeskDir()
    const cfg = mod.getRemoteConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.relayUrl).toBe('https://ccdesk.mrhua.top')
    expect(cfg.deviceId).toBe('')
    expect(cfg.deviceKey).toBe('')
    expect(cfg.pairedDevices).toEqual([])
  })

  it('saveRemoteConfig 浅合并 patch，保留未传字段', async () => {
    const { mod } = await withFakeCcDeskDir()
    mod.saveRemoteConfig({ enabled: true })
    expect(mod.getRemoteConfig().enabled).toBe(true)
    expect(mod.getRemoteConfig().relayUrl).toBe('https://ccdesk.mrhua.top') // 未传保留
    expect(mod.getRemoteConfig().deviceKey).toBe('')
  })

  it('saveRemoteConfig 真实落盘到 config.json 的 remote 段', async () => {
    const { mod, fakeDir } = await withFakeCcDeskDir()
    mod.saveRemoteConfig({ enabled: true, relayUrl: 'https://relay.example.com', pairedDevices: ['device-abc'] })
    const data = await readJsonFile(join(fakeDir, 'config.json'))
    expect(data.remote.enabled).toBe(true)
    expect(data.remote.relayUrl).toBe('https://relay.example.com')
    expect(data.remote.pairedDevices).toEqual(['device-abc'])
  })

  it('saveRemoteConfig 保留 config.json 顶层未知字段（append-only）', async () => {
    const { mod, fakeDir } = await withFakeCcDeskDir()
    // 模拟 config.json 已有 model 配置段（cc-desk-store 写 config 段）
    const { writeFile } = await import('fs/promises')
    await writeFile(join(fakeDir, 'config.json'), JSON.stringify({ config: { providers: [{ id: 'keep' }] }, otherTop: 1 }))
    mod.saveRemoteConfig({ enabled: true })
    const data = await readJsonFile(join(fakeDir, 'config.json'))
    expect(data.config.providers[0].id).toBe('keep') // model 配置段保留
    expect(data.otherTop).toBe(1) // 未知顶层字段保留
    expect(data.remote.enabled).toBe(true)
  })

  it('ensureDeviceIdentity 首次生成 deviceId+deviceKey，二次返回同一组', async () => {
    const { mod } = await withFakeCcDeskDir()
    const a = mod.ensureDeviceIdentity()
    expect(a.deviceId).toBeTruthy()
    expect(a.deviceKey).toBeTruthy()
    // deviceKey 是 base64 编码的 32 字节随机数（解码后 32 字节）
    expect(Buffer.from(a.deviceKey, 'base64').length).toBe(32)
    const b = mod.ensureDeviceIdentity()
    expect(b.deviceId).toBe(a.deviceId)
    expect(b.deviceKey).toBe(a.deviceKey)
  })

  it('ensureDeviceIdentity 真实持久化到 config.json', async () => {
    const { mod, fakeDir } = await withFakeCcDeskDir()
    mod.ensureDeviceIdentity()
    const data = await readJsonFile(join(fakeDir, 'config.json'))
    expect(data.remote.deviceId).toBeTruthy()
    expect(data.remote.deviceKey).toBeTruthy()
  })
})
