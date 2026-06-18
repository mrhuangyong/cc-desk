import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
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
const URL_RE = /https?:\/\/[^\s<>)\]]+/g
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
          if (m.index > last) parts.push({ type: 'text', value: child.value.slice(last, m.index) })
          parts.push({ type: 'link', url: m[0], children: [{ type: 'text', value: m[0] }] })
          last = m.index + m[0].length
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

// 对话区 Markdown 渲染：GFM + 数学公式 + shiki 代码高亮 + mermaid 图表。
// 自动识别 bare URL 为链接。链接点击用内置浏览器（dispatch OPEN_TAB）。
// className="md" 让 index.css 的 .md 样式生效。
export function MarkdownRenderer({ text }: { text: string }) {
  const { dispatch } = useStore()
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
          // 链接：内置浏览器打开（不再走系统浏览器）
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  if (href) dispatch({ type: 'OPEN_TAB', tabType: 'browser', url: href })
                }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
