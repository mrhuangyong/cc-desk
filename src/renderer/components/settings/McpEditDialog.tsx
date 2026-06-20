import { useState } from 'react'
import type { McpServer } from '../../types'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface Props {
  server: McpServer
  onSave: (patch: Partial<McpServer>) => void
  onCancel: () => void
}

const fieldLabel: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4, marginTop: 12 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
  fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none'
}
const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 16px', fontSize: 12, cursor: 'pointer', border: 'none',
  background: 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent'
})
const primaryBtn: React.CSSProperties = {
  padding: '7px 18px', fontSize: 12, cursor: 'pointer',
  border: 'none', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)'
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, cursor: 'pointer',
  border: 'none', background: 'transparent', color: 'var(--text-muted)'
}

// ---- 字段 ↔ 标准落盘格式转换（与后端 buildMcpEntry/parseMcpEntry 同构）----

// env 字符串 KEY=VALUE 行 → 对象
function parseEnvLines(env: string): Record<string, string> {
  const obj: Record<string, string> = {}
  ;(env || '').split('\n').forEach(line => {
    const i = line.indexOf('=')
    if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1)
  })
  return obj
}
// headers 字符串 KEY: VALUE 行 → 对象
function parseHeaderLines(headers: string): Record<string, string> {
  const obj: Record<string, string> = {}
  ;(headers || '').split('\n').forEach(line => {
    const i = line.indexOf(':')
    if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  })
  return obj
}
// 渲染端字段 → 标准落盘格式单条 server 对象
function serverToStdJSON(s: McpServer): Record<string, any> {
  if (s.transport === 'http') {
    const obj: any = { type: 'http', url: s.command }
    const headers = parseHeaderLines(s.headers)
    if (Object.keys(headers).length) obj.headers = headers
    return obj
  }
  const obj: any = { command: s.command }
  const args = s.args.trim() ? s.args.trim().split(/\s+/) : []
  if (args.length) obj.args = args
  const env = parseEnvLines(s.env)
  if (Object.keys(env).length) obj.env = env
  return obj
}
// 标准格式单条 server 对象 → 渲染端字段
function stdJSONToServer(name: string, raw: any): Partial<McpServer> {
  const isHttp = raw.type === 'http' || (!!raw.url && !raw.command)
  if (isHttp) {
    return {
      name, transport: 'http', command: raw.url || '',
      args: '', env: '',
      headers: raw.headers && typeof raw.headers === 'object'
        ? Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
    }
  }
  return {
    name, transport: 'stdio', command: raw.command || '',
    args: Array.isArray(raw.args) ? raw.args.join(' ') : '',
    env: raw.env && typeof raw.env === 'object'
      ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    headers: '',
  }
}

export function McpEditDialog({ server, onSave, onCancel }: Props) {
  const [tab, setTab] = useState<'form' | 'json'>('form')
  const [draft, setDraft] = useState<McpServer>({ ...server, headers: server.headers ?? '' })
  const [showEnv, setShowEnv] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)

  // 标准 JSON：完整 mcpServers 外层 + 单条 server。进入 JSON tab 时用当前 draft 生成。
  const buildStdJsonText = (s: McpServer) =>
    JSON.stringify({ mcpServers: { [s.name]: serverToStdJSON(s) } }, null, 2)
  const [jsonText, setJsonText] = useState(() => buildStdJsonText({ ...server, headers: server.headers ?? '' }))

  const patch = (p: Partial<McpServer>) => setDraft(prev => ({ ...prev, ...p }))

  // 切到 JSON tab 时用最新 draft 重新生成标准格式
  const onTabChange = (t: 'form' | 'json') => {
    setTab(t)
    if (t === 'json') { setJsonText(buildStdJsonText(draft)); setJsonError(null) }
  }

  const save = () => {
    if (tab === 'json') {
      // 从标准 JSON 解析出 mcpServers[name] 单条，转成渲染端字段
      try {
        const parsed = JSON.parse(jsonText)
        const mcpServers = parsed.mcpServers || parsed
        const entries = Object.entries(mcpServers)
        if (entries.length === 0) { setJsonError('JSON 中无 mcpServers 条目'); return }
        const [name, raw] = entries[0] as [string, any]
        onSave(stdJSONToServer(name, raw))
      } catch (e) {
        setJsonError('JSON 格式错误：' + (e instanceof Error ? e.message : String(e)))
        return
      }
      return
    }
    onSave({
      name: draft.name, transport: draft.transport, command: draft.command,
      args: draft.args, env: draft.env, headers: draft.headers, scope: draft.scope
    })
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-float)', overflow: 'hidden'
        }}
      >
        {/* 标题栏 + tab */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ padding: '10px 8px', color: 'var(--text)', fontSize: 14 }}>编辑 MCP 服务器</span>
          <div style={{ display: 'flex' }}>
            <button style={tabStyle(tab === 'form')} onClick={() => onTabChange('form')}>表单</button>
            <button style={tabStyle(tab === 'json')} onClick={() => onTabChange('json')}>JSON</button>
          </div>
        </div>

        <div style={{ padding: '8px 16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
          修改当前 MCP 配置，保存后返回列表。
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 8px' }}>
          {tab === 'form' ? (
            <>
              {/* 名称 + 作用域 同一行 */}
              <div style={fieldLabel}>名称</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input value={draft.name} onChange={e => patch({ name: e.target.value })} style={inputStyle} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ ...fieldLabel, marginTop: 0, marginBottom: 4 }}>作用域</span>
                  <select value={draft.scope} onChange={e => patch({ scope: e.target.value as '用户' | '工作区' })} style={{ ...inputStyle, fontFamily: 'var(--font)', width: 100 }}>
                    <option value="用户">用户</option>
                    <option value="工作区">工作区</option>
                  </select>
                </div>
              </div>

              <div style={fieldLabel}>类型</div>
              <select value={draft.transport} onChange={e => patch({ transport: e.target.value as 'stdio' | 'http' })} style={{ ...inputStyle, fontFamily: 'var(--font)' }}>
                <option value="stdio">stdio（本地命令）</option>
                <option value="http">http（远程 URL）</option>
              </select>

              {draft.transport === 'stdio' ? (
                <>
                  <div style={fieldLabel}>命令</div>
                  <input value={draft.command} onChange={e => patch({ command: e.target.value })} placeholder="npx" style={inputStyle} />
                  <div style={fieldLabel}>参数（空格分隔）</div>
                  <input value={draft.args} onChange={e => patch({ args: e.target.value })} placeholder="-y @playwright/mcp@latest" style={inputStyle} />

                  {/* 环境变量（可折叠） */}
                  <div style={{ marginTop: 14 }}>
                    <button
                      onClick={() => setShowEnv(s => !s)}
                      style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12 }}
                    >{showEnv ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 环境变量（可选）</button>
                    {showEnv && (
                      <textarea
                        value={draft.env}
                        onChange={e => patch({ env: e.target.value })}
                        placeholder={'KEY=VALUE\n每行一个'}
                        style={{ ...inputStyle, minHeight: 60, resize: 'vertical', marginTop: 6, fontFamily: 'var(--font-mono)' }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div style={fieldLabel}>URL</div>
                  <input value={draft.command} onChange={e => patch({ command: e.target.value })} placeholder="https://..." style={inputStyle} />
                  <div style={fieldLabel}>Headers（KEY: VALUE 每行一个，可选）</div>
                  <textarea
                    value={draft.headers}
                    onChange={e => patch({ headers: e.target.value })}
                    placeholder={'Authorization: Bearer xxx\nContent-Type: application/json'}
                    style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <div style={fieldLabel}>配置 JSON（标准格式，含 mcpServers 外层）</div>
              <textarea
                value={jsonText}
                onChange={e => { setJsonText(e.target.value); setJsonError(null) }}
                style={{ ...inputStyle, minHeight: 280, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
              />
              {jsonError && (
                <div style={{ marginTop: 6, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{jsonError}</div>
              )}
            </>
          )}
        </div>

        {/* 底部操作 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
          <button onClick={save} style={primaryBtn}>保存</button>
          <button onClick={onCancel} style={ghostBtn}>取消</button>
        </div>
      </div>
    </div>
  )
}
