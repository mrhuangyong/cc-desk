import { useEffect, useState } from 'react'
import type { ClaudeMcpServer } from '../../../main/claude-config'
import { Toggle } from './Toggle'
import { McpEditDialog } from './McpEditDialog'
import { Plus, Plug, Pencil, Trash2 } from 'lucide-react'

const iconBtn: React.CSSProperties = {
  padding: '4px 6px', fontSize: 13, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1
}
const topIconBtn: React.CSSProperties = { ...iconBtn, fontSize: 14, padding: '4px 8px' }

export function McpSettings() {
  const [servers, setServers] = useState<ClaudeMcpServer[]>([])
  const [q, setQ] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 挂载与刷新：从 ~/.claude.json 的 mcpServers 读取真实配置
  const reload = () => {
    setLoading(true)
    window.api?.cc?.mcp.get().then(list => { setServers(list); setLoading(false) })
  }
  useEffect(() => { reload() }, [])

  // 保存：整体写回 ~/.claude.json 的 mcpServers（append-only 不动其它 key）
  const persist = (next: ClaudeMcpServer[]) => {
    setServers(next)
    window.api?.cc?.mcp.save(next)
  }

  const filtered = servers.filter(s => s.name.toLowerCase().includes(q.toLowerCase()))
  const update = (id: string, patch: Partial<ClaudeMcpServer>) =>
    persist(servers.map(s => s.id === id ? { ...s, ...patch } : s))
  const toggle = (id: string) => {
    const s = servers.find(x => x.id === id)
    if (s) update(id, { enabled: !s.enabled })
  }
  const remove = (id: string) => {
    persist(servers.filter(s => s.id !== id))
    setConfirmingId(null)
  }
  const addNew = () => {
    const id = `mcp-${Date.now()}`
    persist([...servers, { id, name: `new-mcp-${servers.length + 1}`, transport: 'stdio', command: '', args: '', env: '', enabled: true, scope: '用户' }])
    setEditingId(id)
  }

  const editing = servers.find(s => s.id === editingId) ?? null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 + 操作图标 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>MCP 服务器</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <button title="添加" onClick={addNew} style={topIconBtn}><Plus size={14} /></button>
        </div>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        读写 ~/.claude.json 的 mcpServers（全局配置）。管理 Agent 使用的 MCP 服务器。
      </div>

      {/* 搜索框 */}
      <input
        placeholder="搜索 MCP 服务器..."
        value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none', marginBottom: 14 }}
      />

      {/* 计数 */}
      <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        已配置 MCP 服务器 {servers.length}
      </div>

      {/* 列表 */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg)', boxShadow: 'var(--shadow-float)' }}>
        {loading && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配 MCP</div>
        )}
        {filtered.map((s, i) => (
          <div key={s.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
              <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0, display: 'inline-flex' }}><Plug size={16} /></span>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: s.enabled ? 'var(--accent)' : 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text)', fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{s.transport}</span>
              <Toggle on={s.enabled} onChange={() => toggle(s.id)} aria-label={`${s.enabled ? '禁用' : '启用'} ${s.name}`} />
              <button title="编辑" onClick={() => setEditingId(s.id)} style={iconBtn}><Pencil size={13} /></button>
              {confirmingId === s.id ? (
                <button onClick={() => remove(s.id)} style={{ ...iconBtn, color: 'var(--danger)' }}>确认？</button>
              ) : (
                <button title="删除" onClick={() => setConfirmingId(s.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
              )}
            </div>
            <div style={{ padding: '0 14px 12px 40px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              {s.transport} · {[s.command, s.args].filter(Boolean).join(' ') || '(未配置)'}
            </div>
          </div>
        ))}
      </div>

      {/* 编辑弹窗 */}
      {editing && (
        <McpEditDialog
          server={editing}
          onSave={(patch) => { update(editing.id, patch); setEditingId(null) }}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  )
}
