import { useState } from 'react'
import { useStore } from '../state/store'
import { AttachmentChip } from './AttachmentChip'

export function ChatArea() {
  const { state, dispatch } = useStore()
  const [composing, setComposing] = useState(false) // 预留：中文输入法合成态，避免 Enter 误发送

  // 找当前会话
  const session = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)

  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>无选中会话</div>
  }

  const { text, attachment } = state.draft
  const canSend = text.trim().length > 0 || !!attachment

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !composing) {
      e.preventDefault()
      if (canSend) dispatch({ type: 'SEND_MESSAGE' })
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {session.messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>开始新的对话</div>
        )}
        {session.messages.map(m => (
          <div key={m.id} style={{
            maxWidth: '80%', padding: '8px 12px', borderRadius: 'var(--radius)',
            background: m.role === 'user' ? 'var(--bg-hover)' : 'var(--accent)',
            color: m.role === 'user' ? 'var(--text)' : 'var(--accent-text)',
            alignSelf: m.role === 'user' ? 'flex-start' : 'flex-end',
            display: 'flex', flexDirection: 'column', gap: 6
          }}>
            {m.attachment && <AttachmentChip attachment={m.attachment} />}
            {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
          </div>
        ))}
      </div>
      <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8, padding: '6px 8px', borderRadius: 'var(--radius)',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)'
        }}>
          {attachment && (
            <AttachmentChip
              attachment={attachment}
              onRemove={() => dispatch({ type: 'CLEAR_DRAFT_ATTACHMENT' })}
            />
          )}
          <input
            value={text}
            onChange={e => dispatch({ type: 'SET_DRAFT_TEXT', text: e.target.value })}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            placeholder="给 AI 发消息……"
            style={{
              flex: 1, padding: '6px 4px', background: 'transparent', border: 'none', color: 'var(--text)',
              fontFamily: 'var(--font)', outline: 'none'
            }}
          />
          <button
            onClick={() => canSend && dispatch({ type: 'SEND_MESSAGE' })}
            disabled={!canSend}
            title="发送"
            style={{
              padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: 13,
              background: canSend ? 'var(--accent)' : 'var(--bg-hover)',
              color: canSend ? 'var(--accent-text)' : 'var(--text-muted)',
              border: 'none', cursor: canSend ? 'pointer' : 'not-allowed'
            }}
          >发送</button>
        </div>
      </div>
    </div>
  )
}
