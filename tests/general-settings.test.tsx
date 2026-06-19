// GeneralSettings 设置页表单交互测试（作为 15 个 settings 子页的测试模板）。
// 核心模式：用户改表单 → persist(patch) → dispatch(SET_SETTINGS) + window.api.settings.save。
// 代理走独立通道 saveCc → 仅 window.api.cc.general.save。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 可控 store
let mockState: any
const dispatch = vi.fn()
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))

import { GeneralSettings } from '../src/renderer/components/settings/GeneralSettings'

function baseSettings(overrides: Record<string, any> = {}) {
  return {
    apiKey: '', model: 'model-sonnet', cwd: '/home/user', providers: [], models: [], modelRoleMap: {},
    theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', proxy: '', inheritTerminal: true,
    terminalFont: 'mono', taskNotify: true, notifySound: true, queueMode: 'queue',
    showThinking: false, showTodo: false, showBackendTask: true, autoArchive: true, archiveDays: '7',
    codePreview: { lightTheme: '', darkTheme: '', showLineNumbers: true, wordWrap: false, fontSize: 12 },
    skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    ...overrides,
  }
}

describe('GeneralSettings', () => {
  const settingsSave = vi.fn()
  const ccGeneralGet = vi.fn()
  const ccGeneralSave = vi.fn()

  beforeEach(() => {
    dispatch.mockClear(); settingsSave.mockClear(); ccGeneralGet.mockClear(); ccGeneralSave.mockClear()
    mockState = { settings: baseSettings() }
    ;(window as any).api = {
      settings: { save: settingsSave },
      cc: { general: { get: ccGeneralGet, save: ccGeneralSave } },
    }
    ccGeneralGet.mockResolvedValue({ proxy: 'http://existing:8080' })
  })

  it('工作目录输入框绑定 state.settings.cwd', () => {
    mockState = { settings: baseSettings({ cwd: '/foo/bar' }) }
    render(<GeneralSettings />)
    const cwdInput = screen.getByPlaceholderText('/path/to/project') as HTMLInputElement
    expect(cwdInput.value).toBe('/foo/bar')
  })

  it('改工作目录 → dispatch(SET_SETTINGS) + settings.save', () => {
    render(<GeneralSettings />)
    const cwdInput = screen.getByPlaceholderText('/path/to/project')
    fireEvent.change(cwdInput, { target: { value: '/new/path' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SETTINGS', settings: { cwd: '/new/path' } })
    expect(settingsSave).toHaveBeenCalledWith({ cwd: '/new/path' })
  })

  it('界面缩放 Segmented：点「偏大」→ persist({zoom:large})', () => {
    render(<GeneralSettings />)
    fireEvent.click(screen.getByText('偏大'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SETTINGS', settings: { zoom: 'large' } })
    expect(settingsSave).toHaveBeenCalledWith({ zoom: 'large' })
  })

  it('界面语言切英文 → persist({lang:en})', () => {
    render(<GeneralSettings />)
    const langSelect = screen.getByDisplayValue('简体中文') as HTMLSelectElement
    fireEvent.change(langSelect, { target: { value: 'en' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SETTINGS', settings: { lang: 'en' } })
  })

  it('界面主题切换 → 先 SET_THEME 再 SET_SETTINGS(theme)', () => {
    render(<GeneralSettings />)
    const themeSelect = screen.getByDisplayValue('Codex 浅色') as HTMLSelectElement
    fireEvent.change(themeSelect, { target: { value: 'codex-dark' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_THEME', theme: 'codex-dark' })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SETTINGS', settings: { theme: 'codex-dark' } })
  })

  it('Toggle：任务通知 → persist({taskNotify:false})', () => {
    render(<GeneralSettings />)
    // SettingsRow 根 = title 元素的 parentElement.parentElement（跳过 title 内层 div）
    const notifyTitle = screen.getByText('任务通知')
    const rowRoot = notifyTitle.parentElement!.parentElement!
    const sw = rowRoot.querySelector('button[role="switch"]')!
    fireEvent.click(sw)
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SETTINGS', settings: { taskNotify: false } })
  })

  it('HTTP 代理：改值 → saveCc（仅 cc.general.save，不走 dispatch）', () => {
    render(<GeneralSettings />)
    const proxyInput = screen.getByPlaceholderText('http://127.0.0.1:7890')
    fireEvent.change(proxyInput, { target: { value: 'http://new-proxy:7890' } })
    expect(ccGeneralSave).toHaveBeenCalledWith({ proxy: 'http://new-proxy:7890' })
    // 关键：代理改动不应触发桌面 persist（独立通道）
    const setSettingsCalls = dispatch.mock.calls.filter(c => c[0].type === 'SET_SETTINGS')
    expect(setSettingsCalls.find(c => (c[0] as any).settings?.proxy !== undefined)).toBeUndefined()
  })

  it('挂载时拉取 Claude 代理配置填充输入框', async () => {
    render(<GeneralSettings />)
    // ccGeneralGet 返回 {proxy:'http://existing:8080'}，输入框应显示
    const proxyInput = await screen.findByDisplayValue('http://existing:8080')
    expect(proxyInput).toBeTruthy()
  })

  it('队列模式 select → persist({queueMode})', () => {
    render(<GeneralSettings />)
    const queueSelect = screen.getByDisplayValue('队列') as HTMLSelectElement
    fireEvent.change(queueSelect, { target: { value: 'interrupt' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SETTINGS', settings: { queueMode: 'interrupt' } })
  })
})
