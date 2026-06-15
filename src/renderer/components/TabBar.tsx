import { useStore } from '../state/store'
import { FileTab } from './FileTab'
import { BrowserTab } from './BrowserTab'
import { TerminalTab } from './TerminalTab'
import type { TabType } from '../types'

const TAB_ICON: Record<TabType, string> = { file: '📄', browser: '🌐', terminal: '🖥' }

export function TabBar() {
  const { state, dispatch } = useStore()
  const sessionId = state.activeSessionId
  const tabs = state.tabsBySession[sessionId] ?? []
  const activeTabId = state.activeTabIdBySession[sessionId] ?? null

  const renderContent = () => {
    const active = tabs.find(t => t.id === activeTabId)
    if (!active) return <div style={{ display: 'grid', placeItems: 'center', flex: 1, color: 'var(--text-muted)' }}>暂无打开的面板</div>
    if (active.type === 'file') return <FileTab filePath={active.filePath} />
    if (active.type === 'browser') return <BrowserTab />
    return <TerminalTab />
  }

  const addTab = () => {
    dispatch({ type: 'OPEN_TAB', tabType: 'browser' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
        {tabs.map(t => (
          <div
            key={t.id}
            onClick={() => dispatch({ type: 'SELECT_TAB', tabId: t.id })}
            style={{
              padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              borderBottom: activeTabId === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTabId === t.id ? 'var(--text)' : 'var(--text-muted)', fontSize: 13,
              maxWidth: 140
            }}
          >
            <span>{TAB_ICON[t.type]}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            <button onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE_TAB', tabId: t.id }) }} style={{ fontSize: 12, opacity: 0.6 }} aria-label="关闭标签">×</button>
          </div>
        ))}
        <button onClick={addTab} title="新增 Tab" style={{ padding: '0 10px', color: 'var(--text-muted)' }}>+</button>
      </div>
      {renderContent()}
    </div>
  )
}
