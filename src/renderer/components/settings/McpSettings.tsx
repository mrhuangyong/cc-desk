import { useState } from 'react'
import { mockMcpServers } from '../../state/mockData'
import type { McpServer } from '../../types'
import { SettingsLayout } from './SettingsLayout'

const inputStyle: React.CSSProperties = { padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }
const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }
const primaryBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: 12 }
const smallBtn: React.CSSProperties = { padding: '4px 8px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }
const enabledBtn: React.CSSProperties = { ...smallBtn, background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
const dangerBtn: React.CSSProperties = { ...smallBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }

export function McpSettings() {
  const [q, setQ] = useState('')
  const [servers, setServers] = useState(() => mockMcpServers.map(s => ({ ...s })))
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const filtered = servers.filter(s => s.name.toLowerCase().includes(q.toLowerCase()))
  const toggle = (id: string) => setServers(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s))
  const addNew = () => setServers(prev => [...prev, { id: `mcp-${Date.now()}`, name: '新 MCP', url: '', enabled: true }])
  const remove = (id: string) => { setServers(prev => prev.filter(s => s.id !== id)); setConfirmingId(null) }
  const edit = (id: string, patch: Partial<McpServer>) => setServers(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))

  return (
    <SettingsLayout title="MCP 服务器">
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder="搜索 MCP…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, ...inputStyle }} />
        <button onClick={addNew} style={primaryBtn}>+ 添加</button>
      </div>
      {filtered.map(s => (
        <div key={s.id} style={rowStyle}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input defaultValue={s.name} onBlur={e => edit(s.id, { name: e.target.value })} style={inputStyle} aria-label="MCP 名称" />
            <input defaultValue={s.url} placeholder="url" onBlur={e => edit(s.id, { url: e.target.value })} style={inputStyle} aria-label="MCP URL" />
          </div>
          <button onClick={() => toggle(s.id)} style={s.enabled ? enabledBtn : smallBtn}>{s.enabled ? '启用' : '禁用'}</button>
          {confirmingId === s.id ? (
            <button onClick={() => remove(s.id)} style={dangerBtn}>确认删除？</button>
          ) : (
            <button onClick={() => setConfirmingId(s.id)} style={smallBtn}>删除</button>
          )}
        </div>
      ))}
    </SettingsLayout>
  )
}
