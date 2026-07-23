import { useState, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { FileText, Globe, SquareTerminal, FileDiff, Plus, X } from 'lucide-react'
import { useStore } from '../state/store'
import { Tooltip } from './Tooltip'
import { resolveTerminalCwd } from '../utils/terminal'
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
  const addBtnRef = useRef<HTMLButtonElement | null>(null)
  // + 按钮的视口坐标（点击时取）。菜单用 portal 渲染到 body（在内容区 zoom 之外），
  // fixed 定位相对真实视口，与 getBoundingClientRect 坐标系一致，不受 zoom 扭曲。
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  // 渲染所有已打开 tab（常驻 DOM，靠 display 切显隐）。
  // 关键：终端 tab 切换时不能卸载——否则 pty 进程被 kill、会话历史丢失。
  // 故所有 tab 常驻，非激活的 display:none，激活的撑满。FileTab 的 Monaco
  // 实例、TerminalTab 的 xterm+pty 因此在切 tab 时全部保留状态。
  const renderAllTabs = () => {
    if (tabs.length === 0) {
      return (
        <div style={{
          display: 'grid', flex: 1, justifyContent: 'center',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 150px))',
          gap: 8, padding: 10, alignContent: 'center',
        }}>
          {ADD_OPTIONS.map(o => {
            const Icon = o.icon
            return (
              <button
                key={o.type}
                onClick={() => addTab(o.type)}
                style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '24px 16px', cursor: 'pointer',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius)',
                  transition: 'border-color .15s, background .15s, transform .1s',
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-hover)'; const bar = e.currentTarget.querySelector<HTMLElement>('[data-accent-bar]'); if (bar) bar.style.transform = 'scaleX(1)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)'; const bar = e.currentTarget.querySelector<HTMLElement>('[data-accent-bar]'); if (bar) bar.style.transform = 'scaleX(0)' }}
              >
                <span
                  data-accent-bar
                  style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: 'var(--accent)', transform: 'scaleX(0)', transformOrigin: 'left',
                    transition: 'transform .15s ease',
                  }}
                />
                <Icon size={20} />
                {o.label}
              </button>
            )
          })}
        </div>
      )
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
        body = <BrowserTab tabId={t.id} initialUrl={t.url} />
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

  const addTab = (type: TabType) => {
    // terminal：优先落当前会话所属项目目录，回退全局 cwd
    const cwd = type === 'terminal' ? resolveTerminalCwd(state) : undefined
    dispatch({ type: 'OPEN_TAB', tabType: type, ...(cwd ? { cwd } : {}) })
    setMenuOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
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
            <Tooltip label="关闭标签">
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
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: 4, lineHeight: 1, border: 'none',
                color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer',
                opacity: 0.5, transition: 'opacity .12s, background .12s',
              }}
              aria-label="关闭标签"
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.background = 'transparent' }}
            ><X size={12} /></button>
            </Tooltip>
          </div>
        ))}
        {/* + 按钮：在可滚动 tab 列表内，紧跟 tabs，随 tab 一起滚动 */}
        <Tooltip label="新增 Tab">
        <button
          ref={addBtnRef}
          onClick={() => {
            const r = addBtnRef.current?.getBoundingClientRect()
            setMenuPos(r ? { top: r.bottom + 2, left: r.left } : null)
            setMenuOpen(o => !o)
          }}
          style={{ padding: '0 12px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
        ><Plus size={16} /></button>
        </Tooltip>
        </div>
        {menuOpen && menuPos && createPortal(
          <>
            {/* 点外部关闭 */}
            <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
            <div style={{
              position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 100,
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
          </>,
          document.body
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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
        {renderAllTabs()}
      </div>
    </div>
  )
}

const btnStyle: CSSProperties = {
  padding: '5px 12px', fontSize: 12, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 'var(--radius)'
}
