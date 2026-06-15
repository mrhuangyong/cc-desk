import { useState } from 'react'
import { useStore } from '../state/store'
import { DeleteConfirmIcon } from './DeleteConfirmIcon'

export function ProjectTree({ onOpenFiles }: { onOpenFiles: (projectId: string) => void }) {
  const { state, dispatch } = useStore()
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {state.projects.map(project => (
        <div key={project.id}>
          <div
            onMouseEnter={() => setHoveredProject(project.id)}
            onMouseLeave={() => setHoveredProject(null)}
            style={{
              padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontWeight: 600, color: 'var(--text)', background: hoveredProject === project.id ? 'var(--bg-hover)' : 'transparent'
            }}
          >
            <span>📁 {project.name}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button aria-label="项目文件树" title="项目文件树" onClick={() => onOpenFiles(project.id)}
                style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none' }}>📂</button>
              <button aria-label="新增会话" title="新增会话" onClick={() => dispatch({ type: 'ADD_SESSION', projectId: project.id })}
                style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none' }}>➕</button>
              <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_PROJECT', projectId: project.id })} />
            </span>
          </div>
          {project.sessions.map(session => (
            <div
              key={session.id}
              onMouseEnter={() => setHoveredSession(session.id)}
              onMouseLeave={() => setHoveredSession(null)}
              onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: session.id })}
              style={{
                padding: '6px 12px 6px 28px', display: 'flex', justifyContent: 'space-between',
                color: state.activeSessionId === session.id ? 'var(--accent)' : 'var(--text-muted)',
                background: hoveredSession === session.id ? 'var(--bg-hover)' : 'transparent',
                cursor: 'pointer'
              }}
            >
              <span>💬 {session.title}</span>
              <span style={{ opacity: hoveredSession === session.id ? 1 : 0, pointerEvents: hoveredSession === session.id ? 'auto' : 'none' }}>
                <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })} />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
