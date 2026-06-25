import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { FileTab } from '../src/renderer/components/FileTab'
import { seedProjects } from './fixtures'

const fsMock = { readTree: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  // jsdom 不提供 matchMedia，Monaco 渲染时会调用，补上避免 unhandled rejection 噪声
  if (!(window as any).matchMedia) {
    ;(window as any).matchMedia = (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })
  }
  ;(window as any).api = { fs: fsMock }
  fsMock.readTree.mockResolvedValue([{ name: 'a.ts', path: '/proj/a.ts', isDir: false }])
})

function seedWithPath() {
  return seedProjects.map(p => ({ ...p, path: p.path ?? '/proj' }))
}

describe('FileTab 两栏', () => {
  it('无 filePath 时渲染文件树 + 空态提示', async () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileTab tabId="t1" /></AppProvider>)
    await waitFor(() => expect(fsMock.readTree).toHaveBeenCalled())
    expect(screen.getByText('选择一个文件')).toBeTruthy()
  })

  it('点击文件树文件后右栏加载内容', async () => {
    fsMock.readFile.mockResolvedValue('hello')
    render(<AppProvider initialProjects={seedWithPath()}><FileTab tabId="t1" /></AppProvider>)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('a.ts'))
    await waitFor(() => expect(fsMock.readFile).toHaveBeenCalledWith('/proj/a.ts'))
  })

  it('有 filePath 时右栏直接加载该文件', async () => {
    fsMock.readFile.mockResolvedValue('preset')
    render(<AppProvider initialProjects={seedWithPath()}><FileTab tabId="t1" filePath="/proj/a.ts" /></AppProvider>)
    await waitFor(() => expect(fsMock.readFile).toHaveBeenCalledWith('/proj/a.ts'))
  })
})
