import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { ExternalLink } from 'lucide-react'
import { URL_RE, cleanUrl } from '../../utils/url'
import { tokenizeLinks, resolvePath } from '../../utils/links'
import { useStore } from '../../state/store'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'

// 从 react-markdown 传给 code 的 className（如 "language-ts"）提取语言
function langFromClassName(className?: string): string {
  if (!className) return ''
  const m = /language-(\w+)/.exec(className)
  return m ? m[1] : ''
}

// remark 插件：把文本节点里的 URL 和文件路径切成链接节点。
// URL → 普通 http(s) 链接；文件路径 → file: 伪协议链接（携带行号 hash），
// 由渲染层拦截处理。文件路径用「绝对/相对+分隔符」启发式匹配，
// 不在此处校验存在性，由渲染层异步校验。
function remarkLinkifyAndPaths() {
  return (tree: any) => walk(tree)
}
function walk(node: any) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.children)) {
    const next: any[] = []
    for (const child of node.children) {
      // 只在 text 节点切分（跳过已有 link/code/inlineCode，避免重复处理）
      if (child.type === 'text' && typeof child.value === 'string') {
        const tokens = tokenizeLinks(child.value)
        if (tokens.length === 1 && tokens[0].kind === 'text') {
          next.push(child) // 无链接，原样保留
          continue
        }
        for (const tk of tokens) {
          if (tk.kind === 'text') {
            next.push({ type: 'text', value: tk.raw })
          } else if (tk.kind === 'url') {
            next.push({ type: 'link', url: tk.href, children: [{ type: 'text', value: tk.raw }] })
          } else if (tk.kind === 'path') {
            const hash = tk.line ? `#L${tk.line}` : ''
            next.push({ type: 'link', url: `file:${tk.path}${hash}`, children: [{ type: 'text', value: tk.raw }] })
          }
        }
      } else {
        walk(child)
        next.push(child)
      }
    }
    node.children = next
  }
}

// 朴素文本链接（Codex 风）：轻量下划线链接 + 外链图标，点击打开内置浏览器。
function LinkText({ href, children }: { href?: string; children: React.ReactNode }) {
  const { dispatch } = useStore()
  if (!href) return <span>{children}</span>
  const label = typeof children === 'string' ? children : href
  const open = () => dispatch({ type: 'OPEN_TAB', tabType: 'browser', url: href })
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') open() }}
      style={{
        color: 'var(--text)',
        textDecoration: 'underline',
        textDecorationColor: 'var(--text-faint)',
        textUnderlineOffset: '2px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        borderRadius: 3,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'var(--text)' }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'var(--text-faint)' }}
    >
      <ExternalLink size={11} style={{ flexShrink: 0, opacity: 0.55 }} />
      {label}
    </span>
  )
}

// 文件路径链接：file: 伪协议。异步校验存在性，存在才可点击打开，
// 不存在则渲染为普通文本（避免把误识别的词变成可点链接）。
function FilePathLink({ url, children }: { url: string; children: React.ReactNode }) {
  const { state, dispatch } = useStore()
  const cwd = useCwd(state)
  // url 形如 file:src/foo.ts 或 file:src/foo.ts#L42
  const inner = url.slice('file:'.length)
  const [relPath, hashPart] = inner.split('#')
  const lineNum = hashPart?.startsWith('L') ? Number(hashPart.slice(1)) : undefined
  const absPath = resolvePath(relPath, cwd)

  const [exists, setExists] = useState<boolean | null>(null)
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current) return
    checked.current = true
    let cancelled = false
    window.api?.fs?.exists(absPath).then((ok: boolean) => {
      if (!cancelled) setExists(ok)
    }).catch(() => { if (!cancelled) setExists(false) })
    return () => { cancelled = true }
  }, [absPath])

  // 未确认存在：渲染为普通文本（不可点），避免闪烁/误点
  if (exists === null || exists === false) {
    return <span style={{ color: 'var(--text)' }}>{children}</span>
  }

  const label = typeof children === 'string' ? children : relPath
  const open = () => {
    const fileName = absPath.split(/[\\/]/).pop() || absPath
    dispatch({ type: 'OPEN_FILE_TAB', filePath: absPath, fileName })
  }
  const title = lineNum ? `${absPath}:${lineNum}` : absPath
  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') open() }}
      style={{
        color: 'var(--text)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.9em',
        textDecoration: 'underline',
        textDecorationColor: 'var(--text-faint)',
        textUnderlineOffset: '2px',
        cursor: 'pointer',
        borderRadius: 3,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'var(--text)' }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'var(--text-faint)' }}
    >
      {label}
    </span>
  )
}

// 取当前激活会话所属项目的 cwd，回退 settings.cwd
function useCwd(state: any): string {
  const project = state.projects.find((p: any) => p.sessions.some((s: any) => s.id === state.activeSessionId))
  return project?.path || state.settings?.cwd || ''
}

// 对话区 Markdown 渲染：GFM + 数学公式 + shiki 代码高亮 + mermaid 图表。
// 自动识别 bare URL 与文件路径为可点击链接。
export function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkLinkifyAndPaths]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const lang = langFromClassName(className)
            const raw = String(children ?? '').replace(/\n$/, '')
            if (!lang) {
              return <code className={className} {...props}>{children}</code>
            }
            if (lang === 'mermaid') {
              return <MermaidBlock chart={raw} />
            }
            return <CodeBlock code={raw} lang={lang} />
          },
          a({ href, children }) {
            if (!href) return <span>{children}</span>
            // file: 伪协议 → 文件路径链接（异步校验存在性）
            if (href.startsWith('file:')) {
              return <FilePathLink url={href}>{children}</FilePathLink>
            }
            return <LinkText href={href}>{children}</LinkText>
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// 保留导出供 TerminalTab 等复用（向后兼容）
export { URL_RE, cleanUrl }
