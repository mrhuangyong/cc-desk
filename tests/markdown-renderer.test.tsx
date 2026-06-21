import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { MarkdownRenderer } from '../src/renderer/components/markdown/MarkdownRenderer'
import { AppProvider, useStore } from '../src/renderer/state/store'
import { seedProjects } from './fixtures'

function renderMd(text: string) {
  return render(<AppProvider initialProjects={structuredClone(seedProjects)}><MarkdownRenderer text={text} /></AppProvider>)
}

function renderMdWithProject(text: string, cwd: string) {
  const projects = structuredClone(seedProjects)
  projects[0].path = cwd
  function TabsSnapshot() {
    const { state } = useStore()
    return <output data-testid="tabs">{JSON.stringify(state.tabsBySession[state.activeSessionId] ?? [])}</output>
  }
  return render(
    <AppProvider initialProjects={projects}>
      <MarkdownRenderer text={text} />
      <TabsSnapshot />
    </AppProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// 验证 Markdown 渲染关键路径。CodeBlock/MermaidBlock 内部依赖 shiki/mermaid 异步初始化，
// 这里只验证 react-markdown 解析与组件分流（不验证高亮/图表的实际像素输出）。
describe('MarkdownRenderer', () => {
  it('渲染标题为对应层级 h 标签', () => {
    const { container } = renderMd('# 标题一\n## 标题二')
    expect(container.querySelector('h1')?.textContent).toBe('标题一')
    expect(container.querySelector('h2')?.textContent).toBe('标题二')
  })

  it('GFM 任务列表渲染为 checkbox', () => {
    const { container } = renderMd('- [x] 完成\n- [ ] 未完成')
    const checks = container.querySelectorAll('input[type="checkbox"]')
    expect(checks.length).toBe(2)
    expect((checks[0] as HTMLInputElement).checked).toBe(true)
  })

  it('代码块按语言分流：mermaid 走 MermaidBlock（出现 mermaid 容器）', () => {
    const { container } = renderMd('```mermaid\ngraph TD; A-->B\n```')
    expect(container.querySelector('.mermaid-block')).toBeTruthy()
  })

  it('普通代码块走 CodeBlock（同步先渲染 fallback 纯文本，异步后 shiki 高亮）', async () => {
    const { container } = renderMd('```ts\nconst x = 1\n```')
    // 同步态：CodeBlock 未高亮时先渲染纯文本 pre/code，内容不丢
    expect(container.querySelector('pre code')?.textContent ?? '').toContain('const x = 1')
    // 异步高亮完成后出现 shiki-block
    await waitFor(() => {
      expect(container.querySelector('.shiki-block')).toBeTruthy()
    })
  })

  it('行内代码渲染为 code 标签', () => {
    const { container } = renderMd('这是 `inline` 代码')
    const code = container.querySelector('p code')
    expect(code?.textContent).toBe('inline')
  })

  it('行内代码中的真实文件路径渲染为可打开文件控件', async () => {
    const cwd = '/workspace/cc-desk'
    const relPath = 'docs/superpowers/specs/2026-06-21-ai-chart-to-dashboard-design.md'
    const absPath = `${cwd}/${relPath}`
    vi.stubGlobal('window', Object.assign(window, {
      api: { fs: { exists: vi.fn(async (path: string) => path === absPath) } },
    }))

    const { container, getByTestId } = renderMdWithProject(`请打开 \`${relPath}\` 审阅`, cwd)

    const fileControl = await waitFor(() => {
      const el = container.querySelector('span[role="button"][title]')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    expect(fileControl.textContent).toBe(relPath)
    expect(container.querySelector('p code')?.textContent).not.toBe(relPath)

    fireEvent.click(fileControl)

    await waitFor(() => {
      expect(getByTestId('tabs').textContent).toContain(absPath)
    })
  })

  it('行内代码中的 URL 渲染为可打开浏览器控件', async () => {
    const url = 'https://example.com/spec'
    const { container, getByTestId } = renderMdWithProject(`请打开 \`${url}\` 查看`, '/workspace/cc-desk')

    const urlControl = await waitFor(() => {
      const el = container.querySelector('span[role="button"]')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    expect(urlControl.textContent).toContain(url)
    expect(container.querySelector('p code')?.textContent).not.toBe(url)

    fireEvent.click(urlControl)

    await waitFor(() => {
      expect(getByTestId('tabs').textContent).toContain(url)
    })
  })

  it('在消息末尾为 URL 输出网站资源卡片', async () => {
    const url = 'http://localhost:1420'
    const { getByTestId } = renderMdWithProject(`访问 ${url}`, '/workspace/cc-desk')

    const card = await waitFor(() => getByTestId('resource-card-url-http://localhost:1420'))
    expect(card.textContent).toContain('localhost:1420')
    expect(card.textContent).toContain('网站')
    expect(card.textContent).toContain('打开')

    fireEvent.click(getByTestId('resource-open-http://localhost:1420'))

    await waitFor(() => {
      expect(getByTestId('tabs').textContent).toContain(url)
    })
  })

  it('在消息末尾为真实文件路径输出文件资源卡片', async () => {
    const cwd = '/workspace/cc-desk'
    const relPath = 'docs/superpowers/specs/2026-06-21-ai-chart-to-dashboard-design.md'
    const absPath = `${cwd}/${relPath}`
    vi.stubGlobal('window', Object.assign(window, {
      api: { fs: { exists: vi.fn(async (path: string) => path === absPath) } },
    }))

    const { getByTestId } = renderMdWithProject(`请打开 \`${relPath}\` 审阅`, cwd)

    const card = await waitFor(() => getByTestId(`resource-card-file-${absPath}`))
    expect(card.textContent).toContain('2026-06-21-ai-chart-to-dashboard-design.md')
    expect(card.textContent).toContain('文件')
    expect(card.textContent).toContain('打开')

    fireEvent.click(getByTestId(`resource-open-${absPath}`))

    await waitFor(() => {
      expect(getByTestId('tabs').textContent).toContain(absPath)
    })
  })

  it('数学公式：行内 $...$ 渲染为 katex', () => {
    const { container } = renderMd('公式 $E=mc^2$ 在此')
    expect(container.querySelector('.katex')).toBeTruthy()
  })

  it('链接正文仍渲染为朴素可点击文本', () => {
    const { container } = renderMd('[官网](https://example.com)')
    // 不再用 <a>，而是 role="button" 的 span 文本链接
    expect(container.querySelector('a')).toBeNull()
    const link = container.querySelector('span[role="button"]')
    expect(link).toBeTruthy()
    // 含原始链接文字
    expect(link?.textContent).toContain('官网')
  })

  it('裸 URL 自动识别为可点击链接', () => {
    const { container } = renderMd('访问 https://example.com 看看')
    const link = container.querySelector('span[role="button"]')
    expect(link).toBeTruthy()
    expect(link?.textContent).toContain('example.com')
  })
})
