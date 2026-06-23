import { useEffect, useState, useRef } from 'react'
import mermaid from 'mermaid'
import { useStore } from '../../state/store'

// mermaid.initialize 多次调用会内部合并配置（且首末次行为一致），
// 故无需 _initialized 单例守卫——每次按当前主题 init 即可（主题切换时重新渲染）。
function ensureInit(theme: 'default' | 'dark') {
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'loose' })
}

// Mermaid 图表渲染：异步 render 成 SVG，错误时回退显示原始代码 + 错误信息。
export function MermaidBlock({ chart }: { chart: string }) {
  const { state } = useStore()
  const isDark = state.theme === 'codex-dark'
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    let cancelled = false
    const trimmed = chart.trim()
    ensureInit(isDark ? 'dark' : 'default')
    setSvg(null)
    setErr(null)
    mermaid.render(idRef.current, trimmed)
      .then(({ svg }) => { if (!cancelled) setSvg(svg) })
      .catch((e: any) => { if (!cancelled) setErr(String(e?.message ?? e)) })
    return () => { cancelled = true }
  }, [chart, isDark])

  if (err) {
    return (
      <div className="mermaid-block">
        <div className="mermaid-error">⚠️ Mermaid 渲染失败：{err}</div>
        <pre style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{chart}</pre>
      </div>
    )
  }
  if (!svg) {
    return (
      <div className="mermaid-block" style={{ color: 'var(--text-muted)', fontSize: 12 }}>渲染中…</div>
    )
  }
  return (
    <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
  )
}
