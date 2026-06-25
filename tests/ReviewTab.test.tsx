import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { ReviewTab } from '../src/renderer/components/ReviewTab'
import { seedProjects } from './fixtures'

// mock window.api.git
const gitMock = {
  status: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  restore: vi.fn(),
  commit: vi.fn(),
  resetHard: vi.fn(),
  generateCommitMessage: vi.fn(),
}
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  ;(window as any).api = { git: gitMock }
})

// seedProjects 的项目没有 path 字段，而 ReviewTab 通过 project.path 推 cwd。
// 这里浅克隆种子并给 p1 补一个 path，避免 cwd 为 undefined 时 refreshStatus 提前返回。
function seedWithPath(): typeof seedProjects {
  return [
    { ...seedProjects[0], path: '/fake/repo' },
    ...seedProjects.slice(1),
  ]
}

function renderReview() {
  return render(
    <AppProvider initialProjects={seedWithPath()}>
      <ReviewTab />
    </AppProvider>
  )
}

describe('ReviewTab', () => {
  it('挂载时拉取 status 并渲染文件列表', async () => {
    gitMock.status.mockResolvedValue([
      { path: 'a.ts', indexStatus: null, workdirStatus: 'modified' },
    ])
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    expect(gitMock.status).toHaveBeenCalled()
  })

  it('勾选未暂存文件触发 add', async () => {
    gitMock.status.mockResolvedValue([
      { path: 'a.ts', indexStatus: null, workdirStatus: 'modified' },
    ])
    gitMock.add.mockResolvedValue(undefined)
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() => expect(gitMock.add).toHaveBeenCalledWith(expect.any(String), ['a.ts']))
  })

  it('点提交且无消息时自动生成 commit message 再提交', async () => {
    gitMock.status.mockResolvedValue([{ path: 'a.ts', indexStatus: 'modified', workdirStatus: null }])
    gitMock.generateCommitMessage.mockResolvedValue('feat: add a')
    gitMock.commit.mockResolvedValue({ sha: 'abc1234' })
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    const submitBtn = screen.getByText('提交')
    fireEvent.click(submitBtn)
    await waitFor(() => expect(gitMock.generateCommitMessage).toHaveBeenCalled())
    await waitFor(() => expect(gitMock.commit).toHaveBeenCalledWith(expect.any(String), 'feat: add a'))
  })

  it('commit 成功后清空 message', async () => {
    gitMock.status.mockResolvedValue([{ path: 'a.ts', indexStatus: 'modified', workdirStatus: null }])
    gitMock.commit.mockResolvedValue({ sha: 'abc1234' })
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    const textarea = screen.getByPlaceholderText(/commit message/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'feat: x' } })
    fireEvent.click(screen.getByText('提交'))
    await waitFor(() => expect(gitMock.commit).toHaveBeenCalledWith(expect.any(String), 'feat: x'))
    await waitFor(() => expect((screen.getByPlaceholderText(/commit message/i) as HTMLTextAreaElement).value).toBe(''))
  })

  it('非 git 仓库显示空状态', async () => {
    const err = Object.assign(new Error('not a repo'), { code: 'NOT_A_REPO' })
    gitMock.status.mockRejectedValue(err)
    renderReview()
    await waitFor(() => expect(screen.getByText(/不是 git 仓库/)).toBeTruthy())
  })
})
