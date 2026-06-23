import { useEffect, useState } from 'react'
import type { ClaudeMcpServer } from '../../../main/claude-config'
import { Toggle } from './Toggle'
import { McpEditDialog } from './McpEditDialog'
import { Plus, Plug, Pencil, Trash2 } from 'lucide-react'
import { Tooltip } from '../Tooltip'
import { segBtn, iconBtn } from './styles'

const topIconBtn: React.CSSProperties = { ...iconBtn, fontSize: 14, padding: '4px 8px' }

export function McpSettings() {
  const [servers, setServers] = useState<ClaudeMcpServer[]>([])
  const [q, setQ] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [pendingNewId, setPendingNewId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'json'>('list')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // 挂载与刷新：从 ~/.cc-desk/claude/.claude.json 的 mcpServers 读取真实配置
  const reload = () => {
    setLoading(true)
    Promise.all([
      window.api?.cc?.mcp.get(),
      window.api?.cc?.mcp.getJson(),
    ]).then(([list, json]) => {
      setServers(list ?? [])
      setJsonText(json ?? '')
      setLoading(false)
    })
  }
  useEffect(() => { reload() }, [])

  // 保存：整体写回 ~/.cc-desk/claude/.claude.json 的 mcpServers（append-only 不动其它 key）。
  // async：写盘后用 cc.mcp.getJson 取与磁盘一致的 JSON 预览（与 main 的 buildMcpEntry
  // 转换同源，避免 renderer 自行转换的偏差）。调用方 fire-and-forget，无需 await。
  const persist = async (next: ClaudeMcpServer[]) => {
    setServers(next)
    await window.api?.cc?.mcp.save(next)
    const json = await window.api?.cc?.mcp.getJson()
    if (json != null) setJsonText(json)
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
    setServers([...servers, { id, name: `new-mcp-${servers.length + 1}`, transport: 'stdio', command: '', args: '', env: '', headers: '', enabled: true, scope: '用户' }])
    setPendingNewId(id)
    setEditingId(id)
  }

  // JSON 视图保存：解析标准 JSON → server 数组 → cc.mcp.save
  const saveJson = () => {
    try {
      const parsed = JSON.parse(jsonText)
      const entries = Object.entries(parsed.mcpServers || {})
      const next: ClaudeMcpServer[] = entries.map(([name, rawAny]: [string, any]) => {
        const raw = rawAny || {}
        const isHttp = raw.type === 'http' || (!!raw.url && !raw.command)
        const existing = servers.find(s => s.name === name)
        if (isHttp) {
          return {
            id: name, name, transport: 'http', command: raw.url || '',
            args: '', env: '',
            headers: raw.headers && typeof raw.headers === 'object'
              ? Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
            enabled: existing?.enabled ?? true, scope: existing?.scope ?? '用户',
          }
        }
        return {
          id: name, name, transport: 'stdio', command: raw.command || '',
          args: Array.isArray(raw.args) ? raw.args.join(' ') : '',
          env: raw.env && typeof raw.env === 'object'
            ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
          headers: '',
          enabled: existing?.enabled ?? true, scope: existing?.scope ?? '用户',
        }
      })
      persist(next)
      setJsonError(null)
    } catch (e) {
      setJsonError('JSON 格式错误：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const closeEditor = () => {
    if (editingId && editingId === pendingNewId) {
      setServers(servers.filter(s => s.id !== editingId))
      setPendingNewId(null)
    }
    setEditingId(null)
  }

  const editing = servers.find(s => s.id === editingId) ?? null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 + 操作图标 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>MCP 服务器</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip label="添加"><button aria-label="添加" onClick={addNew} style={topIconBtn}><Plus size={14} /></button></Tooltip>
        </div>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        读写 ~/.cc-desk/claude/.claude.json 的 mcpServers（全局配置）。管理 Agent 使用的 MCP 服务器。
      </div>

      {/* 视图切换 */}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <button onClick={() => setView('list')} style={segBtn(view === 'list')}>列表</button>
        <button onClick={() => { setView('json'); setJsonError(null) }} style={segBtn(view === 'json')}>JSON</button>
      </div>

      {view === 'list' && (
        <>
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
                  <Tooltip label="编辑"><button aria-label="编辑" onClick={() => setEditingId(s.id)} style={iconBtn}><Pencil size={13} /></button></Tooltip>
                  {confirmingId === s.id ? (
                    <button onClick={() => remove(s.id)} style={{ ...iconBtn, color: 'var(--danger)' }}>确认？</button>
                  ) : (
                    <Tooltip label="删除"><button aria-label="删除" onClick={() => setConfirmingId(s.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button></Tooltip>
                  )}
                </div>
                <div style={{ padding: '0 14px 12px 40px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {s.transport} · {[s.command, s.args].filter(Boolean).join(' ') || '(未配置)'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'json' && (
        <>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setJsonError(null) }}
            spellCheck={false}
            style={{ width: '100%', minHeight: 360, padding: '10px', background: 'var(--bg-sidebar)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', resize: 'vertical' }}
          />
          {jsonError && (
            <div style={{ marginTop: 6, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{jsonError}</div>
          )}
          <div style={{ marginTop: 10 }}>
            <button onClick={saveJson} style={{
              padding: '7px 18px', fontSize: 12, cursor: 'pointer',
              border: 'none', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: 'var(--accent-text)'
            }}>保存</button>
          </div>
        </>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <McpEditDialog
          server={editing}
          onSave={(patch) => { update(editing.id, patch); setPendingNewId(null); setEditingId(null) }}
          onCancel={closeEditor}
        />
      )}
    </div>
  )
}
