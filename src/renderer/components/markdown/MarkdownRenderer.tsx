import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { ExternalLink } from 'lucide-react'
import { useStore } from '../../state/store'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'

// 从 react-markdown 传给 code 的 className（如 "language-ts"）提取语言
function langFromClassName(className?: string): string {
  if (!className) return ''
  const m = /language-(\w+)/.exec(className)
  return m ? m[1] : ''
}

// remark 插件：自动识别文本中的 bare URL，转换为链接节点。
// 不依赖 unist-util-visit，递归遍历 AST，仅处理 text 类型节点（跳过已有的 link/code 节点）。
// 排除 CJK 标点避免吃掉 URL 后的中文；西文尾部标点用 cleanUrl 修剪。
const URL_RE = /https?:\/\/[^\s<>)\]"'`，。、；：！？）】》*]+/g
// 修剪 URL 尾部常见标点（URL 内部的 . 不修剪，但末尾孤立标点要剪掉）
const TRAIL_PUNCT = /[.,;:!?)*]+$/
function cleanUrl(url: string): string {
  return url.replace(TRAIL_PUNCT, '')
}
function remarkLinkify() {
  return (tree: any) => {
    walkAndLinkify(tree)
  }
}
function walkAndLinkify(node: any) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.children)) {
    // 只处理 text 节点；跳过已有 link/code/inlineCode（避免重复链接化）
    const newChildren: any[] = []
    let changed = false
    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string') {
        const parts: any[] = []
        let last = 0
        let m: RegExpExecArray | null
        URL_RE.lastIndex = 0
        while ((m = URL_RE.exec(child.value)) !== null) {
          const raw = m[0]
          const url = cleanUrl(raw)
          if (url) {
            if (m.index > last) parts.push({ type: 'text', value: child.value.slice(last, m.index) })
            parts.push({ type: 'link', url, children: [{ type: 'text', value: url }] })
          }
          last = m.index + raw.length
        }
        if (parts.length > 0) {
          if (last < child.value.length) parts.push({ type: 'text', value: child.value.slice(last) })
          newChildren.push(...parts)
          changed = true
        } else {
          newChildren.push(child)
        }
      } else {
        walkAndLinkify(child)
        newChildren.push(child)
      }
    }
    if (changed) node.children = newChildren
  }
}

// 链接组件：显示 URL 文本 + 打开按钮，点击打开按钮在内置浏览器中打开。
// 不用 <a> 包裹整个链接（避免 markdown 格式符号 ** _ 等干扰点击区域）。
function LinkWithOpenButton({ href, children }: { href?: string; children: React.ReactNode }) {
  const { dispatch } = useStore()
  if (!href) return <span>{children}</span>
  const open = () => dispatch({ type: 'OPEN_TAB', tabType: 'browser', url: href })
  return (
    <span style={{ display: 'inline', alignItems: 'baseline', gap: 4 }}>
      <span style={{ color: 'var(--accent)', textDecoration: 'underline', textDecorationColor: 'color-mix(in srgb, var(--accent) 40%, transparent)', cursor: 'default' }}>
        {children}
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); open() }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); open() } }}
        title="在内置浏览器打开"
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: 'var(--accent)', marginLeft: 2, opacity: 0.7, verticalAlign: 'middle' }}
      >
        <ExternalLink size={12} />
      </span>
    </span>
  )
}

// 对话区 Markdown 渲染：GFM + 数学公式 + shiki 代码高亮 + mermaid 图表。
// 自动识别 bare URL 为链接，显示 URL 文本 + 打开按钮。
// className="md" 让 index.css 的 .md 样式生效。
export function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkLinkify]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 代码：inline（无 language- class）→ 内联 code；block → CodeBlock 或 Mermaid
          code({ className, children, ...props }) {
            const lang = langFromClassName(className)
            const raw = String(children ?? '').replace(/\n$/, '')
            if (!lang) {
              // 行内代码：交回默认渲染（套 .md 内联样式）
              return <code className={className} {...props}>{children}</code>
            }
            if (lang === 'mermaid') {
              return <MermaidBlock chart={raw} />
            }
            return <CodeBlock code={raw} lang={lang} />
          },
          // 链接：显示 URL 文本 + 打开按钮（内置浏览器），不用 <a> 包裹避免格式干扰
          a({ href, children }) {
            return <LinkWithOpenButton href={href}>{children}</LinkWithOpenButton>
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
