import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ArchivedSessionsSettings } from '../src/renderer/components/settings/ArchivedSessionsSettings'

describe('ArchivedSessionsSettings', () => {
  it('列出所有 archived 会话，过滤非归档', () => {
    const projects = [{
      id: 'p1', name: 'proj', path: '/p',
      sessions: [
        { id: 's1', title: 'A', messages: [], archived: true, archivedAt: 1000 },
        { id: 's2', title: 'B', messages: [] },
      ],
    }] as any
    render(<ArchivedSessionsSettings projects={projects} dispatch={() => {}} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByText('B')).toBeNull()
  })

  it('还原按钮 dispatch RESTORE_SESSION', () => {
    const dispatch = vi.fn()
    const projects = [{ id: 'p1', name: 'proj', sessions: [{ id: 's1', title: 'A', messages: [], archived: true, archivedAt: 1 }] }] as any
    render(<ArchivedSessionsSettings projects={projects} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('还原'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'RESTORE_SESSION', sessionId: 's1' })
  })

  it('删除按钮 dispatch DELETE_SESSION', () => {
    const dispatch = vi.fn()
    const projects = [{ id: 'p1', name: 'proj', sessions: [{ id: 's1', title: 'A', messages: [], archived: true, archivedAt: 1 }] }] as any
    render(<ArchivedSessionsSettings projects={projects} dispatch={dispatch} />)
    fireEvent.click(screen.getByText('删除'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's1' })
  })

  it('无已归档会话显示空提示', () => {
    const projects = [{ id: 'p1', name: 'proj', sessions: [{ id: 's2', title: 'B', messages: [] }] }] as any
    const { container } = render(<ArchivedSessionsSettings projects={projects} dispatch={() => {}} />)
    expect(container.textContent).toContain('暂无')
  })
})
