import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { ProjectTree } from '../src/renderer/components/ProjectTree'
import type { AppState } from '../src/renderer/state/reducer'
import { mockProjects } from '../src/renderer/state/mockData'

function renderWithProvider(ui: React.ReactNode) {
  return render(<AppProvider>{ui}</AppProvider>)
}

// 默认 props：全部展开、无过滤
const defaultProps = {
  onOpenFiles: () => {},
  expandedProjects: new Set(mockProjects.map(p => p.id)),
  onToggleExpand: () => {},
  treeFilter: ''
}

describe('ProjectTree', () => {
  it('项目行点删除→确认→项目被删（级联删会话）', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    // 删除前第一个项目 cc-desk 应可见（行渲染为 "📁 cc-desk"）
    expect(screen.queryByText(/cc-desk/)).not.toBeNull()

    // 项目行先于其会话行渲染，deleteBtns[0] 是第一个项目（p1=cc-desk）的项目级删除
    const deleteBtns = screen.getAllByRole('button', { name: '删除' })
    fireEvent.click(deleteBtns[0])
    fireEvent.click(screen.getAllByRole('button', { name: '确认删除' })[0])

    // cc-desk 项目应消失（含其下所有会话级联删除）
    expect(screen.queryByText(/cc-desk/)).toBeNull()
    // 第二个项目仍存在，验证删除的是 p1 而非误删全部
    expect(screen.queryByText(/个人博客/)).not.toBeNull()
  })

  it('项目行不再有"新增会话"按钮（已迁移到左栏顶部）', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    expect(screen.queryAllByRole('button', { name: '新增会话' })).toHaveLength(0)
  })

  it('treeFilter 过滤：只显示标题匹配的会话，无匹配的项目隐藏', () => {
    const props = { ...defaultProps, treeFilter: '部署' }
    renderWithProvider(<ProjectTree {...props} />)
    // "部署到 Vercel" 在 p2，应可见
    expect(screen.queryByText(/部署到 Vercel/)).not.toBeNull()
    // p1 的会话不匹配"部署"，整个 p1 隐藏（cc-desk 项目名不显示）
    expect(screen.queryByText(/重构登录流程/)).toBeNull()
  })

  it('展开时显示会话，收起时不显示', () => {
    // 全部收起
    const props = { ...defaultProps, expandedProjects: new Set<string>() }
    renderWithProvider(<ProjectTree {...props} />)
    // 项目名仍可见
    expect(screen.queryByText(/cc-desk/)).not.toBeNull()
    // 会话被收起
    expect(screen.queryByText(/重构登录流程/)).toBeNull()
  })
})
