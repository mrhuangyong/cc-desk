import { useMemo, useState, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Plus, Search, Zap, ChevronsUpDown, ArrowUpDown } from 'lucide-react'
import { ProjectTree } from './ProjectTree'
import { FileTree } from './FileTree'
import { SearchDialog } from './SearchDialog'
import { useStore } from '../state/store'
import { useResizableWidth } from '../hooks/useResizableWidth'

interface Props {
  collapsed: boolean
}

export function LeftPanel({ collapsed }: Props) {
  const { state, dispatch } = useStore()
  const [fileViewProjectId, setFileViewProjectId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(state.projects.map(p => p.id))
  )

  const { width, dragging, onMouseDown, registerApply } = useResizableWidth({
    initial: 240,
    min: Math.round(window.innerWidth * 0.5),
    max: Math.round(window.innerWidth * 0.8),
    side: 'right'
  })

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

  if (collapsed) return null

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

  return (
    <>
      <div
        ref={refCallback}
        style={{
          width, flexShrink: 0, position: 'relative', background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
        }}
      >
        {/* 拖拽手柄：右边缘竖条 */}
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
        {/* 顶部功能区 */}
        <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
          <button onMouseEnter={() => setHovered('new')} onMouseLeave={() => setHovered(null)} onClick={handleNewSession} title="新建会话" style={topBtn('new')}><Plus size={14} /> 新建会话</button>
          <button onMouseEnter={() => setHovered('search')} onMouseLeave={() => setHovered(null)} onClick={() => setSearchOpen(true)} title="搜索" style={topBtn('search')}><Search size={14} /> 搜索</button>
          <button onMouseEnter={() => setHovered('skills')} onMouseLeave={() => setHovered(null)} onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'skills' })} title="技能" style={topBtn('skills')}><Zap size={14} /> 技能</button>
        </div>

        {/* 工作区行 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
          borderBottom: '1px solid var(--border)'
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginRight: 'auto' }}>工作区</span>
          <button onMouseEnter={() => setHovered('toggleAll')} onMouseLeave={() => setHovered(null)} onClick={toggleAll} title="展开/折叠" aria-label="展开/折叠" style={toolBtn('toggleAll')}><ChevronsUpDown size={13} /></button>
          <button onMouseEnter={() => setHovered('sort')} onMouseLeave={() => setHovered(null)} title="排序/筛选" aria-label="排序/筛选" style={toolBtn('sort')}><ArrowUpDown size={13} /></button>
          <button onMouseEnter={() => setHovered('search2')} onMouseLeave={() => setHovered(null)} onClick={() => setSearchOpen(true)} title="搜索" aria-label="搜索" style={toolBtn('search2')}><Search size={13} /></button>
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
      </div>

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </>
  )
}
