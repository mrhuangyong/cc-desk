import { useStore } from '../state/store'
import { AttachmentChip } from './AttachmentChip'

export function ChatArea() {
  const { state } = useStore()

  // 找当前会话
  const session = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)

  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>无选中会话</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {session.messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 60 }}>开始新的对话</div>
        )}
        {session.messages.map(m => (
          m.role === 'assistant' ? (
            // AI 消息：左对齐，纯文本无背景
            <div key={m.id} style={{
              maxWidth: '80%', alignSelf: 'flex-start',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 6
            }}>
              {m.attachment && <AttachmentChip attachment={m.attachment} />}
              {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
            </div>
          ) : (
            // 用户消息：右对齐，浅灰块
            <div key={m.id} style={{
              maxWidth: '80%', alignSelf: 'flex-end',
              background: 'var(--bg-hover)', borderRadius: 10, padding: '9px 13px',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 6
            }}>
              {m.attachment && <AttachmentChip attachment={m.attachment} />}
              {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
            </div>
          )
        ))}
      </div>
    </div>
  )
}
