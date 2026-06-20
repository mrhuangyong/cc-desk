import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AboutSettings } from '../src/renderer/components/settings/AboutSettings'

// mock useStore：让 updateStatus 可控
const mockDispatch = vi.fn()
let mockUpdateStatus: any = { state: 'idle' }
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({
    state: { updateStatus: mockUpdateStatus },
    dispatch: mockDispatch,
  }),
}))

// mock useI18n：直接回 key，便于断言
vi.mock('../src/renderer/i18n/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'zh-CN' }),
}))

// mock window.api
const updateApi = {
  check: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  downloadAndOpen: vi.fn(async () => {}),
}
const appVersionApi = { get: vi.fn(async () => ({ version: '1.0.0', electron: '42', chrome: '1', node: '25' })) }
vi.stubGlobal('window', Object.assign(Object.create(globalThis.window ?? {}), {
  api: { update: updateApi, appVersion: appVersionApi },
}))

describe('AboutSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateStatus = { state: 'idle' }
  })

  it('显示应用名与版本号', async () => {
    render(<AboutSettings />)
    expect(await screen.findByText(/1\.0\.0/)).toBeInTheDocument()
    expect(screen.getByText('about.title')).toBeInTheDocument()
  })

  it('idle 态显示检查更新按钮，点击触发 check', async () => {
    render(<AboutSettings />)
    const btn = await screen.findByText('about.checkUpdate')
    fireEvent.click(btn)
    expect(updateApi.check).toHaveBeenCalled()
  })

  it('ready 态显示绿色重启按钮，点击触发 install', async () => {
    mockUpdateStatus = { state: 'ready', version: '1.2.0' }
    render(<AboutSettings />)
    const btn = await screen.findByText('about.installRestart')
    fireEvent.click(btn)
    expect(updateApi.install).toHaveBeenCalled()
  })

  it('error 态显示错误信息与重试按钮', async () => {
    mockUpdateStatus = { state: 'error', message: '网络失败' }
    render(<AboutSettings />)
    expect(await screen.findByText(/网络失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('about.retry'))
    expect(updateApi.check).toHaveBeenCalled()
  })

  it('mac available 态显示下载并打开按钮', async () => {
    mockUpdateStatus = { state: 'available', version: '1.2.0' }
    const orig = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', { value: 'Macintosh', configurable: true })
    render(<AboutSettings />)
    const btn = await screen.findByText('about.downloadOpen')
    fireEvent.click(btn)
    expect(updateApi.downloadAndOpen).toHaveBeenCalled()
    Object.defineProperty(navigator, 'userAgent', { value: orig, configurable: true })
  })
})
