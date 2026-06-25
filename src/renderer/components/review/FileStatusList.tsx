// 审查 tab：左侧改动文件列表。每行复选框（勾选=已暂存）+ 状态色块 + 文件名。
// 勾选/取消勾选 → 触发 onToggleStage(path, currentlyStaged)。
import type { GitFileStatus, GitChangeKind } from '../../types'

const STATUS_COLOR: Record<GitChangeKind, string> = {
  modified: '#d29922',
  added: '#3fb950',
  deleted: '#f85149',
  renamed: '#58a6ff',
  untracked: 'var(--text-muted)',
  conflicted: '#f85149',
}
const STATUS_LABEL: Record<GitChangeKind, string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?', conflicted: 'U',
}

interface Props {
  status: GitFileStatus[]
  selectedPath: string | null
  loading: boolean
  onSelect: (path: string) => void
  onToggleStage: (path: string, currentlyStaged: boolean) => void
}

export function FileStatusList({ status, selectedPath, loading, onSelect, onToggleStage }: Props) {
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
  }
  if (status.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>无改动</div>
  }
  return (
    <div style={{ overflowY: 'auto' }}>
      {status.map(f => {
        // 派生 staged/unstaged：untracked 不算已暂存（需先 add）
        const staged = f.indexStatus !== null && f.indexStatus !== 'untracked'
        const kind: GitChangeKind = f.indexStatus ?? f.workdirStatus ?? 'modified'
        const isSelected = f.path === selectedPath
        return (
          <div
            key={f.path}
            onClick={() => onSelect(f.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', cursor: 'pointer',
              background: isSelected ? 'var(--bg-hover)' : 'transparent',
              fontSize: 12,
            }}
          >
            <input
              type="checkbox"
              checked={staged}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleStage(f.path, staged)}
              style={{ margin: 0 }}
            />
            <span style={{ color: STATUS_COLOR[kind], fontWeight: 600, width: 14, textAlign: 'center' }}>
              {STATUS_LABEL[kind]}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>
              {f.path}
            </span>
          </div>
        )
      })}
    </div>
  )
}
