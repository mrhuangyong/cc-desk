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

export function McpEditDialog({ server, onSave, onCancel }: Props) {
  const [tab, setTab] = useState<'form' | 'json'>('form')
  const [draft, setDraft] = useState<McpServer>({ ...server })
  const [showEnv, setShowEnv] = useState(false)
  const [jsonText, setJsonText] = useState(() => JSON.stringify({
    name: server.name, transport: server.transport,
    command: server.command, args: server.args, env: server.env, scope: server.scope
  }, null, 2))

  const patch = (p: Partial<McpServer>) => setDraft(prev => ({ ...prev, ...p }))

  const save = () => {
    if (tab === 'json') {
      // 从 JSON 解析回字段
      try {
        const obj = JSON.parse(jsonText)
        onSave(obj)
      } catch {
        // 解析失败：忽略保存（原型简化，可加提示）
      }
      return
    }
    onSave({
      name: draft.name, transport: draft.transport, command: draft.command,
      args: draft.args, env: draft.env, scope: draft.scope
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
            <button style={tabStyle(tab === 'form')} onClick={() => setTab('form')}>表单</button>
            <button style={tabStyle(tab === 'json')} onClick={() => setTab('json')}>JSON</button>
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
                </>
              ) : (
                <>
                  <div style={fieldLabel}>URL</div>
                  <input value={draft.command} onChange={e => patch({ command: e.target.value })} placeholder="https://..." style={inputStyle} />
                </>
              )}

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
              <div style={fieldLabel}>配置 JSON</div>
              <textarea
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
                style={{ ...inputStyle, minHeight: 280, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
              />
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
