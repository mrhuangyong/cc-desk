import { useEffect, useState } from 'react'
import { ArrowLeft, Folder, FolderOpen, FileText } from 'lucide-react'
import { useStore } from '../state/store'
import type { FileNode } from '../types'

function Node({ node, depth }: { node: FileNode; depth: number }) {
  const { dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  const hoverBg = hovered ? 'var(--bg-hover)' : 'transparent'
  if (node.isDir) {
    return (
      <div>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => setOpen(o => !o)}
          style={{ padding: '5px 12px', paddingLeft: 12 + depth * 16, cursor: 'pointer', color: 'var(--text)', background: hoverBg, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {open ? <FolderOpen size={14} /> : <Folder size={14} />} {node.name}
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
      style={{ padding: '4px 12px', paddingLeft: 12 + depth * 16, cursor: 'pointer', color: 'var(--text-muted)', background: hoverBg, display: 'flex', alignItems: 'center', gap: 4 }}
    >
      <FileText size={14} /> {node.name}
    </div>
  )
}

export function FileTree({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { state } = useStore()
  const [hovered, setHovered] = useState(false)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const project = state.projects.find(p => p.id === projectId)
  const cwd = state.settings?.cwd

  useEffect(() => {
    if (!cwd) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api?.fs.readTree(cwd)
      .then(tree => { if (!cancelled) setFileTree(tree) })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cwd])

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <button onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onBack} style={{ padding: '10px 12px', color: 'var(--text-muted)', background: hovered ? 'var(--bg-hover)' : 'transparent', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border)', width: '100%', cursor: 'pointer' }}>
        <ArrowLeft size={14} /> {project?.name}
      </button>
      {loading && (
        <div style={{ padding: '12px', color: 'var(--text-muted)' }}>加载中…</div>
      )}
      {error && (
        <div style={{ padding: '12px', color: '#d33' }}>读取目录失败：{error}</div>
      )}
      {!loading && !error && fileTree.length === 0 && (
        <div style={{ padding: '12px', color: 'var(--text-muted)' }}>
          {cwd ? '空目录' : '未设置工作目录（cwd）'}
        </div>
      )}
      {fileTree.map(n => <Node key={n.path} node={n} depth={0} />)}
    </div>
  )
}
