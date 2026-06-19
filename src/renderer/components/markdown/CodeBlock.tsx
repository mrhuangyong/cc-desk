import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useStore } from '../../state/store'
import { highlightCode, toShikiTheme } from './shiki-highlighter'

// 代码块：shiki 双主题高亮 + 顶部 header（语言标签 + 复制钮）。
// 消费 CodePreviewSettings：行号/换行/字号/明暗主题。
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { state } = useStore()
  const cp = state.settings.codePreview
  const [pair, setPair] = useState<{ light: string; dark: string } | null>(null)
  const [copied, setCopied] = useState(false)

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

  const onCopy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const preStyle: React.CSSProperties = {
    fontSize: cp.fontSize,
    whiteSpace: cp.wordWrap ? 'pre-wrap' : 'pre',
    wordBreak: cp.wordWrap ? 'break-word' : 'normal',
    margin: 0,
  }
  const wrapperStyle: React.CSSProperties = {
    margin: '10px 0',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-hair)',
    borderRadius: 8,
    overflow: 'hidden',
  }

  return (
    <div style={wrapperStyle} className="shiki-block">
      {/* header：语言标签 + 复制钮 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 10px 5px 12px',
        borderBottom: '1px solid var(--border-hair)',
        background: 'var(--surface-1)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
      }}>
        <span style={{ color: 'var(--text-muted)', textTransform: 'lowercase', letterSpacing: 0.3 }}>
          {lang || 'text'}
        </span>
        <button
          onClick={onCopy}
          title="复制代码"
          aria-label="复制代码"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 6px', borderRadius: 5, lineHeight: 1,
            color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer',
            transition: 'background .12s, color .12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span style={{ fontSize: 10.5 }}>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        {pair ? (
          <>
            <div className="shiki-light" style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: pair.light }} />
            <div className="shiki-dark" style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: pair.dark }} />
          </>
        ) : (
          <pre style={{ ...preStyle, padding: 12, color: 'var(--text)' }}><code>{code}</code></pre>
        )}
      </div>
    </div>
  )
}
