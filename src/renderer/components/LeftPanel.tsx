import { useState } from 'react'
import { ProjectTree } from './ProjectTree'
import { FileTree } from './FileTree'

export function LeftPanel() {
  const [fileViewProjectId, setFileViewProjectId] = useState<string | null>(null)

  return (
    <div style={{
      width: 240, flexShrink: 0, background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
    }}>
      {fileViewProjectId ? (
        <FileTree projectId={fileViewProjectId} onBack={() => setFileViewProjectId(null)} />
      ) : (
        <ProjectTree onOpenFiles={(pid) => setFileViewProjectId(pid)} />
      )}
    </div>
  )
}
