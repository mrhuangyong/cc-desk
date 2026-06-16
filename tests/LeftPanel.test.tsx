import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { LeftPanel } from '../src/renderer/components/LeftPanel'

function renderWithProvider(ui: React.ReactNode) {
  return render(<AppProvider>{ui}</AppProvider>)
}

describe('LeftPanel 顶部新建会话', () => {
  it('点击顶部"新建会话"在当前激活项目下新增（无空会话时）', () => {
    // 初始激活会话 s1 属于 p1(cc-desk)；但 p1 已有空会话 s2，故点击应切换到 s2 而非新增。
    // 为测"新增"分支，先选中 p2 的会话 s3（p2 无空会话）。
    renderWithProvider(<LeftPanel collapsed={false} onExpand={() => {}} />)
    // 先点 p2 的会话 s3（部署到 Vercel）激活它
    fireEvent.click(screen.getByText(/部署到 Vercel/))
    // 点顶部"新建会话"
    fireEvent.click(screen.getByTitle('新建会话'))
    // p2 应多出一条会话（标题"新会话"），渲染为 "💬 新会话"，用正则匹配
    expect(screen.getByText(/新会话/)).toBeTruthy()
  })

  it('当前项目已有空会话时，点顶部"新建会话"切换过去（不新增）', () => {
    // 初始激活 s1 属于 p1，p1 已有空会话 s2（修样式 bug）
    renderWithProvider(<LeftPanel collapsed={false} onExpand={() => {}} />)
    const before = screen.getAllByText(/重构登录流程|修样式 bug|部署到 Vercel|新会话/).length
    fireEvent.click(screen.getByTitle('新建会话'))
    const after = screen.getAllByText(/重构登录流程|修样式 bug|部署到 Vercel|新会话/).length
    expect(after).toBe(before) // 数量不变，去重切换
  })

  it('展开/折叠按钮切换所有项目会话的显隐', () => {
    renderWithProvider(<LeftPanel collapsed={false} onExpand={() => {}} />)
    // 初始全部展开：会话可见
    expect(screen.queryByText(/重构登录流程/)).not.toBeNull()
    // 点"展开/折叠"——全展开时变全收起
    fireEvent.click(screen.getByRole('button', { name: '展开/折叠' }))
    expect(screen.queryByText(/重构登录流程/)).toBeNull()
    // 再点——全收起时变全展开
    fireEvent.click(screen.getByRole('button', { name: '展开/折叠' }))
    expect(screen.queryByText(/重构登录流程/)).not.toBeNull()
  })

  it('顶部"搜索"按钮打开搜索弹窗', () => {
    renderWithProvider(<LeftPanel collapsed={false} onExpand={() => {}} />)
    // 顶部与工作区都有"搜索"按钮，取所有同名按钮里的第一个（顶部那个）
    const searchBtns = screen.getAllByTitle('搜索')
    fireEvent.click(searchBtns[0])
    // 弹窗打开：placeholder 出现
    expect(screen.getByPlaceholderText('搜索会话、命令……')).toBeTruthy()
  })

  it('顶部"技能"按钮打开技能面板', () => {
    renderWithProvider(<LeftPanel collapsed={false} onExpand={() => {}} />)
    fireEvent.click(screen.getByTitle('技能'))
    // 技能面板有"本地技能"标题
    expect(screen.getByText('本地技能')).toBeTruthy()
  })
})
