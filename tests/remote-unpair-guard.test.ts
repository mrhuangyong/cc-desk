// shouldRecordPaired 解绑保护测试（I1 回归）。
// 用户主动 unpair 后，若该设备仍在中继 binding 里（中继 v1 无 unbind），收到其业务信封
// 不应被自动加回 pairedDevices。隔离方式同 remote-config.test.ts：CC_DESK_DIR 指向临时目录。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'

async function withFakeCcDeskDir() {
  const fakeDir = join(tmpdir(), `cc-desk-paired-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CC_DESK_DIR = fakeDir
  vi.resetModules()
  return await import('../src/main/remote-config')
}

describe('shouldRecordPaired 解绑保护', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CC_DESK_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CC_DESK_DIR
    else process.env.CC_DESK_DIR = origDir
    vi.resetModules()
  })

  it('未解绑的新设备应登记', async () => {
    const mod = await withFakeCcDeskDir()
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: [] }
    expect(mod.shouldRecordPaired(cfg, 'MOBILE-NEW')).toBe(true)
  })

  it('空 deviceId 不登记', async () => {
    const mod = await withFakeCcDeskDir()
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: [] }
    expect(mod.shouldRecordPaired(cfg, '')).toBe(false)
  })

  it('本机 deviceId 不登记（自环保护）', async () => {
    const mod = await withFakeCcDeskDir()
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: [] }
    expect(mod.shouldRecordPaired(cfg, 'DESK')).toBe(false)
  })

  it('已配对设备不重复登记', async () => {
    const mod = await withFakeCcDeskDir()
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: ['M1'] }
    expect(mod.shouldRecordPaired(cfg, 'M1')).toBe(false)
  })

  it('解绑后该设备不再登记（核心回归）', async () => {
    const mod = await withFakeCcDeskDir()
    mod.markUnpaired('M-UNPAIR')
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: [] }
    expect(mod.shouldRecordPaired(cfg, 'M-UNPAIR')).toBe(false)
  })

  it('解绑 A 不影响其他设备 B 登记', async () => {
    const mod = await withFakeCcDeskDir()
    mod.markUnpaired('A')
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: [] }
    expect(mod.shouldRecordPaired(cfg, 'B')).toBe(true)
  })

  it('重新发起配对（clearUnpaired）后，被解绑设备可再次登记', async () => {
    const mod = await withFakeCcDeskDir()
    mod.markUnpaired('M-UNPAIR')
    mod.clearUnpaired()
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: [] }
    expect(mod.shouldRecordPaired(cfg, 'M-UNPAIR')).toBe(true)
  })

  it('markUnpaired 空字符串为 noop，不污染集合', async () => {
    const mod = await withFakeCcDeskDir()
    expect(() => mod.markUnpaired('')).not.toThrow()
    const cfg = { ...mod.getRemoteConfig(), deviceId: 'DESK', pairedDevices: [] }
    expect(mod.shouldRecordPaired(cfg, 'ANY')).toBe(true)
  })
})
