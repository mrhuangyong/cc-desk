import { useEffect, useRef, useState, type Dispatch } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import { ChevronDown, ExternalLink, FileText, Globe2 } from 'lucide-react'
import { URL_RE, cleanUrl } from '../../utils/url'
import { tokenizeLinks, resolvePath } from '../../utils/links'
import { useStore } from '../../state/store'
import type { Action } from '../../state/actions'
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

function linkFromInlineCode(raw: string): { kind: 'url'; href: string } | { kind: 'file'; href: string } | null {
  if (!raw || raw.includes('\n')) return null
  const text = raw.trim()
  if (text !== raw) return null
  const tokens = tokenizeLinks(text)
  if (tokens.length !== 1) return null
  if (tokens[0].raw !== text) return null
  if (tokens[0].kind === 'url' && tokens[0].href) {
    return { kind: 'url', href: tokens[0].href }
  }
  if (tokens[0].kind === 'path' && tokens[0].path) {
    const hash = tokens[0].line ? `#L${tokens[0].line}` : ''
    return { kind: 'file', href: `file:${tokens[0].path}${hash}` }
  }
  return null
}

type ResourceItem =
  | { kind: 'url'; href: string; title: string; subtitle: string }
  | { kind: 'file'; href: string; filePath: string; title: string; subtitle: string }

function extractResourceItems(text: string, cwd: string): ResourceItem[] {
  const items: ResourceItem[] = []
  const seen = new Set<string>()
  for (const tk of tokenizeLinks(text)) {
    if (tk.kind === 'url' && tk.href) {
      const key = `url:${tk.href}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        kind: 'url',
        href: tk.href,
        title: displayUrlTitle(tk.href),
        subtitle: '网站',
      })
    } else if (tk.kind === 'path' && tk.path) {
      const filePath = resolvePath(tk.path, cwd)
      const key = `file:${filePath}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        kind: 'file',
        href: `file:${tk.path}${tk.line ? `#L${tk.line}` : ''}`,
        filePath,
        title: filePath.split(/[\\/]/).pop() || filePath,
        subtitle: '文件',
      })
    }
  }
  return items
}

function displayUrlTitle(href: string): string {
  try {
    const url = new URL(href)
    return url.host || href
  } catch {
    return href
  }
}

function ResourceCards({ text }: { text: string }) {
  const store = useOptionalStore()
  if (!store) return null
  const { state, dispatch } = store
  const cwd = useCwd(state)
  const resources = extractResourceItems(text, cwd)
  if (resources.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {resources.map((item) => <ResourceCard key={`${item.kind}:${item.href}`} item={item} dispatch={dispatch} />)}
    </div>
  )
}

function useOptionalStore() {
  try {
    return useStore()
  } catch {
    return null
  }
}

// 判断路径是否为「可打开的文件」：仅文件才生成卡片/可点链接，
// 文件夹虽存在但不适合走文件预览，故排除。优先用 fs.statKind（区分文件/目录），
// 回退到老的 fs.exists（保持向后兼容，老 mock/老主进程仍能用）。
async function isFile(filePath: string): Promise<boolean> {
  try {
    const fs = (window as any)?.api?.fs
    if (!fs) return false
    if (typeof fs.statKind === 'function') {
      const kind: string = await fs.statKind(filePath)
      return kind === 'file'
    }
    if (typeof fs.exists === 'function') {
      return Boolean(await fs.exists(filePath))
    }
    return false
  } catch {
    return false
  }
}

function ResourceCard({ item, dispatch }: { item: ResourceItem; dispatch: Dispatch<Action> }) {
  const [exists, setExists] = useState(item.kind === 'url')
  useEffect(() => {
    if (item.kind !== 'file') return
    let cancelled = false
    isFile(item.filePath).then((ok: boolean) => {
      if (!cancelled) setExists(ok)
    }).catch(() => { if (!cancelled) setExists(false) })
    return () => { cancelled = true }
  }, [item.kind, item.kind === 'file' ? item.filePath : ''])

  if (!exists) return null

  const open = () => {
    if (item.kind === 'url') {
      dispatch({ type: 'OPEN_TAB', tabType: 'browser', url: item.href })
    } else {
      dispatch({ type: 'OPEN_FILE_TAB', filePath: item.filePath, fileName: item.title })
    }
  }
  const Icon = item.kind === 'url' ? Globe2 : FileText
  const testIdValue = item.kind === 'url' ? item.href : item.filePath

  return (
    <div
      data-testid={`resource-card-${item.kind}-${testIdValue}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        minHeight: 86,
        padding: '14px 18px 14px 14px',
        border: '1px solid var(--border)',
        borderRadius: 18,
        background: 'var(--surface-0, var(--bg))',
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
      }}
    >
      <div style={{
        width: 52,
        height: 52,
        borderRadius: 10,
        background: 'var(--surface-1)',
        color: 'var(--text-muted)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon size={27} strokeWidth={1.8} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 650, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.title}
        </div>
        <div style={{ marginTop: 7, fontSize: 14, fontWeight: 600, color: 'var(--text-faint)' }}>
          {item.subtitle}
        </div>
      </div>
      <button
        data-testid={`resource-open-${testIdValue}`}
        onClick={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 38,
          padding: '0 12px 0 15px',
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'var(--text)',
          fontSize: 16,
          fontWeight: 650,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        打开
        <ChevronDown size={16} color="var(--text-muted)" />
      </button>
    </div>
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
    isFile(absPath).then((ok: boolean) => {
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        textDecoration: 'underline',
        textDecorationColor: 'var(--text-faint)',
        textUnderlineOffset: '2px',
        cursor: 'pointer',
        borderRadius: 3,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'var(--text)' }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'var(--text-faint)' }}
    >
      <FileText size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
      {label}
    </span>
  )
}

// 取当前激活会话所属项目的 cwd，回退 settings.cwd
function useCwd(state: any): string {
  const projects = Array.isArray(state?.projects) ? state.projects : []
  const project = projects.find((p: any) => Array.isArray(p.sessions) && p.sessions.some((s: any) => s.id === state.activeSessionId))
  return project?.path || state.settings?.cwd || ''
}

// 对话区 Markdown 渲染：GFM + 数学公式 + shiki 代码高亮 + mermaid 图表。
// 自动识别 bare URL 与文件路径为可点击链接。
// remarkBreaks：让单个 \n 渲染成 <br>（软换行硬换行化）。
// 用户输入框里的多行（同段落内的硬换行）经 serializeForPrompt 序列化为单个 \n，
// 默认 markdown 会把单 \n 折叠成空格导致换行丢失；加 remark-breaks 后与输入态一致。
export function MarkdownRenderer({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkLinkifyAndPaths, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const lang = langFromClassName(className)
            const raw = String(children ?? '').replace(/\n$/, '')
            if (!lang) {
              const inlineLink = linkFromInlineCode(raw)
              if (inlineLink?.kind === 'file') {
                return <FilePathLink url={inlineLink.href}>{raw}</FilePathLink>
              }
              if (inlineLink?.kind === 'url') {
                return <LinkText href={inlineLink.href}>{raw}</LinkText>
              }
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
      <ResourceCards text={text} />
    </div>
  )
}

// 保留导出供 TerminalTab 等复用（向后兼容）
export { URL_RE, cleanUrl }
