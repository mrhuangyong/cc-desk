// web/src/pages/SessionListPage.test.tsx
// SessionListPage 组件交互测试（Task 14）。
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import SessionListPage from './SessionListPage'
import type { SessionListItem } from '../lib/session-list'

const mkProps = (overrides: Partial<Parameters<typeof SessionListPage>[0]> = {}) => ({
  connected: true,
  sessions: [] as SessionListItem[],
  onAttach: vi.fn(),
  onCreate: vi.fn(),
  ...overrides,
})

describe('SessionListPage - 渲染', () => {
  it('未连接时显示连接中', () => {
    render(<SessionListPage {...mkProps({ connected: false })} />)
    expect(screen.getAllByText(/连接中|未连接/).length).toBeGreaterThan(0)
  })

  it('连接但无会话时显示空态', () => {
    render(<SessionListPage {...mkProps()} />)
    expect(screen.getByText(/暂无会话|没有/)).toBeInTheDocument()
  })

  it('渲染会话列表（标题 + 状态）', () => {
    const sessions = [
      { localSessionId: 's1', title: '修 bug', status: 'running' },
      { localSessionId: 's2', title: '加功能', status: 'idle' },
    ]
    render(<SessionListPage {...mkProps({ sessions })} />)
    expect(screen.getByText('修 bug')).toBeInTheDocument()
    expect(screen.getByText('加功能')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('空闲')).toBeInTheDocument()
  })

  it('无标题会话显示占位', () => {
    render(<SessionListPage {...mkProps({ sessions: [{ localSessionId: 's1', title: '', status: 'idle' }] })} />)
    expect(screen.getByText(/未命名|无标题/)).toBeInTheDocument()
  })
})

describe('SessionListPage - 交互', () => {
  it('点击会话项触发 onAttach(localSessionId)', () => {
    const onAttach = vi.fn()
    render(<SessionListPage {...mkProps({ sessions: [{ localSessionId: 's1', title: 'a', status: 'idle' }], onAttach })} />)
    fireEvent.click(screen.getByText('a'))
    expect(onAttach).toHaveBeenCalledWith('s1')
  })

  it('点击「新建」触发 onCreate', () => {
    const onCreate = vi.fn()
    render(<SessionListPage {...mkProps({ onCreate })} />)
    fireEvent.click(screen.getByRole('button', { name: /新建/ }))
    expect(onCreate).toHaveBeenCalled()
  })
})
