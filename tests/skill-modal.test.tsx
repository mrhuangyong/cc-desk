// 技能详情弹窗测试：mock Monaco + monacoEnv，验证点击打开、加载内容、保存按钮触发 flush。
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
vi.mock('@monaco-editor/react', () => ({
  default: (props: any) =>
    React.createElement('textarea', {
      'data-testid': 'monaco-mock',
      value: props.value,
      onChange: (e: any) => props.onChange?.(e.target.value),
    }),
}))

import { SkillsSettings } from '../src/renderer/components/settings/SkillsSettings'
import { SkillModal } from '../src/renderer/components/settings/SkillModal'
import type { ClaudeSkill } from '../src/main/claude-config'

function mkSkill(over: Partial<ClaudeSkill> = {}): ClaudeSkill {
  return {
    id: 'user:editor', name: 'editor', desc: '编辑器技能', enabled: true,
    scope: '个人', source: 'user', path: '/tmp/skills/editor/SKILL.md', ...over,
  }
}

function setApi(api: Record<string, any>) {
  ;(window as any).api = api
}

describe('SkillsSettings 行点击打开弹窗', () => {
  beforeEach(() => {
    dispatch.mockClear()
    mockState = { settings: { theme: 'codex-light' } }
  })

  it('点击技能行打开详情弹窗', async () => {
    const skill = mkSkill()
    setApi({ cc: { skills: { get: vi.fn().mockResolvedValue([skill]), getFile: vi.fn().mockResolvedValue(''), saveFile: vi.fn(), setEnabled: vi.fn().mockResolvedValue(undefined) } } })

    render(<SkillsSettings />)
    await waitFor(() => expect(screen.getByText('editor')).toBeTruthy())

    // 初始无弹窗
    expect(screen.queryByRole('switch', { name: '禁用 editor' })).toBeTruthy()
    // 点击技能行（name 文本所在元素）
    fireEvent.click(screen.getByText('editor'))

    // 弹窗出现：标题含技能名 + 路径
    await waitFor(() => expect(screen.getByText('/tmp/skills/editor/SKILL.md')).toBeTruthy())
  })

  it('点击 Toggle 不打开弹窗（stopPropagation）', async () => {
    const skill = mkSkill()
    setApi({ cc: { skills: { get: vi.fn().mockResolvedValue([skill]), getFile: vi.fn().mockResolvedValue(''), saveFile: vi.fn(), setEnabled: vi.fn().mockResolvedValue(undefined) } } })

    render(<SkillsSettings />)
    await waitFor(() => expect(screen.getByText('editor')).toBeTruthy())

    const toggle = screen.getByRole('switch', { name: '禁用 editor' })
    fireEvent.click(toggle)
    // 不应出现路径（弹窗未开）
    expect(screen.queryByText('/tmp/skills/editor/SKILL.md')).toBeNull()
  })

  it('点击 Toggle 调 setSkillEnabled 后重新加载', async () => {
    const skill = mkSkill({ enabled: true })
    const setEnabled = vi.fn().mockResolvedValue(undefined)
    let callCount = 0
    const get = vi.fn().mockImplementation(async () => {
      callCount++
      return [{ ...skill, enabled: callCount === 1 }]
    })
    setApi({ cc: { skills: { get, getFile: vi.fn().mockResolvedValue(''), saveFile: vi.fn(), setEnabled } } })

    render(<SkillsSettings />)
    await waitFor(() => expect(screen.getByText('editor')).toBeTruthy())

    const toggle = screen.getByRole('switch', { name: '禁用 editor' })
    fireEvent.click(toggle)
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith('editor', false))
  })
})

describe('SkillModal 编辑保存', () => {
  beforeEach(() => {
    dispatch.mockClear()
    mockState = { settings: { theme: 'codex-light' } }
  })

  it('加载并渲染 SKILL.md 内容', async () => {
    const skill = mkSkill()
    const getFile = vi.fn().mockResolvedValue('# 技能\n\n指令内容')
    const saveFile = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { skills: { getFile, saveFile } } })

    render(<SkillModal skill={skill} onClose={vi.fn()} />)
    const ta = await screen.findByTestId('monaco-mock')
    await waitFor(() => expect((ta as HTMLTextAreaElement).value).toBe('# 技能\n\n指令内容'))
  })

  it('保存按钮立即触发 flush', async () => {
    const skill = mkSkill()
    const getFile = vi.fn().mockResolvedValue('旧内容')
    const saveFile = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { skills: { getFile, saveFile } } })

    render(<SkillModal skill={skill} onClose={vi.fn()} />)
    await screen.findByTestId('monaco-mock')

    fireEvent.change(screen.getByTestId('monaco-mock'), { target: { value: '新指令' } })
    expect(saveFile).not.toHaveBeenCalled()

    // 手动保存按钮
    const saveBtn = screen.getByText('保存')
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(saveBtn)
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith('user:editor', '新指令'))
  })

  it('防抖自动保存：变更后 1.2s 触发', async () => {
    const skill = mkSkill()
    const getFile = vi.fn().mockResolvedValue('')
    const saveFile = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { skills: { getFile, saveFile } } })

    render(<SkillModal skill={skill} onClose={vi.fn()} />)
    const ta = await screen.findByTestId('monaco-mock')

    vi.useFakeTimers()
    fireEvent.change(ta, { target: { value: '自动保存内容' } })
    expect(saveFile).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1200)
    expect(saveFile).toHaveBeenCalledWith('user:editor', '自动保存内容')
    vi.useRealTimers()
  })
})
