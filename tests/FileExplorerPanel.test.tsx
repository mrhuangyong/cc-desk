import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { FileExplorerPanel } from '../src/renderer/components/FileExplorerPanel'
import type { FileNode } from '../src/renderer/types'

const fsMock = { readTree: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  ;(window as any).api = { fs: fsMock }
})

describe('FileExplorerPanel', () => {
  it('无 cwd 时显示空态', () => {
    render(<FileExplorerPanel onOpenFile={() => {}} />)
    expect(screen.getByText('未选择工作区')).toBeTruthy()
  })

  it('有 cwd 时拉取并渲染顶层文件', async () => {
    const tree: FileNode[] = [
      { name: 'a.ts', path: '/proj/a.ts', isDir: false },
      { name: 'src', path: '/proj/src', isDir: true },
    ]
    fsMock.readTree.mockResolvedValue(tree)
    render(<FileExplorerPanel cwd="/proj" onOpenFile={() => {}} />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    expect(screen.getByText('src')).toBeTruthy()
  })

  it('点击文件触发 onOpenFile', async () => {
    fsMock.readTree.mockResolvedValue([{ name: 'a.ts', path: '/proj/a.ts', isDir: false }])
    const onOpen = vi.fn()
    render(<FileExplorerPanel cwd="/proj" onOpenFile={onOpen} />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('a.ts'))
    expect(onOpen).toHaveBeenCalledWith('/proj/a.ts')
  })
})
