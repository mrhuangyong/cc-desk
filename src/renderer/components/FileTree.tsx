import { useState } from 'react'
import { useStore } from '../state/store'
import { mockFileTrees } from '../state/mockData'
import type { FileNode } from '../types'

function Node({ node, depth }: { node: FileNode; depth: number }) {
  const { dispatch } = useStore()
  const [open, setOpen] = useState(depth === 0)
  const [hovered, setHovered] = useState(false)

  const hoverBg = hovered ? 'var(--bg-hover)' : 'transparent'
  if (node.isDir) {
    return (
      <div>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => setOpen(o => !o)}
          style={{ padding: '5px 12px', paddingLeft: 12 + depth * 16, cursor: 'pointer', color: 'var(--text)', background: hoverBg }}
        >
          {open ? '📂' : '📁'} {node.name}
        </div>
        {open && node.children?.map(c => <Node key={c.path} node={c} depth={depth + 1} />)}
      </div>
    )
  }
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => dispatch({ type: 'OPEN_FILE_TAB', filePath: node.path, fileName: node.name })}
      style={{ padding: '4px 12px', paddingLeft: 12 + depth * 16, cursor: 'pointer', color: 'var(--text-muted)', background: hoverBg }}
    >
      📄 {node.name}
    </div>
  )
}

export function FileTree({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { state } = useStore()
  const [hovered, setHovered] = useState(false)
  const project = state.projects.find(p => p.id === projectId)
  const nodes = mockFileTrees[projectId] ?? []
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <button onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onBack} style={{ padding: '10px 12px', color: 'var(--text-muted)', background: hovered ? 'var(--bg-hover)' : 'transparent', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border)', width: '100%', cursor: 'pointer' }}>
        ← {project?.name}
      </button>
      {nodes.map(n => <Node key={n.path} node={n} depth={0} />)}
    </div>
  )
}
