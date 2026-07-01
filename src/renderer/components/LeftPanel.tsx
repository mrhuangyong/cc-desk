import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Plus, Search, Zap, ChevronsUpDown, ChevronsDownUp, ArrowUpDown, FolderPlus, Settings, Check } from 'lucide-react'
import { ProjectTree } from './ProjectTree'
import { FileTree } from './FileTree'
import { Tooltip } from './Tooltip'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { useResizableWidth } from '../hooks/useResizableWidth'
import { usePanelAnimation } from '../hooks/usePanelAnimation'
import { getPanelContentLockWidth } from './RightPanel'

interface Props {
  collapsed: boolean
  onOpenSearch: () => void
}

export function LeftPanel({ collapsed, onOpenSearch }: Props) {
  const { state, dispatch } = useStore()
  const { t } = useI18n()
  const [fileViewProjectId, setFileViewProjectId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(state.projects.map(p => p.id))
  )
  // 记录用户已明确折叠过的项目 id，区分「从没见过的新项目」与「被主动折叠的旧项目」
  const [collapsedByUser, setCollapsedByUser] = useState<Set<string>>(() => new Set())

  // 排序/筛选
  type SortMode = 'recent' | 'created' | 'title'
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [showArchived, setShowArchived] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  // 项目数据异步 HYDRATE 进来后，把新到达的项目默认展开；
  // collapsedByUser 里的项目保持折叠，不被反复 HYDRATE 覆盖。
  useEffect(() => {
    setExpandedProjects(prev => {
      const known = new Set(prev)
      let changed = false
      for (const p of state.projects) {
        if (!known.has(p.id) && !collapsedByUser.has(p.id)) { known.add(p.id); changed = true }
      }
      return changed ? known : prev
    })
  }, [state.projects, collapsedByUser])

  const { width, dragging, onPointerDown, registerApply } = useResizableWidth({
    initial: 240,
    min: 180,
    max: Math.round(window.innerWidth * 0.5),
    side: 'right'
  })

  const { mounted, animating, originalWidthRef, styles: animStyles, onTransitionEnd } = usePanelAnimation(collapsed)

  const panelRef = useRef<HTMLDivElement>(null)
  const refCallback = useCallback((node: HTMLDivElement | null) => {
    (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node
    if (node) registerApply((w: number) => { node.style.width = `${w}px` })
  }, [registerApply])

  const currentProjectId = useMemo(() => {
    const active = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
    return (active ?? state.projects[0])?.id
  }, [state.projects, state.activeSessionId])

  const toggleExpand = (pid: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev)
      const collapsing = next.has(pid)
      if (collapsing) next.delete(pid)
      else next.add(pid)
      // 同步记录用户折叠意图，避免后续 HYDRATE 把它重新展开
      setCollapsedByUser(prevCol => {
        const nextCol = new Set(prevCol)
        if (collapsing) nextCol.add(pid)
        else nextCol.delete(pid)
        return nextCol
      })
      return next
    })
  }

  const toggleAll = () => {
    const allExpanded = state.projects.every(p => expandedProjects.has(p.id))
    if (allExpanded) {
      setExpandedProjects(new Set())
      setCollapsedByUser(new Set(state.projects.map(p => p.id)))
    } else {
      setExpandedProjects(new Set(state.projects.map(p => p.id)))
      setCollapsedByUser(new Set())
    }
  }

  // 全部展开时图标切换为「折叠」态，tooltip 也跟着变
  const allExpanded = state.projects.length > 0 && state.projects.every(p => expandedProjects.has(p.id))

  const handleNewSession = () => {
    if (currentProjectId) dispatch({ type: 'ADD_SESSION', projectId: currentProjectId })
  }

  const handleAddProject = async () => {
    const dirPath = await window.api?.dialog.openDirectory()
    if (!dirPath) return
    const name = dirPath.split('/').pop() || dirPath
    dispatch({ type: 'ADD_PROJECT', name, path: dirPath })
  }

  if (!mounted) return null

  const topBtn = (key: string): CSSProperties => ({
    width: '100%', padding: '8px 12px', fontSize: 13, color: 'var(--text)',
    background: hovered === key ? 'var(--bg-hover)' : 'transparent',
    border: 'none', cursor: 'pointer',
    textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8,
    transition: 'background .1s'
  })
  const toolBtn = (key: string): CSSProperties => ({
    padding: '2px 6px', fontSize: 13, color: 'var(--text-muted)',
    background: hovered === key ? 'var(--bg-hover)' : 'transparent',
    border: 'none', cursor: 'pointer',
    borderRadius: 'var(--radius)', lineHeight: 1,
    transition: 'background .1s'
  })
  // 动画开始时锁定原始宽度，防止内容换行
  if (animating && originalWidthRef.current === 0) {
    originalWidthRef.current = width
  }
  if (!animating) {
    originalWidthRef.current = 0
  }

  return (
    <>
      <div
        ref={refCallback}
        onTransitionEnd={onTransitionEnd}
        style={{
          width, flexShrink: 0, position: 'relative', background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
          ...animStyles,
          // 拖动时禁用 width 过渡（animStyles 的 expanded 态带 .25s 缓动，会拖住实时拖拽导致不跟手）；
          // 展开折叠动画不受影响
          transition: dragging ? 'none' : animStyles.transition,
        }}
      >
        {/* 拖拽手柄：右边缘竖条（动画期间禁用） */}
        {!collapsed && (
          <div
            onPointerDown={onPointerDown}
            title="拖动调节宽度"
            style={{
              position: 'absolute', right: -3, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize', zIndex: 10,
              background: dragging ? 'var(--accent)' : 'transparent',
              transition: dragging ? 'none' : 'background .15s'
            }}
          />
        )}
        {/* 内层 wrapper：动画期间固定原始宽度，外层 overflow:hidden 裁剪 */}
        <div style={{
          display: 'flex', flexDirection: 'column', flex: 1,
          width: getPanelContentLockWidth({ animating, dragging, originalWidth: originalWidthRef.current }),
          overflow: 'hidden',
        }}>
          {/* 顶部功能区：新建会话/搜索/技能各独占一行 */}
          <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
            <button onMouseEnter={() => setHovered('new')} onMouseLeave={() => setHovered(null)} onClick={handleNewSession} title={t('left.newSession')} style={topBtn('new')}><Plus size={14} /> {t('left.newSession')}</button>
            <button onMouseEnter={() => setHovered('search')} onMouseLeave={() => setHovered(null)} onClick={onOpenSearch} title={t('left.search')} style={topBtn('search')}><Search size={14} /> {t('left.search')}</button>
            <button onMouseEnter={() => setHovered('skills')} onMouseLeave={() => setHovered(null)} onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'skills' })} title={t('left.skills')} style={topBtn('skills')}><Zap size={14} /> {t('left.skills')}</button>
          </div>

          {/* 工作区行 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
            borderBottom: '1px solid var(--border)'
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginRight: 'auto' }}>工作区</span>
            <Tooltip label={t('left.addProject')}><button onMouseEnter={() => setHovered('addProject')} onMouseLeave={() => setHovered(null)} onClick={handleAddProject} aria-label={t('left.addProject')} style={toolBtn('addProject')}><FolderPlus size={13} /></button></Tooltip>
            <Tooltip label={allExpanded ? t('left.collapseAll') : t('left.expandAll')}><button onMouseEnter={() => setHovered('toggleAll')} onMouseLeave={() => setHovered(null)} onClick={toggleAll} aria-label={allExpanded ? t('left.collapseAll') : t('left.expandAll')} style={toolBtn('toggleAll')}>{allExpanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}</button></Tooltip>
            <div style={{ position: 'relative' }}>
              <button onMouseEnter={() => setHovered('sort')} onMouseLeave={() => setHovered(null)} onClick={() => setSortMenuOpen(o => !o)} aria-label={t('left.sortFilter')} style={{ ...toolBtn('sort'), color: sortMenuOpen || sortMode !== 'recent' || showArchived ? 'var(--text)' : undefined, background: sortMenuOpen ? 'var(--bg-hover)' : undefined }}><ArrowUpDown size={13} /></button>
              {sortMenuOpen && (
                <>
                  <div onClick={() => setSortMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
                  <div style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 100,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: 8, boxShadow: 'var(--shadow-float)', padding: 4, minWidth: 170,
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px' }}>{t('left.sortBy')}</div>
                    {([
                      { key: 'recent', label: t('left.sortRecent') },
                      { key: 'created', label: t('left.sortCreated') },
                      { key: 'title', label: t('left.sortTitle') },
                    ] as { key: SortMode; label: string }[]).map(opt => (
                      <button key={opt.key} onClick={() => { setSortMode(opt.key); setSortMenuOpen(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                          padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: sortMode === opt.key ? 'var(--bg-hover)' : 'transparent',
                          color: 'var(--text)', fontSize: 12, textAlign: 'left', transition: 'background .1s',
                        }}
                        onMouseEnter={(e) => { if (sortMode !== opt.key) e.currentTarget.style.background = 'var(--bg-hover)' }}
                        onMouseLeave={(e) => { if (sortMode !== opt.key) e.currentTarget.style.background = 'transparent' }}
                      >
                        <span style={{ flex: 1 }}>{opt.label}</span>
                        {sortMode === opt.key && <Check size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                      </button>
                    ))}
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <button onClick={() => setShowArchived(v => !v)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: 'transparent', color: 'var(--text)', fontSize: 12, textAlign: 'left', transition: 'background .1s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ flex: 1 }}>{t('left.showArchived')}</span>
                      <span style={{
                        width: 28, height: 16, borderRadius: 8, flexShrink: 0, position: 'relative', transition: 'background .15s',
                        background: showArchived ? 'var(--accent)' : 'var(--border)',
                      }}>
                        <span style={{
                          position: 'absolute', top: 2, left: showArchived ? 14 : 2, width: 12, height: 12,
                          borderRadius: '50%', background: '#fff', transition: 'left .15s',
                        }} />
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 项目会话树 / 文件树 */}
          {fileViewProjectId ? (
            <FileTree projectId={fileViewProjectId} onBack={() => setFileViewProjectId(null)} />
          ) : (
            <ProjectTree
              onOpenFiles={(pid) => setFileViewProjectId(pid)}
              expandedProjects={expandedProjects}
              onToggleExpand={toggleExpand}
              treeFilter=""
              sortMode={sortMode}
              showArchived={showArchived}
            />
          )}

          {/* 底部：设置入口，顶到面板最下方 */}
          <button
            onMouseEnter={() => setHovered('settings')} onMouseLeave={() => setHovered(null)}
            onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })}
            title={t('title.settings')}
            style={{ ...topBtn('settings'), marginTop: 'auto', borderTop: '1px solid var(--border)' }}
          >
            <Settings size={14} /> {t('title.settings')}
          </button>
        </div>
      </div>

    </>
  )
}
