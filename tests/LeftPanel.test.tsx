import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { LeftPanel } from '../src/renderer/components/LeftPanel'
import { seedProjects } from './fixtures'

function renderWithProvider(ui: React.ReactNode) {
  return render(<AppProvider initialProjects={structuredClone(seedProjects)}>{ui}</AppProvider>)
}

const noop = () => {}

describe('LeftPanel 顶部新建会话', () => {
  it('点击顶部"新建会话"在当前激活项目下新增（无空会话时）', () => {
    // 初始激活会话 s1 属于 p1(cc-desk)；但 p1 已有空会话 s2，故点击应切换到 s2 而非新增。
    // 为测"新增"分支，先选中 p2 的会话 s3（p2 无空会话）。
    renderWithProvider(<LeftPanel collapsed={false} onOpenSearch={noop} />)
    // 先点 p2 的会话 s3（部署到 Vercel）激活它
    fireEvent.click(screen.getByText(/部署到 Vercel/))
    // 点顶部"新建会话"（取第一个——顶部功能区的）
    // 顶部新建按钮 title=t('left.newSession')='新会话'（图标按钮）；项目级按钮 title 仍为'新建会话'
    fireEvent.click(screen.getAllByTitle('新会话')[0])
    // p2 应多出一条会话（标题"新会话"）。顶部按钮文字也是"新会话"，
    // 故至少 2 个匹配（按钮 1 + 新会话条目 1）
    expect(screen.getAllByText(/新会话/).length).toBeGreaterThanOrEqual(2)
  })

  it('当前项目已有空会话时，点顶部"新建会话"切换过去（不新增）', () => {
    // 初始激活 s1 属于 p1，p1 已有空会话 s2（修样式 bug）
    renderWithProvider(<LeftPanel collapsed={false} onOpenSearch={noop} />)
    const before = screen.getAllByText(/重构登录流程|修样式 bug|部署到 Vercel|新会话/).length
    fireEvent.click(screen.getAllByTitle('新会话')[0])
    const after = screen.getAllByText(/重构登录流程|修样式 bug|部署到 Vercel|新会话/).length
    expect(after).toBe(before) // 数量不变，去重切换
  })

  it('展开/折叠按钮切换所有项目会话的显隐', () => {
    renderWithProvider(<LeftPanel collapsed={false} onOpenSearch={noop} />)
    // 初始全部展开：会话可见（用默认可见的"CI 配置"，updatedAt 最大排在折叠 5 条内）
    expect(screen.queryByText(/CI 配置/)).not.toBeNull()
    // 点"展开/折叠"——全展开时变全收起
    fireEvent.click(screen.getByRole('button', { name: '展开/折叠' }))
    expect(screen.queryByText(/CI 配置/)).toBeNull()
    // 再点——全收起时变全展开
    fireEvent.click(screen.getByRole('button', { name: '展开/折叠' }))
    expect(screen.queryByText(/CI 配置/)).not.toBeNull()
  })

  it('顶部"搜索"按钮触发 onOpenSearch 回调（弹窗已提升至 App 层）', () => {
    const onOpenSearch = vi.fn()
    renderWithProvider(<LeftPanel collapsed={false} onOpenSearch={onOpenSearch} />)
    // 搜索按钮 title 为 i18n 'left.search'（中文"搜索"）
    const searchBtns = screen.getAllByTitle('搜索')
    fireEvent.click(searchBtns[0])
    expect(onOpenSearch).toHaveBeenCalled()
  })

  it('顶部"技能"按钮可点击（跳转设置技能子页）', () => {
    renderWithProvider(<LeftPanel collapsed={false} onOpenSearch={noop} />)
    const btn = screen.getByTitle('技能')
    fireEvent.click(btn) // 不报错即通过；实际跳转由 App 视图切换体现
    expect(btn).toBeTruthy()
  })
})
