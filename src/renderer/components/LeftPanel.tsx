import { useMemo, useState, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Plus, Search, Zap, ChevronsUpDown, ArrowUpDown, FolderPlus, Settings } from 'lucide-react'
import { ProjectTree } from './ProjectTree'
import { FileTree } from './FileTree'
import { Tooltip } from './Tooltip'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { useResizableWidth } from '../hooks/useResizableWidth'
import { usePanelAnimation } from '../hooks/usePanelAnimation'

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

  const { width, dragging, onMouseDown, registerApply } = useResizableWidth({
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
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  const toggleAll = () => {
    const allExpanded = state.projects.every(p => expandedProjects.has(p.id))
    setExpandedProjects(allExpanded ? new Set() : new Set(state.projects.map(p => p.id)))
  }

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
            onMouseDown={onMouseDown}
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
          width: animating ? originalWidthRef.current : undefined,
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
            <Tooltip label={t('left.addProject')}><button onMouseEnter={() => setHovered('addProject')} onMouseLeave={() => setHovered(null)} onClick={handleAddProject} title={t('left.addProject')} aria-label={t('left.addProject')} style={toolBtn('addProject')}><FolderPlus size={13} /></button></Tooltip>
            <Tooltip label="展开/折叠"><button onMouseEnter={() => setHovered('toggleAll')} onMouseLeave={() => setHovered(null)} onClick={toggleAll} title="展开/折叠" aria-label="展开/折叠" style={toolBtn('toggleAll')}><ChevronsUpDown size={13} /></button></Tooltip>
            <Tooltip label="排序/筛选"><button onMouseEnter={() => setHovered('sort')} onMouseLeave={() => setHovered(null)} title="排序/筛选" aria-label="排序/筛选" style={toolBtn('sort')}><ArrowUpDown size={13} /></button></Tooltip>
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
