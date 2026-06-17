import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'

// 从 react-markdown 传给 code 的 className（如 "language-ts"）提取语言
function langFromClassName(className?: string): string {
  if (!className) return ''
  const m = /language-(\w+)/.exec(className)
  return m ? m[1] : ''
}

// 对话区 Markdown 渲染：GFM + 数学公式 + shiki 代码高亮 + mermaid 图表。
// className="md" 让 index.css 的 .md 样式生效。
export function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
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
          // 外链用系统浏览器打开（与主进程 setWindowOpenHandler 一致）
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  if (href) window.open(href, '_blank')
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
