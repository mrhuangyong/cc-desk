import { useState, useRef, type CSSProperties, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { FileText, Globe, SquareTerminal, FileDiff, Plus } from 'lucide-react'
import { useStore } from '../state/store'
import { FileTab } from './FileTab'
import type { FileTabHandle } from './FileTab'
import { BrowserTab } from './BrowserTab'
import { TerminalTab } from './TerminalTab'
import { ReviewTab } from './ReviewTab'
import type { TabType } from '../types'

const TAB_ICON: Record<TabType, LucideIcon> = { file: FileText, browser: Globe, terminal: SquareTerminal, review: FileDiff }

// 新增 tab 的可选类型（点 + 后下拉菜单展示）
const ADD_OPTIONS: { type: TabType; label: string; icon: LucideIcon }[] = [
  { type: 'terminal', label: '终端', icon: SquareTerminal },
  { type: 'browser', label: '浏览器', icon: Globe },
  { type: 'review', label: '审查', icon: FileDiff },
  { type: 'file', label: '文件', icon: FileText }
]

export function TabBar() {
  const { state, dispatch } = useStore()
  const sessionId = state.activeSessionId
  const tabs = state.tabsBySession[sessionId] ?? []
  const activeTabId = state.activeTabIdBySession[sessionId] ?? null
  const [menuOpen, setMenuOpen] = useState(false)
  const fileTabRefs = useRef<Record<string, FileTabHandle | null>>({})
  const [confirmTabId, setConfirmTabId] = useState<string | null>(null)

  // 渲染所有已打开 tab（常驻 DOM，靠 display 切显隐）。
  // 关键：终端 tab 切换时不能卸载——否则 pty 进程被 kill、会话历史丢失。
  // 故所有 tab 常驻，非激活的 display:none，激活的撑满。FileTab 的 Monaco
  // 实例、TerminalTab 的 xterm+pty 因此在切 tab 时全部保留状态。
  const renderAllTabs = () => {
    if (tabs.length === 0) {
      return <div style={{ display: 'grid', placeItems: 'center', flex: 1, color: 'var(--text-muted)' }}>暂无打开的面板</div>
    }
    return tabs.map(t => {
      const isActive = t.id === activeTabId
      const wrapperStyle: CSSProperties = isActive
        ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }
        : { display: 'none' }
      let body: ReactNode = null
      if (t.type === 'file') {
        body = (
          <FileTab
            ref={(h: FileTabHandle | null) => { fileTabRefs.current[t.id] = h }}
            tabId={t.id}
            filePath={t.filePath}
          />
        )
      } else if (t.type === 'browser') {
        body = <BrowserTab />
      } else if (t.type === 'review') {
        body = <ReviewTab />
      } else {
        body = <TerminalTab tabId={t.id} cwd={t.cwd} />
      }
      return (
        <div key={t.id} style={wrapperStyle} data-active={isActive}>
          {body}
        </div>
      )
    })
  }

  // 终端 cwd：当前激活会话所属项目的 path，无则回退 settings.cwd
  const resolveTerminalCwd = (s: typeof state): string | undefined => {
    const project = s.projects.find(p => p.sessions.some(sess => sess.id === s.activeSessionId))
    return project?.path || s.settings.cwd || undefined
  }

  const addTab = (type: TabType) => {
    // terminal：优先落当前会话所属项目目录，回退全局 cwd
    const cwd = type === 'terminal' ? resolveTerminalCwd(state) : undefined
    dispatch({ type: 'OPEN_TAB', tabType: type, ...(cwd ? { cwd } : {}) })
    setMenuOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', minHeight: 36, alignItems: 'stretch', borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)', position: 'relative' }}>
        {/* tab 列表：可水平滚动，tab 不缩 */}
        <div style={{ display: 'flex', flex: 1, minWidth: 0, overflowX: 'auto' }} className="tab-scroll">
        {tabs.map(t => (
          <div
            key={t.id}
            onClick={() => dispatch({ type: 'SELECT_TAB', tabId: t.id })}
            style={{
              padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              borderBottom: activeTabId === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTabId === t.id ? 'var(--text)' : 'var(--text-muted)', fontSize: 13,
              maxWidth: 140, flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>{(() => { const Icon = TAB_ICON[t.type]; return <Icon size={14} />; })()}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            {state.dirtyTabIds[t.id] && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                const isDirty = !!state.dirtyTabIds[t.id]
                if (!isDirty) {
                  dispatch({ type: 'CLOSE_TAB', tabId: t.id })
                  return
                }
                setConfirmTabId(t.id)
              }}
              style={{ fontSize: 14, opacity: 0.6, lineHeight: 1 }}
              aria-label="关闭标签"
            >×</button>
          </div>
        ))}
        </div>
        {/* + 按钮：点击展开类型选择下拉菜单 */}
        <button onClick={() => setMenuOpen(o => !o)} title="新增 Tab" style={{ padding: '0 12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}><Plus size={16} /></button>
        {menuOpen && (
          <>
            {/* 点外部关闭 */}
            <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 100,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-float)', padding: 4, minWidth: 120
            }}>
              {ADD_OPTIONS.map(o => (
                <button
                  key={o.type}
                  onClick={() => addTab(o.type)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '7px 10px', cursor: 'pointer',
                    background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 13,
                    textAlign: 'left', borderRadius: 'var(--radius)'
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}><o.icon size={14} /></span>{o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
        {confirmTabId && (
          <>
            <div onClick={() => setConfirmTabId(null)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
            <div style={{
              position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-float)', padding: 14,
              display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220
            }}>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>该文件有未保存的改动，是否保存？</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { dispatch({ type: 'CLOSE_TAB', tabId: confirmTabId }); setConfirmTabId(null) }} style={btnStyle}>不保存</button>
                <button onClick={() => setConfirmTabId(null)} style={btnStyle}>取消</button>
                <button onClick={async () => {
                  const handle = fileTabRefs.current[confirmTabId]
                  const ok = handle ? await handle.save() : false
                  if (ok) {
                    dispatch({ type: 'CLOSE_TAB', tabId: confirmTabId })
                  }
                  setConfirmTabId(null)
                }} style={{ ...btnStyle, background: 'var(--accent)', color: '#fff', border: 'none' }}>保存</button>
              </div>
            </div>
          </>
        )}
      {renderAllTabs()}
    </div>
  )
}

const btnStyle: CSSProperties = {
  padding: '5px 12px', fontSize: 12, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 'var(--radius)'
}
