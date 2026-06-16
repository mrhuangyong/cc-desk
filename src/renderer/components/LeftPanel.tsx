import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ProjectTree } from './ProjectTree'
import { FileTree } from './FileTree'
import { SearchDialog } from './SearchDialog'
import { useStore } from '../state/store'

interface Props {
  collapsed: boolean
  onExpand: () => void
}

export function LeftPanel({ collapsed, onExpand }: Props) {
  const { state, dispatch } = useStore()
  const [fileViewProjectId, setFileViewProjectId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  // 默认全部项目展开
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(state.projects.map(p => p.id))
  )

  // 当前激活会话所属项目（顶部"新建会话"的目标）；无则取第一个项目兜底
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

  // 一键展开/折叠所有：有任一收起则全部展开，否则全部收起
  const toggleAll = () => {
    const allExpanded = state.projects.every(p => expandedProjects.has(p.id))
    setExpandedProjects(allExpanded ? new Set() : new Set(state.projects.map(p => p.id)))
  }

  const handleNewSession = () => {
    if (currentProjectId) dispatch({ type: 'ADD_SESSION', projectId: currentProjectId })
  }

  if (collapsed) {
    return (
      <button
        onClick={onExpand}
        title="展开左栏"
        aria-label="展开左栏"
        style={{
          width: 32, flexShrink: 0, background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)', color: 'var(--text-muted)',
          fontSize: 14, cursor: 'pointer'
        }}
      >»</button>
    )
  }

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
      <div style={{
        width: 240, flexShrink: 0, background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
      }}>
        {/* 顶部功能区：纵向单列堆叠 */}
        <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
          <button onMouseEnter={() => setHovered('new')} onMouseLeave={() => setHovered(null)} onClick={handleNewSession} title="新建会话" style={topBtn('new')}>➕ 新建会话</button>
          <button onMouseEnter={() => setHovered('search')} onMouseLeave={() => setHovered(null)} onClick={() => setSearchOpen(true)} title="搜索" style={topBtn('search')}>🔍 搜索</button>
          <button onMouseEnter={() => setHovered('skills')} onMouseLeave={() => setHovered(null)} onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'skills' })} title="技能" style={topBtn('skills')}>⚡ 技能</button>
        </div>

        {/* 工作区行：标题 + 三按钮同一行 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
          borderBottom: '1px solid var(--border)'
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginRight: 'auto' }}>工作区</span>
          <button onMouseEnter={() => setHovered('toggleAll')} onMouseLeave={() => setHovered(null)} onClick={toggleAll} title="展开/折叠" aria-label="展开/折叠" style={toolBtn('toggleAll')}>⇕</button>
          <button onMouseEnter={() => setHovered('sort')} onMouseLeave={() => setHovered(null)} title="排序/筛选" aria-label="排序/筛选" style={toolBtn('sort')}>↕</button>
          <button onMouseEnter={() => setHovered('search2')} onMouseLeave={() => setHovered(null)} onClick={() => setSearchOpen(true)} title="搜索" aria-label="搜索" style={toolBtn('search2')}>🔍</button>
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
