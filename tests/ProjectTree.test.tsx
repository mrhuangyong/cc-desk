import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { ProjectTree } from '../src/renderer/components/ProjectTree'

function renderWithProvider(ui: React.ReactNode) {
  return render(<AppProvider>{ui}</AppProvider>)
}

describe('ProjectTree', () => {
  it('项目行点删除→确认→项目被删（级联删会话）', () => {
    renderWithProvider(<ProjectTree onOpenFiles={() => {}} />)
    // 删除前第一个项目 cc-desk 应可见（用正则，因行渲染为 "📁 cc-desk"）
    expect(screen.queryByText(/cc-desk/)).not.toBeNull()

    // 找到所有"删除"按钮。项目行先于其会话行渲染，故 deleteBtns[0]
    // 是第一个项目（p1=cc-desk）的项目级删除按钮。
    const deleteBtns = screen.getAllByRole('button', { name: '删除' })
    fireEvent.click(deleteBtns[0])
    // 该按钮变为确认态
    fireEvent.click(screen.getAllByRole('button', { name: '确认删除' })[0])

    // cc-desk 项目应消失（含其下所有会话级联删除）
    expect(screen.queryByText(/cc-desk/)).toBeNull()
    // 第二个项目仍存在，验证删除的是 p1 而非误删全部
    expect(screen.queryByText(/个人博客/)).not.toBeNull()
  })

  it('点新增会话，项目已有空会话时数量不变（去重切换）', () => {
    renderWithProvider(<ProjectTree onOpenFiles={() => {}} />)
    // 会话标题：重构登录流程(登录) / 修样式 bug(样式) / 部署到 Vercel(部署)
    const before = screen.getAllByText(/会话|登录|样式|部署/).length
    // p1 (cc-desk) 已有空会话 s2；点其新增按钮
    const addBtns = screen.getAllByRole('button', { name: '新增会话' })
    fireEvent.click(addBtns[0])
    const after = screen.getAllByText(/会话|登录|样式|部署/).length
    expect(after).toBe(before)
  })
})
