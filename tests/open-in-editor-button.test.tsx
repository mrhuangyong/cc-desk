import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OpenInEditorButton } from '../src/renderer/components/OpenInEditorButton'

const openInEditor = vi.fn()
const dispatch = vi.fn()

// 默认应用列表（与主进程 defaultOpenApps 一致）
const DEFAULT_APPS = [
  { id: 'vscode', name: 'Visual Studio Code', command: 'code .', builtin: true },
  { id: 'trae', name: 'Trae', command: 'trae .', builtin: true },
  { id: 'zed', name: 'Zed', command: 'zed .', builtin: true },
  { id: 'terminal', name: '终端', command: '$OPEN_TERMINAL', builtin: true },
  { id: 'folder', name: 'Finder', command: '$OPEN_FOLDER', builtin: true },
]

let mockState: any = {
  activeSessionId: 's1',
  projects: [
    { id: 'p1', name: 'cc-desk', path: '/projects/cc-desk', sessions: [{ id: 's1' }] },
  ],
  settings: { lang: 'zh-CN', openApps: DEFAULT_APPS },
}

vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))

describe('OpenInEditorButton', () => {
  beforeEach(() => {
    openInEditor.mockClear()
    dispatch.mockClear()
    ;(window as any).api = { app: { openInEditor } }
    mockState = {
      activeSessionId: 's1',
      projects: [
        { id: 'p1', name: 'cc-desk', path: '/projects/cc-desk', sessions: [{ id: 's1' }] },
      ],
      settings: { lang: 'zh-CN', openApps: DEFAULT_APPS },
    }
  })

  it('默认应用为列表首项（vscode），点主图标直接用其命令打开', () => {
    render(<OpenInEditorButton />)
    // 主图标 tooltip = 「用 Visual Studio Code 打开」
    fireEvent.click(screen.getByLabelText('用 Visual Studio Code 打开'))
    expect(openInEditor).toHaveBeenCalledWith('code .', '/projects/cc-desk')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('点箭头展开菜单，显示应用列表', () => {
    render(<OpenInEditorButton />)
    fireEvent.click(screen.getByLabelText('选择应用'))
    expect(screen.getByText('Visual Studio Code')).toBeTruthy()
    expect(screen.getByText('Finder')).toBeTruthy()
  })

  it('菜单里选 Finder：用其命令打开 + 持久化为项目默认', () => {
    render(<OpenInEditorButton />)
    fireEvent.click(screen.getByLabelText('选择应用'))
    fireEvent.click(screen.getByText('Finder'))
    expect(openInEditor).toHaveBeenCalledWith('$OPEN_FOLDER', '/projects/cc-desk')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PROJECT_DEFAULT_OPEN_APP', projectId: 'p1', appId: 'folder',
    })
  })

  it('项目已记录默认为 folder 时，主图标显示为 Finder 并用其命令打开', () => {
    mockState = {
      activeSessionId: 's1',
      projects: [
        { id: 'p1', name: 'cc-desk', path: '/projects/cc-desk', defaultOpenAppId: 'folder', sessions: [{ id: 's1' }] },
      ],
      settings: { lang: 'zh-CN', openApps: DEFAULT_APPS },
    }
    render(<OpenInEditorButton />)
    fireEvent.click(screen.getByLabelText('用 Finder 打开'))
    expect(openInEditor).toHaveBeenCalledWith('$OPEN_FOLDER', '/projects/cc-desk')
  })

  it('再次选中已是默认的应用，不重复 dispatch', () => {
    mockState = {
      activeSessionId: 's1',
      projects: [
        { id: 'p1', name: 'cc-desk', path: '/projects/cc-desk', defaultOpenAppId: 'folder', sessions: [{ id: 's1' }] },
      ],
      settings: { lang: 'zh-CN', openApps: DEFAULT_APPS },
    }
    render(<OpenInEditorButton />)
    fireEvent.click(screen.getByLabelText('选择应用'))
    fireEvent.click(screen.getByText('Finder'))
    expect(openInEditor).toHaveBeenCalledWith('$OPEN_FOLDER', '/projects/cc-desk')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('自定义应用出现在菜单中并能打开（命令透传）', () => {
    mockState = {
      activeSessionId: 's1',
      projects: [
        { id: 'p1', name: 'cc-desk', path: '/projects/cc-desk', sessions: [{ id: 's1' }] },
      ],
      settings: {
        lang: 'zh-CN',
        openApps: [
          ...DEFAULT_APPS,
          { id: 'c1', name: 'Sublime Text', command: 'open -a "Sublime Text" .' },
        ],
      },
    }
    render(<OpenInEditorButton />)
    fireEvent.click(screen.getByLabelText('选择应用'))
    fireEvent.click(screen.getByText('Sublime Text'))
    expect(openInEditor).toHaveBeenCalledWith('open -a "Sublime Text" .', '/projects/cc-desk')
  })

  it('当前项目无目录时禁用（无展开菜单）', () => {
    mockState = {
      activeSessionId: 's1',
      projects: [{ id: 'p1', name: 'cc-desk', sessions: [{ id: 's1' }] }],
      settings: { lang: 'zh-CN', openApps: DEFAULT_APPS },
    }
    render(<OpenInEditorButton />)
    fireEvent.click(screen.getByLabelText('当前项目无目录'))
    expect(screen.queryByText('Visual Studio Code')).toBeNull()
    expect(openInEditor).not.toHaveBeenCalled()
  })
})
