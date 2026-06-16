import { useState } from 'react'
import { Folder, FolderOpen, MessageCircle, FolderTree, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useStore } from '../state/store'
import { DeleteConfirmIcon } from './DeleteConfirmIcon'

interface Props {
  onOpenFiles: (projectId: string) => void
  // 展开的项目 id 集合（未在其中视为收起）
  expandedProjects: Set<string>
  onToggleExpand: (projectId: string) => void
  // 会话过滤关键词（按标题匹配，空则不过滤）
  treeFilter: string
}

export function ProjectTree({ onOpenFiles, expandedProjects, onToggleExpand, treeFilter }: Props) {
  const { state, dispatch } = useStore()
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)

  const q = treeFilter.trim().toLowerCase()

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {state.projects.map(project => {
        // 过滤：有关键词时，只保留标题匹配的会话；项目无匹配会话则隐藏整个项目
        const visibleSessions = q
          ? project.sessions.filter(s => s.title.toLowerCase().includes(q))
          : project.sessions
        if (q && visibleSessions.length === 0) return null

        const expanded = expandedProjects.has(project.id)

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
            {expanded && visibleSessions.map(session => {
              const active = state.activeSessionId === session.id
              return (
              <div
                key={session.id}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: session.id })}
                style={{
                  padding: '6px 12px 6px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 'var(--font-size)',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  background: active || hoveredSession === session.id ? 'var(--bg-hover)' : 'transparent',
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'var(--accent)' : 'transparent', flexShrink: 0 }} />
                  <MessageCircle size={13} /> {session.title}
                </span>
                <span style={{ opacity: hoveredSession === session.id ? 1 : 0, pointerEvents: hoveredSession === session.id ? 'auto' : 'none' }}>
                  <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })} />
                </span>
              </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
