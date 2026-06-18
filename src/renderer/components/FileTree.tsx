import { useEffect, useState } from 'react'
import { ArrowLeft, Folder, FolderOpen, FileText } from 'lucide-react'
import { useStore } from '../state/store'
import type { FileNode } from '../types'

// 读单层目录（depth=1）。目录树按需展开——用户点开某目录时才读它的直接子节点，
// 不依赖 readTree 预读的 depth=3，可下钻到任意层级。
async function readLayer(dirPath: string): Promise<FileNode[]> {
  // readTree 默认 depth=3，但只取第一层 children 即可；空目录返回 []
  const tree = await (window as any).api.fs.readTree(dirPath)
  return tree ?? []
}

function Node({ node, depth }: { node: FileNode; depth: number }) {
  const { dispatch } = useStore()
  const [open, setOpen] = useState(depth === 0)
  const [hovered, setHovered] = useState(false)
  // 按需加载的子节点：首次展开时读取，避免受 readTree depth=3 限制
  const [children, setChildren] = useState<FileNode[] | null>(
    // 顶层节点的 children 已由父级 readTree 读出（depth=3 内），直接复用避免重复请求
    node.children ?? null
  )
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const willOpen = !open
    setOpen(willOpen)
    // 首次展开且尚未加载子节点 → 按需读取
    if (willOpen && children === null) {
      setLoading(true)
      try {
        const layer = await readLayer(node.path)
        setChildren(layer)
      } catch { setChildren([]) }
      finally { setLoading(false) }
    }
  }

  const hoverBg = hovered ? 'var(--bg-hover)' : 'transparent'
  if (node.isDir) {
    return (
      <div>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={toggle}
          style={{ padding: '5px 12px', paddingLeft: 12 + depth * 16, cursor: 'pointer', color: 'var(--text)', background: hoverBg, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {open ? <FolderOpen size={14} /> : <Folder size={14} />} {node.name}
          {loading && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>…</span>}
        </div>
        {open && children?.map(c => <Node key={c.path} node={c} depth={depth + 1} />)}
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
  const cwd = project?.path || state.settings?.cwd

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
