import { useState } from 'react'

export function BrowserTab() {
  const [url, setUrl] = useState('https://example.com')
  const [input, setInput] = useState(url)
  const [history, setHistory] = useState<string[]>([url])
  const [idx, setIdx] = useState(0)

  const navigate = (next: string) => {
    const full = next.startsWith('http') ? next : `https://${next}`
    const newHistory = [...history.slice(0, idx + 1), full]
    setHistory(newHistory)
    setIdx(newHistory.length - 1)
    setUrl(full)
    setInput(full)
  }

  const go = (delta: number) => {
    const ni = idx + delta
    if (ni < 0 || ni >= history.length) return
    setIdx(ni)
    setUrl(history[ni])
    setInput(history[ni])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid var(--border)' }}>
        <button disabled={idx === 0} onClick={() => go(-1)}>←</button>
        <button disabled={idx >= history.length - 1} onClick={() => go(1)}>→</button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(input) }}
          style={{ flex: 1, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)' }}
        />
      </div>
      <iframe src={url} style={{ flex: 1, border: 'none', background: '#fff' }} title="browser" />
    </div>
  )
}
