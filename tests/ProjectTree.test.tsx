import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AppProvider } from '../src/renderer/state/store'
import { ProjectTree } from '../src/renderer/components/ProjectTree'
import { seedProjects } from './fixtures'

// 通过 initialProjects 同步播种（生产环境会话由 Claude 通过 INIT_SESSIONS 注入）
function renderWithProvider(ui: ReactNode) {
  return render(<AppProvider initialProjects={structuredClone(seedProjects)}>{ui}</AppProvider>)
}

// 默认 props：全部展开、无过滤
const defaultProps = {
  onOpenFiles: () => {},
  expandedProjects: new Set(seedProjects.map((p) => p.id)),
  onToggleExpand: () => {},
  treeFilter: '',
  sortMode: 'recent' as const,
  showArchived: false,
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

  it('会话纯按 updatedAt 倒序，点击激活不改变顺序', () => {
    const { container } = renderWithProvider(<ProjectTree {...defaultProps} />)
    const sessionTexts = ['重构登录流程', '修样式 bug', '优化首屏', '接入埋点', '国际化', '单元测试补全', 'CI 配置']
    const titleSpans = () => Array.from(container.querySelectorAll('span')).filter(span => {
      if (span.querySelector('span')) return false
      const txt = (span.textContent ?? '').trim()
      return sessionTexts.includes(txt)
    })
    const orderOf = () => titleSpans().map(span => sessionTexts.indexOf((span.textContent ?? '').trim()))

    // 激活前：纯 updatedAt 倒序，默认 5 条可见 = CI 配置(6) > 单元测试补全(5) > 国际化(4) > 接入埋点(3) > 优化首屏(2)
    expect(orderOf()).toEqual([6, 5, 4, 3, 2])

    // 点击"优化首屏"(idx 2) 激活它——激活不应改变排序顺序
    fireEvent.click(screen.getByText('优化首屏'))
    expect(orderOf()).toEqual([6, 5, 4, 3, 2])
  })

  it('选中会话行标记为 active（高亮背景）', () => {
    const { container } = renderWithProvider(<ProjectTree {...defaultProps} />)
    // 点击激活"优化首屏"
    fireEvent.click(screen.getByText('优化首屏'))
    // 激活行带 data-active 属性
    expect(container.querySelector('[data-active]')).not.toBeNull()
  })

  it('默认只显示最近 5 条，出现"展开更多"按钮', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    expect(screen.queryByText('修样式 bug')).toBeNull()
    expect(screen.queryByText(/展开更多.*2/)).not.toBeNull()
  })

  it('点击展开更多后显示全部会话，按钮变为收起', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    fireEvent.click(screen.getByText(/展开更多/))
    expect(screen.queryByText('修样式 bug')).not.toBeNull()
    expect(screen.queryByText('收起')).not.toBeNull()
    expect(screen.queryByText(/展开更多/)).toBeNull()
  })

  it('点击收起后回到默认 5 条', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    fireEvent.click(screen.getByText(/展开更多/))
    fireEvent.click(screen.getByText('收起'))
    expect(screen.queryByText('修样式 bug')).toBeNull()
    expect(screen.queryByText(/展开更多.*2/)).not.toBeNull()
  })

  it('会话数 ≤ 5 的项目不显示展开更多按钮', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    expect(screen.queryAllByText(/展开更多/)).toHaveLength(1)
  })

  it('会话行渲染时间标签元素', () => {
    const { container } = renderWithProvider(<ProjectTree {...defaultProps} />)
    expect(container.querySelector('[data-testid="session-time"]')).not.toBeNull()
  })

  it('sortMode=title 按标题字母序排列', () => {
    const props = { ...defaultProps, sortMode: 'title' as const }
    const { container } = renderWithProvider(<ProjectTree {...props} />)
    const sessionTexts = ['重构登录流程', '修样式 bug', '优化首屏', '接入埋点', '国际化', '单元测试补全', 'CI 配置']
    const titleSpans = () => Array.from(container.querySelectorAll('span')).filter(span => {
      if (span.querySelector('span')) return false
      const txt = (span.textContent ?? '').trim()
      return sessionTexts.includes(txt)
    })
    const visible = titleSpans().map(span => (span.textContent ?? '').trim())
    // title 模式下按 localeCompare 排序，首 5 条应为字母序前 5
    const sorted = [...sessionTexts].sort((a, b) => a.localeCompare(b)).slice(0, 5)
    expect(visible).toEqual(sorted)
  })

  it('sortMode=created 按创建顺序（id 升序）排列', () => {
    const props = { ...defaultProps, sortMode: 'created' as const }
    const { container } = renderWithProvider(<ProjectTree {...props} />)
    const sessionTexts = ['重构登录流程', '修样式 bug', '优化首屏', '接入埋点', '国际化', '单元测试补全', 'CI 配置']
    const titleSpans = () => Array.from(container.querySelectorAll('span')).filter(span => {
      if (span.querySelector('span')) return false
      const txt = (span.textContent ?? '').trim()
      return sessionTexts.includes(txt)
    })
    const visible = titleSpans().map(span => (span.textContent ?? '').trim())
    // created 模式按 id 升序：s1(重构登录流程) > s2(修样式 bug) > s4(优化首屏) > s5(接入埋点) > s6(国际化)
    expect(visible).toEqual(['重构登录流程', '修样式 bug', '优化首屏', '接入埋点', '国际化'])
  })
})
