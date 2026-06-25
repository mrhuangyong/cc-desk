import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { FileEditorPane } from '../src/renderer/components/FileEditorPane'
import { seedProjects } from './fixtures'

const fsMock = { readFile: vi.fn(), writeFile: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  ;(window as any).api = { fs: fsMock }
})

// 给种子项目补 path（FileEditorPane 自身不读 cwd，但 AppProvider 需要 store 正常初始化）
function seedWithPath() {
  return seedProjects.map(p => ({ ...p, path: p.path ?? '/proj' }))
}

describe('FileEditorPane', () => {
  it('filePath 为空时显示选择提示', () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" /></AppProvider>)
    expect(screen.getByText('选择一个文件')).toBeTruthy()
  })

  it('有 filePath 时加载并显示内容', async () => {
    fsMock.readFile.mockResolvedValue('hello world')
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/a.ts" /></AppProvider>)
    await waitFor(() => expect(fsMock.readFile).toHaveBeenCalledWith('/proj/a.ts'))
  })

  it('读取失败时显示错误', async () => {
    fsMock.readFile.mockRejectedValue(new Error('boom'))
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/a.ts" /></AppProvider>)
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy())
  })

  it('图片类型渲染 <img> 预览', async () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/pic.png" /></AppProvider>)
    const img = await screen.findByRole('img')
    expect(img.getAttribute('src')).toContain('file://')
    expect(fsMock.readFile).not.toHaveBeenCalled()     // 图片不走 readFile
  })

  it('binary 类型显示不支持预览', async () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/pkg.zip" /></AppProvider>)
    await waitFor(() => expect(screen.getByText('该文件类型不支持预览')).toBeTruthy())
    expect(fsMock.readFile).not.toHaveBeenCalled()     // binary 不走 readFile
  })
})
