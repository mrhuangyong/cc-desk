import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OpenAppsSettings } from '../src/renderer/components/settings/OpenAppsSettings'

const dispatch = vi.fn()
const save = vi.fn()
const openAppFile = vi.fn()

let mockApps: any[] = [
  { id: 'vscode', name: 'Visual Studio Code', command: 'code .', builtin: true },
  { id: 'trae', name: 'Trae', command: 'trae .', builtin: true },
  { id: 'zed', name: 'Zed', command: 'zed .', builtin: true },
  { id: 'terminal', name: '终端', command: '$OPEN_TERMINAL', builtin: true },
  { id: 'folder', name: 'Finder', command: '$OPEN_FOLDER', builtin: true },
]

vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({
    state: { settings: { lang: 'zh-CN', openApps: mockApps } },
    dispatch,
  }),
}))

describe('OpenAppsSettings', () => {
  beforeEach(() => {
    dispatch.mockClear()
    save.mockClear()
    openAppFile.mockReset()
    ;(window as any).api = { settings: { save }, dialog: { openAppFile } }
    mockApps = [
      { id: 'vscode', name: 'Visual Studio Code', command: 'code .', builtin: true },
      { id: 'trae', name: 'Trae', command: 'trae .', builtin: true },
      { id: 'zed', name: 'Zed', command: 'zed .', builtin: true },
      { id: 'terminal', name: '终端', command: '$OPEN_TERMINAL', builtin: true },
      { id: 'folder', name: 'Finder', command: '$OPEN_FOLDER', builtin: true },
    ]
  })

  it('渲染内置应用列表', () => {
    render(<OpenAppsSettings />)
    expect(screen.getByText('Visual Studio Code')).toBeTruthy()
    expect(screen.getByText('Finder')).toBeTruthy()
    expect(screen.getByText('终端')).toBeTruthy()
    // 内置项不渲染删除按钮
    expect(screen.queryAllByLabelText('删除')).toHaveLength(0)
  })

  it('添加应用：文件选择器返回 mac .app → 推导 open -a 命令并持久化', async () => {
    openAppFile.mockResolvedValue('/Applications/Sublime Text.app')
    render(<OpenAppsSettings />)
    fireEvent.click(screen.getByText('添加应用'))
    await waitFor(() => expect(dispatch).toHaveBeenCalled())
    expect(openAppFile).toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_SETTINGS',
      settings: {
        openApps: [
          ...mockApps,
          expect.objectContaining({ name: 'Sublime Text', command: 'open -a "Sublime Text" .' }),
        ],
      },
    })
    expect(save).toHaveBeenCalled()
  })

  it('文件选择器取消（返回 null）→ 不持久化', async () => {
    openAppFile.mockResolvedValue(null)
    render(<OpenAppsSettings />)
    fireEvent.click(screen.getByText('添加应用'))
    await waitFor(() => expect(openAppFile).toHaveBeenCalled())
    expect(dispatch).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('删除自定义应用：从列表移除并持久化', () => {
    mockApps = [
      ...mockApps,
      { id: 'c1', name: 'Sublime Text', command: 'subl .' },
    ]
    render(<OpenAppsSettings />)
    const dels = screen.getAllByLabelText('删除')
    expect(dels).toHaveLength(1)
    fireEvent.click(dels[0])
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_SETTINGS',
      settings: {
        openApps: [
          { id: 'vscode', name: 'Visual Studio Code', command: 'code .', builtin: true },
          { id: 'trae', name: 'Trae', command: 'trae .', builtin: true },
          { id: 'zed', name: 'Zed', command: 'zed .', builtin: true },
          { id: 'terminal', name: '终端', command: '$OPEN_TERMINAL', builtin: true },
          { id: 'folder', name: 'Finder', command: '$OPEN_FOLDER', builtin: true },
        ],
      },
    })
    expect(save).toHaveBeenCalled()
  })
})
