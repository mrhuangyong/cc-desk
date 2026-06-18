import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MarkdownRenderer } from '../src/renderer/components/markdown/MarkdownRenderer'
import { AppProvider } from '../src/renderer/state/store'
import { seedProjects } from './fixtures'

function renderMd(text: string) {
  return render(<AppProvider initialProjects={structuredClone(seedProjects)}><MarkdownRenderer text={text} /></AppProvider>)
}

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

  it('数学公式：行内 $...$ 渲染为 katex', () => {
    const { container } = renderMd('公式 $E=mc^2$ 在此')
    expect(container.querySelector('.katex')).toBeTruthy()
  })

  it('链接渲染为 URL 文本 + 打开按钮（非 a 标签，避免 markdown 格式干扰）', () => {
    const { container } = renderMd('[官网](https://example.com)')
    // 不再用 <a> 包裹整个链接（避免 ** _ 等 markdown 格式符号干扰点击区域）
    // 链接文本用 span 渲染，旁边有打开按钮（ExternalLink 图标）
    expect(container.querySelector('a')).toBeNull()
    const spans = container.querySelectorAll('span')
    const urlSpan = Array.from(spans).find(s => s.textContent?.includes('官网'))
    expect(urlSpan).toBeTruthy()
    const openBtn = Array.from(spans).find(s => s.getAttribute('role') === 'button')
    expect(openBtn).toBeTruthy()
  })
})
