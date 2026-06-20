// MemorySettings 组件测试：mock Monaco + monacoEnv（jsdom 下重量级），
// 验证拉取初始内容 + 防抖自动保存接线。
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let mockState: any
const dispatch = vi.fn()

vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))
vi.mock('../src/renderer/editor/monacoEnv', () => ({
  monacoThemeFor: () => 'vs',
  monacoLanguageFor: () => 'plaintext',
}))
// Monaco 在 jsdom 下无法真实渲染，mock 成轻量受控文本域，验证编辑器接线即可。
vi.mock('@monaco-editor/react', () => ({
  default: (props: any) =>
    React.createElement('textarea', {
      'data-testid': 'monaco-mock',
      value: props.value,
      onChange: (e: any) => props.onChange?.(e.target.value),
    }),
}))

import { MemorySettings } from '../src/renderer/components/settings/MemorySettings'

function baseSettings(overrides: Record<string, any> = {}) {
  return {
    apiKey: '', model: 'model-sonnet', cwd: '/tmp/project', providers: [], models: [],
    modelRoleMap: {}, theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', proxy: '',
    inheritTerminal: true, terminalFont: 'mono', taskNotify: true, notifySound: true,
    queueMode: 'queue', showThinking: false, showTodo: false, showBackendTask: true,
    autoArchive: true, archiveDays: '7',
    codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
    skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    ...overrides,
  }
}

function setApi(api: Record<string, any>) {
  ;(window as any).api = api
}

describe('MemorySettings', () => {
  beforeEach(() => {
    dispatch.mockClear()
    mockState = { settings: baseSettings(), activeSettingsSection: 'memory', projects: [] }
  })

  it('拉取并渲染初始 CLAUDE.md 内容', async () => {
    const memoryGet = vi.fn().mockResolvedValue('# 全局记忆\n\n这是指令')
    const memorySave = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { memory: { get: memoryGet, save: memorySave } } })

    render(<MemorySettings />)

    const ta = await screen.findByTestId('monaco-mock')
    expect(memoryGet).toHaveBeenCalled()
    await waitFor(() => expect((ta as HTMLTextAreaElement).value).toBe('# 全局记忆\n\n这是指令'))
  })

  it('布局居中：最外层容器 maxWidth 760 + 编辑器在卡片内', async () => {
    const memoryGet = vi.fn().mockResolvedValue('')
    const memorySave = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { memory: { get: memoryGet, save: memorySave } } })

    const { container } = render(<MemorySettings />)
    await screen.findByTestId('monaco-mock')

    // SettingsLayout 最外层：maxWidth 760、margin 0 auto（居中）
    const outer = container.firstElementChild as HTMLElement
    expect(outer.style.maxWidth).toBe('760px')
    expect(outer.style.margin).toBe('0px auto')
    // 标题文案存在
    expect(screen.getByRole('heading', { name: '记忆' })).toBeTruthy()
  })

  it('内容变更后防抖触发保存', async () => {
    const memoryGet = vi.fn().mockResolvedValue('')
    const memorySave = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { memory: { get: memoryGet, save: memorySave } } })

    // 先用真时钟完成初始加载（findByTestId 内部轮询依赖真实定时器）
    render(<MemorySettings />)
    const ta = await screen.findByTestId('monaco-mock')
    // 初始加载完成后再切 fake timers 推进防抖
    vi.useFakeTimers()

    fireEvent.change(ta, { target: { value: '新指令' } })
    expect(memorySave).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1200)
    expect(memorySave).toHaveBeenCalledWith('新指令')
    vi.useRealTimers()
  })
})
