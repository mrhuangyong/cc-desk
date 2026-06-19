import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { TaskCard } from '../src/renderer/components/TaskPanel'
import { TaskDetailDrawer } from '../src/renderer/components/TaskDetailDrawer'
import type { TaskItem } from '../src/renderer/types'

describe('TaskCard 点击查看详情', () => {
  const task: TaskItem = {
    id: 't1', description: '实现登录页', taskType: 'task', status: 'running',
    subject: '实现登录页', details: '需要邮箱+密码表单，带表单校验', activeForm: '正在实现登录页',
  }

  it('点击行触发 onClickTask 回调', () => {
    const onClick = vi.fn()
    const { getByText } = render(
      <TaskCard tasks={[task]} folded={false} onToggleFold={() => {}} onClickTask={onClick} />
    )
    fireEvent.click(getByText('实现登录页'))
    expect(onClick).toHaveBeenCalledWith(task)
  })

  it('未传 onClickTask 时行不可点击（不报错）', () => {
    const { container } = render(
      <TaskCard tasks={[task]} folded={false} onToggleFold={() => {}} />
    )
    const row = container.querySelector('[class*="cc-task-row"]')
    expect(row).toBeTruthy()
  })
})

describe('TaskDetailDrawer 字段渲染', () => {
  it('展示 subject / details / activeForm 完整内容', () => {
    const task: TaskItem = {
      id: 't1', description: 'desc', taskType: 'task', status: 'completed',
      subject: '实现登录页', details: '需要邮箱+密码表单，带表单校验', activeForm: '正在实现登录页',
    }
    const { getByText } = render(<TaskDetailDrawer task={task} onClose={() => {}} />)
    expect(getByText('实现登录页')).toBeTruthy()
    expect(getByText('需要邮箱+密码表单，带表单校验')).toBeTruthy()
    expect(getByText('正在实现登录页')).toBeTruthy()
  })

  it('task 为 null 时不渲染', () => {
    const { container } = render(<TaskDetailDrawer task={null} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('仅有 description 的任务正常渲染', () => {
    const task: TaskItem = {
      id: 't1', description: '简单任务', taskType: 'todo', status: 'pending',
    }
    const { getAllByText } = render(<TaskDetailDrawer task={task} onClose={() => {}} />)
    expect(getAllByText('简单任务').length).toBeGreaterThan(0)
  })
})
