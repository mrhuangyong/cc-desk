// web/src/pages/ProjectListPage.test.tsx
// 列表页交互测试：会话行归档（删除）入口。
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ProjectListPage from './ProjectListPage'

const makeSession = (id: string, title = '会话') => ({
  localSessionId: id,
  title,
  status: 'idle' as const,
  updatedAt: Date.now(),
  projectId: 'p1',
  projectName: 'proj1',
})

const baseProps = (overrides: any = {}) => ({
  connected: true,
  sessions: [makeSession('s1'), makeSession('s2', '另一个')],
  projectsMeta: [{ projectId: 'p1', projectName: 'proj1' }],
  onAttach: vi.fn(),
  onCreateInProject: vi.fn(),
  onArchive: vi.fn(),
  ...overrides,
})

describe('ProjectListPage - 会话行归档', () => {
  it('每个会话行渲染归档按钮', () => {
    render(<ProjectListPage {...baseProps()} />)
    // 两个会话 → 两个归档按钮（aria-label）
    const archiveBtns = screen.getAllByRole('button', { name: /归档|删除/ })
    expect(archiveBtns.length).toBe(2)
  })

  it('归档需二次确认：首次点击进入确认态，再次点击才触发 onArchive', () => {
    const onArchive = vi.fn()
    render(<ProjectListPage {...baseProps({ onArchive })} />)
    const archiveBtns = screen.getAllByRole('button', { name: /归档|删除/ })
    // 第一次点击：进入确认态，不执行
    fireEvent.click(archiveBtns[0])
    expect(onArchive).not.toHaveBeenCalled()
    // 确认按钮文案变为「确认删除」
    expect(screen.getByText('确认删除')).toBeInTheDocument()
    // 再次点击：执行归档
    fireEvent.click(screen.getByText('确认删除'))
    expect(onArchive).toHaveBeenCalledWith('s1')
  })
})
