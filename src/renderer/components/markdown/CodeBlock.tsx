import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { highlightCode, toShikiTheme } from './shiki-highlighter'

// 代码块：调 shiki 高亮（light + dark 两套），消费 CodePreviewSettings。
// 行号/换行/字号通过 inline style 控制 shiki 输出的 <pre>。
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { state } = useStore()
  const cp = state.settings.codePreview
  const [pair, setPair] = useState<{ light: string; dark: string } | null>(null)

  const lightTheme = toShikiTheme(cp.lightTheme)
  const darkTheme = toShikiTheme(cp.darkTheme)

  useEffect(() => {
    let cancelled = false
    highlightCode(code, lang || 'plaintext', lightTheme, darkTheme).then(p => {
      if (!cancelled) setPair(p)
    }).catch(() => {
      if (!cancelled) setPair(null)
    })
    return () => { cancelled = true }
  }, [code, lang, lightTheme, darkTheme])

  // 行号：用 CSS counter，挂在容器上
  const preStyle: React.CSSProperties = {
    fontSize: cp.fontSize,
    whiteSpace: cp.wordWrap ? 'pre-wrap' : 'pre',
    wordBreak: cp.wordWrap ? 'break-word' : 'normal',
    margin: 0,
  }
  const wrapperStyle: React.CSSProperties = {
    margin: '8px 0',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  }

  if (!pair) {
    // 高亮尚未就绪：先显示纯文本，避免闪烁空白
    return (
      <div style={wrapperStyle}>
        <pre style={{ ...preStyle, padding: 12, color: 'var(--text)' }}><code>{code}</code></pre>
      </div>
    )
  }

  return (
    <div style={wrapperStyle} className="shiki-block">
      <div className="shiki-light" style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: pair.light }} />
      <div className="shiki-dark" style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: pair.dark }} />
    </div>
  )
}
