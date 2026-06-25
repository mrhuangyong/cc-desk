// web/src/pages/SessionListPage.tsx
// PWA 会话列表页（Task 14）。
//
// 职责：渲染桌面下发的 session.list（payload: {sessions:[{localSessionId,title,status}]}），
//   点击会话 → onAttach(localSessionId)（→ session.attach）；「新建」→ onCreate（→ session.create）。
//
// 数据来源由父组件（App）持有（订阅 useRelay 收 session.list 后 parse 落入 props），
//   本页只做渲染 + 点击回调，传输逻辑在 App 胶水层，便于测试与解耦。
import React from 'react'
import { type SessionListItem, sessionStatusToLabel } from '../lib/session-list'

export interface SessionListPageProps {
  /** 中继是否已连接（bind 握手完成）。 */
  connected: boolean
  /** 会话清单（已从 session.list 信封 parse）。 */
  sessions: SessionListItem[]
  /** 点击某会话（→ session.attach）。 */
  onAttach: (localSessionId: string) => void
  /** 点击「新建」（→ session.create）。 */
  onCreate: () => void
}

export default function SessionListPage(props: SessionListPageProps) {
  const { connected, sessions, onAttach, onCreate } = props

  return (
    <div className="session-list-page">
      <header className="app-header">
        <h1>会话</h1>
        <span className={`status ${connected ? 'on' : 'off'}`}>
          {connected ? '已连接' : '连接中'}
        </span>
      </header>

      <main className="session-list-body">
        {connected && sessions.length === 0 && (
          <p className="hint">暂无会话，点击右下「新建」开始</p>
        )}
        {!connected && <p className="hint">连接中…</p>}

        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.localSessionId}>
              <button className="session-item" onClick={() => onAttach(s.localSessionId)}>
                <span className="session-title">{s.title || '未命名会话'}</span>
                <span className={`session-status ${s.status}`}>{sessionStatusToLabel(s.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>

      <button className="fab" onClick={onCreate} aria-label="新建会话" disabled={!connected}>
        + 新建
      </button>
    </div>
  )
}
