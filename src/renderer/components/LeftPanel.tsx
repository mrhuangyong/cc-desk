import { useState } from 'react'
import { ProjectTree } from './ProjectTree'
import { FileTree } from './FileTree'

interface Props {
  collapsed: boolean
  onExpand: () => void
}

export function LeftPanel({ collapsed, onExpand }: Props) {
  const [fileViewProjectId, setFileViewProjectId] = useState<string | null>(null)

  if (collapsed) {
    // 收起态：窄竖条，仅一个展开按钮（图标宽度）
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
