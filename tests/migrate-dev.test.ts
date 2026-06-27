// tests/migrate-dev.test.ts
// dev 版首次启动迁移测试：从 ~/.cc-desk 拷到 dev 目录，剥掉 relay 身份。
// 全程隔离到临时目录（改 HOME），用 CC_DESK_DEV 环境变量控制 dev 判定（避免依赖 electron 运行时）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

const TMP = path.join(os.tmpdir(), `cc-desk-migdev-${Date.now()}-${process.pid}`)
const ORIG_HOME = process.env.HOME
const ORIG_DEV = process.env.CC_DESK_DEV

beforeEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  process.env.HOME = TMP
  process.env.CC_DESK_DEV = '1' // 默认 dev 构建
  vi.resetModules()
})

afterEach(() => {
  process.env.HOME = ORIG_HOME
  if (ORIG_DEV === undefined) delete process.env.CC_DESK_DEV
  else process.env.CC_DESK_DEV = ORIG_DEV
  vi.resetModules()
})

// 写一份假正式版配置到 ~/.cc-desk
function seedProd(prodDir: string, opts: { withRemote?: boolean } = {}) {
  fs.mkdirSync(prodDir, { recursive: true })
  const cfg: any = {
    config: { providers: [{ id: 'p1' }], models: [], activeModelId: 'm1' },
  }
  if (opts.withRemote !== false) {
    cfg.remote = { deviceId: 'prod-67658a', deviceKey: 'prod-key', pairedDevices: ['m-1'], enabled: true }
  }
  fs.writeFileSync(path.join(prodDir, 'config.json'), JSON.stringify(cfg))
  fs.writeFileSync(path.join(prodDir, 'projects.json'), JSON.stringify({ projects: [{ id: 'proj1' }] }))
  fs.writeFileSync(path.join(prodDir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
}

describe('migrate-dev 首次启动迁移', () => {
  it('正式构建（CC_DESK_DEV=0）不迁移', async () => {
    process.env.CC_DESK_DEV = '0'
    const prodDir = path.join(TMP, '.cc-desk')
    seedProd(prodDir)
    const { migrateDevFromProd } = await import('../src/main/migrate-dev')
    const devDir = path.join(TMP, '.cc-desk-dev')
    expect(migrateDevFromProd(devDir)).toBe(false)
    expect(fs.existsSync(devDir)).toBe(false)
  })

  it('dev 构建：从正式版拷 projects/settings/config，但剥掉 remote 段', async () => {
    const prodDir = path.join(TMP, '.cc-desk')
    seedProd(prodDir)
    const { migrateDevFromProd } = await import('../src/main/migrate-dev')
    const devDir = path.join(TMP, '.cc-desk-dev')
    const migrated = migrateDevFromProd(devDir)

    expect(migrated).toBe(true)
    // projects / settings 原样拷贝
    const proj = JSON.parse(fs.readFileSync(path.join(devDir, 'projects.json'), 'utf-8'))
    expect(proj.projects[0].id).toBe('proj1')
    const settings = JSON.parse(fs.readFileSync(path.join(devDir, 'settings.json'), 'utf-8'))
    expect(settings.theme).toBe('dark')
    // config 的 config 段保留（模型配置）
    const cfg = JSON.parse(fs.readFileSync(path.join(devDir, 'config.json'), 'utf-8'))
    expect(cfg.config.providers[0].id).toBe('p1')
    // remote 段被剥掉（dev 要独立 deviceId）
    expect(cfg.remote).toBeUndefined()
  })

  it('幂等：dev 目录已存在则跳过', async () => {
    const prodDir = path.join(TMP, '.cc-desk')
    seedProd(prodDir)
    const devDir = path.join(TMP, '.cc-desk-dev')
    fs.mkdirSync(devDir, { recursive: true })
    fs.writeFileSync(path.join(devDir, 'config.json'), JSON.stringify({ existing: true }))
    const { migrateDevFromProd } = await import('../src/main/migrate-dev')
    expect(migrateDevFromProd(devDir)).toBe(false)
    // 不覆盖已有
    const cfg = JSON.parse(fs.readFileSync(path.join(devDir, 'config.json'), 'utf-8'))
    expect(cfg.existing).toBe(true)
  })

  it('正式版目录不存在（全新机器）则不迁移，dev 版从空白起步', async () => {
    const { migrateDevFromProd } = await import('../src/main/migrate-dev')
    const devDir = path.join(TMP, '.cc-desk-dev')
    expect(migrateDevFromProd(devDir)).toBe(false)
    expect(fs.existsSync(devDir)).toBe(false)
  })
})
