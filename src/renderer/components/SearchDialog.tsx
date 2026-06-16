import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'

// 顶部"搜索"触发的全局搜索弹窗：搜会话（点击跳转）+ 命令（mock 占位）。
interface Props {
  onClose: () => void
}

// mock 命令项（原型占位，点击暂只关闭）
const MOCK_COMMANDS = [
  { id: 'cmd-new-project', label: '新建项目' },
  { id: 'cmd-theme', label: '切换主题' },
  { id: 'cmd-settings', label: '打开设置' },
  { id: 'cmd-new-session', label: '新建会话' }
]

export function SearchDialog({ onClose }: Props) {
  const { state, dispatch } = useStore()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = query.trim().toLowerCase()
  const allSessions = state.projects.flatMap(p => p.sessions.map(s => ({ session: s, project: p })))
  const matchedSessions = q
    ? allSessions.filter(({ session }) => session.title.toLowerCase().includes(q))
    : allSessions.slice(0, 6) // 无关键词时展示前几个
  const matchedCommands = q
    ? MOCK_COMMANDS.filter(c => c.label.toLowerCase().includes(q))
    : MOCK_COMMANDS

  const jumpToSession = (sessionId: string) => {
    dispatch({ type: 'SELECT_SESSION', sessionId })
    onClose()
  }

  const onCommandClick = (cmdId: string) => {
    if (cmdId === 'cmd-settings') dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })
    onClose()
  }

  const rowBase: React.CSSProperties = {
    padding: '8px 12px', cursor: 'pointer', borderRadius: 'var(--radius)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 90vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', overflow: 'hidden'
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索会话、命令……"
          style={{
            padding: '12px 14px', background: 'transparent', border: 'none',
            color: 'var(--text)', fontFamily: 'var(--font)', outline: 'none',
            borderBottom: '1px solid var(--border)', fontSize: 14
          }}
        />
        <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
          {matchedSessions.length === 0 && matchedCommands.length === 0 && (
            <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>无匹配结果</div>
          )}
          {matchedSessions.length > 0 && (
            <>
              <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)' }}>会话</div>
              {matchedSessions.map(({ session, project }) => (
                <div key={session.id} onClick={() => jumpToSession(session.id)} style={rowBase}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span>💬 {session.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{project.name}</span>
                </div>
              ))}
            </>
          )}
          {matchedCommands.length > 0 && (
            <>
              <div style={{ padding: '4px 12px', marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>命令</div>
              {matchedCommands.map(c => (
                <div key={c.id} onClick={() => onCommandClick(c.id)} style={rowBase}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span>⌘ {c.label}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
