import { useState } from 'react'
import { Folder, FolderOpen, MessageCircle, FolderTree, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useStore } from '../state/store'
import { DeleteConfirmIcon } from './DeleteConfirmIcon'
import { formatSessionTime } from '../utils/formatSessionTime'

interface Props {
  onOpenFiles: (projectId: string) => void
  expandedProjects: Set<string>
  onToggleExpand: (projectId: string) => void
  treeFilter: string
}

const MAX_VISIBLE_SESSIONS = 5

export function ProjectTree({ onOpenFiles, expandedProjects, onToggleExpand, treeFilter }: Props) {
  const { state, dispatch } = useStore()
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)
  const [expandedSessionCounts, setExpandedSessionCounts] = useState<Set<string>>(new Set())

  const q = treeFilter.trim().toLowerCase()
  const activeSessionId = state.activeSessionId

  const toggleSessionExpand = (projectId: string) => {
    setExpandedSessionCounts(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {state.projects.map(project => {
        const filtered = q
          ? project.sessions.filter(s => s.title.toLowerCase().includes(q))
          : project.sessions
        if (q && filtered.length === 0) return null

        const sorted = [...filtered].sort((a, b) => {
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
        })

        const expanded = expandedProjects.has(project.id)
        const sessionExpanded = expandedSessionCounts.has(project.id)
        const total = sorted.length
        const visible = sessionExpanded ? sorted : sorted.slice(0, MAX_VISIBLE_SESSIONS)

        return (
          <div key={project.id}>
            <div
              onMouseEnter={() => setHoveredProject(project.id)}
              onMouseLeave={() => setHoveredProject(null)}
              onClick={() => onToggleExpand(project.id)}
              style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 'var(--font-size)', fontWeight: 550, color: 'var(--text)', cursor: 'pointer',
                background: hoveredProject === project.id ? 'var(--bg-hover)' : 'transparent'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                {expanded ? <FolderOpen size={14} /> : <Folder size={14} />} {project.name}
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button aria-label="新建会话" title="新建会话"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'ADD_SESSION', projectId: project.id }) }}
                  style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none', display: 'inline-flex', alignItems: 'center' }}><Plus size={13} /></button>
                <button aria-label="项目文件树" title="项目文件树"
                  onClick={(e) => { e.stopPropagation(); onOpenFiles(project.id) }}
                  style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none', display: 'inline-flex', alignItems: 'center' }}><FolderTree size={13} /></button>
                <span style={{ opacity: hoveredProject === project.id ? 1 : 0, pointerEvents: hoveredProject === project.id ? 'auto' : 'none', transition: 'opacity .1s' }} onClick={e => e.stopPropagation()}>
                  <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_PROJECT', projectId: project.id })} />
                </span>
              </span>
            </div>
            {expanded && visible.map(session => {
              const active = activeSessionId === session.id
              const hovered = hoveredSession === session.id
              return (
              <div
                key={session.id}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: session.id })}
                style={{
                  position: 'relative',
                  padding: '6px 12px 6px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 'var(--font-size)',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  background: active || hovered ? 'var(--bg-hover)' : 'transparent',
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer'
                }}
              >
                {active && <span data-testid="session-active-bar" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--accent)' }} />}
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'var(--accent)' : 'transparent', flexShrink: 0 }} />
                  <MessageCircle size={13} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
                </span>
                <span style={{ position: 'relative', minWidth: 40, display: 'inline-flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                  <span data-testid="session-time" style={{ fontSize: 11, color: 'var(--text-muted)', opacity: hovered ? 0 : 1, transition: 'opacity .15s' }}>
                    {formatSessionTime(session.updatedAt ?? 0)}
                  </span>
                  <span style={{
                    position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                    opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .15s',
                  }}>
                    <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })} />
                  </span>
                </span>
              </div>
              )
            })}
            {expanded && total > MAX_VISIBLE_SESSIONS && (
              <div
                onClick={(e) => { e.stopPropagation(); toggleSessionExpand(project.id) }}
                style={{
                  padding: '4px 12px 4px 30px', fontSize: 11, color: 'var(--text-muted)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                {sessionExpanded ? '收起' : `+ 展开更多 (${total - MAX_VISIBLE_SESSIONS})`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
