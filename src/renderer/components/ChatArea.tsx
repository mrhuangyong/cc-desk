import { useState } from 'react'
import { useStore } from '../state/store'

export function ChatArea() {
  const { state } = useStore()
  const [input, setInput] = useState('')

  // 找当前会话
  const session = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)

  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>无选中会话</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        💬 {session.title}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {session.messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>开始新的对话</div>
        )}
        {session.messages.map(m => (
          <div key={m.id} style={{
            maxWidth: '80%', padding: '8px 12px', borderRadius: 'var(--radius)',
            background: m.role === 'user' ? 'var(--bg-hover)' : 'var(--accent)',
            color: m.role === 'user' ? 'var(--text)' : 'var(--accent-text)',
            alignSelf: m.role === 'user' ? 'flex-start' : 'flex-end'
          }}>
            {m.content}
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="给 AI 发消息……"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)',
            fontFamily: 'var(--font)'
          }}
        />
      </div>
    </div>
  )
}
