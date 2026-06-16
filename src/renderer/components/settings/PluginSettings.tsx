import { useState } from 'react'
import { mockPlugins } from '../../state/mockData'
import type { Plugin } from '../../types'
import { Toggle } from './Toggle'
import { RefreshCw, Plug } from 'lucide-react'

const topIconBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 14, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1
}

export function PluginSettings() {
  const [q, setQ] = useState('')
  const [plugins, setPlugins] = useState<Plugin[]>(() => mockPlugins.map(p => ({ ...p })))
  const filtered = plugins.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) || p.desc.toLowerCase().includes(q.toLowerCase())
  )
  const toggle = (id: string) => setPlugins(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p))

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 + 刷新 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>插件管理</h2>
        <button title="刷新" style={topIconBtn}><RefreshCw size={14} /></button>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        启用或停用已安装的插件。插件可打包技能、命令和 MCP 服务器。
      </div>

      {/* 搜索框 */}
      <input
        placeholder="搜索插件..."
        value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none', marginBottom: 14 }}
      />

      {/* 插件卡片列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配插件</div>
        )}
        {filtered.map(p => (
          <div key={p.id} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            background: 'var(--bg)', boxShadow: 'var(--shadow-float)', padding: '14px 16px'
          }}>
            {/* 标题行：图标 + 名称 + 版本 + 来源 + 开关 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0, display: 'inline-flex' }}><Plug size={16} /></span>
              <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{p.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{p.version}</span>
              <span style={{
                padding: '1px 7px', borderRadius: 999, fontSize: 10,
                border: '1px solid var(--border)', color: 'var(--text-muted)'
              }}>{p.source}</span>
              <span style={{ marginLeft: 'auto' }}>
                <Toggle on={p.enabled} onChange={() => toggle(p.id)} aria-label={`${p.enabled ? '停用' : '启用'} ${p.name}`} />
              </span>
            </div>
            {/* 描述 */}
            <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, marginBottom: 8, paddingLeft: 26 }}>
              {p.desc}
            </div>
            {/* 统计 */}
            <div style={{ color: 'var(--text-muted)', fontSize: 11, paddingLeft: 26 }}>
              {p.skills} 技能 · {p.commands} 命令 · {p.mcps} MCP
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
