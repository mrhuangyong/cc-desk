import { useEffect, useState } from 'react'
import { Folder, File as FileIcon, ChevronRight, ChevronDown } from 'lucide-react'
import type { FileNode } from '../types'
import { fileKindOf } from './fileKind'

interface Props {
  cwd?: string
  currentFilePath?: string
  onOpenFile: (path: string) => void
}

// 读单层目录（沿用 FileTree.tsx 的 readLayer 模式：readTree 默认 depth=3，前端只渲染第一层）
async function readLayer(dirPath: string): Promise<FileNode[]> {
  const tree = await window.api?.fs.readTree(dirPath)
  return tree ?? []
}

function Node({ node, depth, currentFilePath, onOpenFile }: {
  node: FileNode; depth: number; currentFilePath?: string; onOpenFile: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && children === null) {
      setLoading(true)
      try {
        const layer = await readLayer(node.path)
        setChildren(layer)
      } catch { setChildren([]) }
      finally { setLoading(false) }
    }
  }

  const pad = { paddingLeft: 8 + depth * 14 }
  const isActive = !node.isDir && node.path === currentFilePath

  if (node.isDir) {
    return (
      <div>
        <div
          onClick={toggle}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', cursor: 'pointer', ...pad, color: 'var(--text)', borderRadius: 'var(--radius)' }}
          className="ft-row"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={14} />
          <span style={{ fontSize: 13 }}>{node.name}</span>
          {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>…</span>}
        </div>
        {open && children && children.length > 0 && (
          <div>
            {children.map(c => (
              <Node key={c.path} node={c} depth={depth + 1} currentFilePath={currentFilePath} onOpenFile={onOpenFile} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isBinary = fileKindOf(node.path) === 'binary'

  return (
    <div
      onClick={() => {
        if (isBinary) return                // 二进制：拦截，不触发 onOpenFile
        onOpenFile(node.path)
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', cursor: 'pointer', ...pad,
        color: 'var(--text)', borderRadius: 'var(--radius)',
        background: isActive ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      <span style={{ width: 13 }} />
      <FileIcon size={14} />
      <span style={{ fontSize: 13, color: isBinary ? 'var(--text-faint)' : 'var(--text)' }}>{node.name}</span>
    </div>
  )
}

export function FileExplorerPanel({ cwd, currentFilePath, onOpenFile }: Props) {
  const [tree, setTree] = useState<FileNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cwd) { setTree(null); return }
    let cancelled = false
    setLoading(true); setError(null)
    readLayer(cwd)
      .then(t => { if (!cancelled) setTree(t) })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cwd])

  if (!cwd) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>未选择工作区</div>
  }
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>
  }
  if (error) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>{error}</div>
  }
  if (!tree || tree.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>（空目录）</div>
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '4px 0' }}>
      {tree.map(n => (
        <Node key={n.path} node={n} depth={0} currentFilePath={currentFilePath} onOpenFile={onOpenFile} />
      ))}
    </div>
  )
}
