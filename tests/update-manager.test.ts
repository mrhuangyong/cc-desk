// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock electron-updater：捕获 autoUpdater 实例与事件监听
const autoUpdaterMock = {
  autoDownload: false,
  autoInstallOnQuit: false,
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn(),
}
vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }))

// mock electron：仅暴露用到的方法；app.isPackaged/getVersion 在 case 里改写
const appMock = {
  isPackaged: true,
  getVersion: vi.fn(() => '1.0.0'),
  getPath: vi.fn(() => '/tmp/downloads'),
}
vi.mock('electron', () => ({
  app: appMock,
  shell: { openPath: vi.fn(async () => '') },
}))

// 全局 fetch mock（mac 分支用）
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// 动态导入，确保 mock 生效
async function importFresh(platform: 'darwin' | 'win32' | 'linux', isPackaged = true) {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  appMock.isPackaged = isPackaged
  appMock.getVersion.mockReturnValue('1.0.0')
  autoUpdaterMock.on.mockClear()
  autoUpdaterMock.checkForUpdates.mockClear()
  autoUpdaterMock.autoDownload = false
  autoUpdaterMock.autoInstallOnQuit = false
  const mod = await import('../src/main/update-manager')
  return mod
}

describe('UpdateManager 平台分流', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('win/linux: 绑定 autoUpdater 事件且 autoDownload=true', async () => {
    const { UpdateManager } = await importFresh('win32')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const events = autoUpdaterMock.on.mock.calls.map((c: any[]) => c[0])
    expect(events).toContain('update-available')
    expect(events).toContain('download-progress')
    expect(events).toContain('update-downloaded')
    expect(autoUpdaterMock.autoDownload).toBe(true)
    expect(autoUpdaterMock.autoInstallOnQuit).toBe(false)
  })

  it('win/linux: checkNow 调 autoUpdater.checkForUpdates，emit checking', async () => {
    const { UpdateManager } = await importFresh('linux')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalled()
    expect(emitted).toContainEqual({ state: 'checking' })
  })

  it('win/linux: update-downloaded 事件 → emit ready', async () => {
    const { UpdateManager } = await importFresh('win32')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    const call = autoUpdaterMock.on.mock.calls.find((c: any[]) => c[0] === 'update-downloaded')!
    call[1]({ version: '1.2.0' })
    expect(emitted).toContainEqual({ state: 'ready', version: '1.2.0' })
  })

  it('mac: fetch latest-mac.yml 发现新版 → emit available', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => 'version: 1.2.0\nfiles:\n  - url: cc-desk-1.2.0.dmg\n',
    })
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(fetchMock).toHaveBeenCalled()
    expect(emitted).toContainEqual({ state: 'available', version: '1.2.0' })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('mac: 版本相同 → emit idle', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => 'version: 1.0.0\n',
    })
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(emitted).toContainEqual({ state: 'idle' })
  })

  it('mac: fetch 失败 → emit error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    const errState = emitted.find((s) => s.state === 'error')
    expect(errState).toBeTruthy()
    expect(errState.message).toContain('network down')
  })

  it('dev: isPackaged=false 时 checkNow 直接 emit idle，不触网', async () => {
    const { UpdateManager } = await importFresh('win32', false)
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(emitted).toContainEqual({ state: 'idle' })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('sendCurrentState: 重发当前 status', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'version: 1.0.0\n' })
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    emitted.length = 0
    m.sendCurrentState()
    expect(emitted).toContainEqual({ state: 'idle' })
  })
})
