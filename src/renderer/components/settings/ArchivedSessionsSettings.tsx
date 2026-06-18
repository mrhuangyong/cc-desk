import type { Project } from '../../types'

interface Props {
  projects: Project[]
  dispatch: (action: any) => void
}

export function ArchivedSessionsSettings({ projects, dispatch }: Props) {
  const archived = projects.flatMap(p =>
    p.sessions.filter(s => s.archived).map(s => ({ session: s, project: p }))
  )

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>已归档会话</h2>
      {archived.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>暂无已归档会话</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {archived.map(({ session, project }) => (
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
                  {project.name}
                  {session.archivedAt ? ` · 归档于 ${new Date(session.archivedAt).toLocaleDateString()}` : ''}
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
      )}
    </div>
  )
}
