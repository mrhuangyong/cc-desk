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

  it('点击二进制文件不触发 onOpenFile', async () => {
    const tree = [
      { name: 'a.ts', path: '/proj/a.ts', isDir: false },
      { name: 'pkg.zip', path: '/proj/pkg.zip', isDir: false },
    ]
    fsMock.readTree.mockResolvedValue(tree)
    const onOpen = vi.fn()
    render(<FileExplorerPanel cwd="/proj" onOpenFile={onOpen} />)
    await waitFor(() => expect(screen.getByText('pkg.zip')).toBeTruthy())
    fireEvent.click(screen.getByText('pkg.zip'))
    expect(onOpen).not.toHaveBeenCalled()              // 二进制：拦截
  })

  it('点击图片文件触发 onOpenFile', async () => {
    fsMock.readTree.mockResolvedValue([{ name: 'pic.png', path: '/proj/pic.png', isDir: false }])
    const onOpen = vi.fn()
    render(<FileExplorerPanel cwd="/proj" onOpenFile={onOpen} />)
    await waitFor(() => expect(screen.getByText('pic.png')).toBeTruthy())
    fireEvent.click(screen.getByText('pic.png'))
    expect(onOpen).toHaveBeenCalledWith('/proj/pic.png')
  })
})
