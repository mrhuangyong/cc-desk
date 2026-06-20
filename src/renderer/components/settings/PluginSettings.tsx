import { useEffect, useState } from 'react'
import type { ClaudePlugin } from '../../../main/claude-config'
import { Toggle } from './Toggle'
import { RefreshCw, Plug } from 'lucide-react'
import { Tooltip } from '../Tooltip'

const topIconBtn: React.CSSProperties = {
  padding: '4px 8px', fontSize: 14, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1
}

export function PluginSettings() {
  const [plugins, setPlugins] = useState<ClaudePlugin[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = () => {
    setLoading(true)
    window.api?.cc?.plugins.get().then(list => { setPlugins(list); setLoading(false) })
  }
  useEffect(() => { reload() }, [])

  const filtered = plugins.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) || p.desc.toLowerCase().includes(q.toLowerCase())
  )

  // 切换启用：写回 settings.json 的 enabledPlugins，再重新读取（确保与真实状态一致）
  const toggle = async (id: string) => {
    const p = plugins.find(x => x.id === id)
    if (!p) return
    await window.api?.cc?.plugins.setEnabled(id, !p.enabled)
    reload()
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 + 刷新 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>插件管理</h2>
        <Tooltip label="刷新"><button onClick={reload} style={topIconBtn}><RefreshCw size={14} /></button></Tooltip>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        来自 ~/.cc-desk/claude/plugins/installed_plugins.json + 各插件 manifest，启用状态读写 settings.json 的 enabledPlugins。
      </div>

      {/* 搜索框 */}
      <input
        placeholder="搜索插件..."
        value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none', marginBottom: 14 }}
      />

      {/* 插件卡片列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>
        )}
        {!loading && filtered.length === 0 && (
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
