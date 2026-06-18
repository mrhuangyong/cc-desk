import type { Project } from '../../types'

interface Props {
  projects: Project[]
  dispatch: (action: any) => void
}

export function ArchivedSessionsSettings({ projects, dispatch }: Props) {
  // 按项目分组：只含有已归档会话的项目
  const groups = projects
    .map(p => ({ project: p, sessions: p.sessions.filter(s => s.archived) }))
    .filter(g => g.sessions.length > 0)
  const total = groups.reduce((n, g) => n + g.sessions.length, 0)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>已归档会话</h2>
      {total === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>暂无已归档会话</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {groups.map(({ project, sessions }) => (
            <div key={project.id}>
              <div style={{
                color: 'var(--text-faint)', fontSize: 11, textTransform: 'uppercase',
                letterSpacing: 1, marginBottom: 8, padding: '0 4px',
              }}>
                {project.name} · {sessions.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sessions.map(session => (
                  <div key={session.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 8,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.title || '(无标题)'}
                      </div>
                      <div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 2 }}>
                        {session.archivedAt ? `归档于 ${new Date(session.archivedAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <button onClick={() => dispatch({ type: 'RESTORE_SESSION', sessionId: session.id })}
                      style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 12 }}>
                      还原
                    </button>
                    <button onClick={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })}
                      style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: '#ff3b30', fontSize: 12 }}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
