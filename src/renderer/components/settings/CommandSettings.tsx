// 命令管理设置页：三 Tab（自定义 / 插件 / 内置）。
// 自定义 Tab：完整 CRUD（新建/编辑/删除）。插件和内置 Tab：只读 + 可点击查看详情。
import { useEffect, useState, useCallback } from 'react'
import type { ClaudeCommand } from '../../../main/claude-config'
import { CreateCommandDialog } from './CreateCommandDialog'
import { CommandEditModal } from './CommandEditModal'
import { Plus, Pencil, Trash2, FileText } from 'lucide-react'
import { Tooltip } from '../Tooltip'
import { ConfirmDialog } from './ConfirmDialog'
import { segBtn, iconBtn } from './styles'

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'transparent', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', outline: 'none', marginBottom: 14,
}
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 0', borderBottom: '1px solid var(--border)',
}

type TabKey = 'custom' | 'plugin' | 'builtin'

export function CommandSettings() {
  const [commands, setCommands] = useState<ClaudeCommand[]>([])
  const [tab, setTab] = useState<TabKey>('custom')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ClaudeCommand | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    window.api?.cc?.commands.get().then(list => { setCommands(list); setLoading(false) })
  }, [])
  useEffect(() => { reload() }, [reload])

  const custom = commands.filter(c => c.source === 'user')
  const plugin = commands.filter(c => c.source !== 'user' && c.source !== 'builtin')
  const builtin = commands.filter(c => c.source === 'builtin')

  const handleDelete = async () => {
    if (!confirmDelete) return
    await window.api?.cc?.commands.delete(confirmDelete)
    setConfirmDelete(null)
    reload()
  }

  // 新建命令后：直接用 createCommand 返回的对象打开编辑器（无需 reload + setTimeout
  // 二次 get 找新命令——后者是慢盘会漏、快盘浪费的竞态 bandaid）。
  // reload 仍调一次让列表显示新命令，但 setEditing 立即用返回值，不依赖 reload 时序。
  const handleCreated = (command: ClaudeCommand) => {
    reload()
    setEditing(command)
  }

  const currentList = tab === 'custom' ? custom : tab === 'plugin' ? plugin : builtin

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>命令管理</h2>
        {tab === 'custom' && (
          <button style={primaryBtn} onClick={() => setShowCreate(true)}><Plus size={14} /> 新建命令</button>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        自定义命令存储在 ~/.cc-desk/claude/commands/，SDK 运行时自动加载。
      </div>

      <div style={{ display: 'flex', marginBottom: 14 }}>
        <button style={segBtn(tab === 'custom')} onClick={() => setTab('custom')}>自定义({custom.length})</button>
        <button style={segBtn(tab === 'plugin')} onClick={() => setTab('plugin')}>插件({plugin.length})</button>
        <button style={segBtn(tab === 'builtin')} onClick={() => setTab('builtin')}>内置({builtin.length})</button>
      </div>

      <CommandList
        commands={currentList}
        loading={loading}
        mode={tab === 'custom' ? 'editable' : 'readonly'}
        showSource={tab === 'plugin'}
        onEdit={c => setEditing(c)}
        onDelete={setConfirmDelete}
      />

      {showCreate && <CreateCommandDialog onCreated={handleCreated} onClose={() => setShowCreate(false)} />}
      {editing && <CommandEditModal command={editing} onClose={() => { setEditing(null); reload() }} />}

      {confirmDelete && (
        <ConfirmDialog
          title={`确定删除 ${confirmDelete}？此操作不可撤销。`}
          confirmLabel="删除"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

function CommandList({ commands, loading, mode, showSource, onEdit, onDelete }: {
  commands: ClaudeCommand[]
  loading: boolean
  mode: 'editable' | 'readonly'
  showSource: boolean
  onEdit: (cmd: ClaudeCommand) => void
  onDelete?: (name: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = commands.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) || c.desc.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div>
      <input placeholder="搜索命令..." value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
      {loading && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配命令</div>}
      {filtered.map(c => (
        <div key={c.id} style={rowStyle}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{c.name}</span>
              {showSource && (
                <span style={{ padding: '0px 6px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{c.source}</span>
              )}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{c.desc}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {mode === 'editable' ? (
              <>
                <Tooltip label="编辑">
                  <button onClick={() => onEdit(c)} style={iconBtn}><Pencil size={13} /></button>
                </Tooltip>
                <Tooltip label="删除">
                  <button onClick={() => onDelete?.(c.name)} style={iconBtn}><Trash2 size={13} /></button>
                </Tooltip>
              </>
            ) : (
              <Tooltip label="详情">
                <button onClick={() => onEdit(c)} style={iconBtn}><FileText size={13} /></button>
              </Tooltip>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
