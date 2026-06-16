import { useState } from 'react'
import { mockProviders, mockModels } from '../../state/mockData'
import type { ModelProvider, ModelItem } from '../../types'
import { RefreshCw, Plus, Pencil, Trash2, Link2, Eye, EyeOff } from 'lucide-react'

const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12 }
const fieldLabelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4, marginTop: 12 }
const iconBtn: React.CSSProperties = { padding: '4px 6px', fontSize: 13, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1 }
const smallBtn: React.CSSProperties = { padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)' }

const API_FORMATS = [
  'Anthropic Messages (/v1/messages)',
  'OpenAI Chat (/v1/chat/completions)',
  'OpenAI Responses (/v1/responses)'
]

export function ModelSettings() {
  const [providers, setProviders] = useState<ModelProvider[]>(() => mockProviders.map(p => ({ ...p })))
  const [models, setModels] = useState<ModelItem[]>(() => mockModels.map(m => ({ ...m })))
  const [activeId, setActiveId] = useState(providers[0]?.id ?? '')
  const [showKey, setShowKey] = useState(false)
  const [editingProviderName, setEditingProviderName] = useState(false)
  const [confirmingProvider, setConfirmingProvider] = useState<string | null>(null)
  const [confirmingModel, setConfirmingModel] = useState<string | null>(null)

  const provider = providers.find(p => p.id === activeId)
  const providerModels = models.filter(m => m.providerId === activeId)

  // 供应商操作
  const addProvider = () => {
    const id = `provider-${Date.now()}`
    const np: ModelProvider = { id, name: '新供应商', apiKey: '', baseUrl: '', apiFormat: API_FORMATS[0], enabled: true }
    setProviders(prev => [...prev, np])
    setActiveId(id)
  }
  const updateProvider = (patch: Partial<ModelProvider>) =>
    setProviders(prev => prev.map(p => p.id === activeId ? { ...p, ...patch } : p))
  const removeProvider = (id: string) => {
    setProviders(prev => prev.filter(p => p.id !== id))
    setModels(prev => prev.filter(m => m.providerId !== id))
    setConfirmingProvider(null)
    if (activeId === id) {
      const rest = providers.filter(p => p.id !== id)
      setActiveId(rest[0]?.id ?? '')
    }
  }

  // 模型操作
  const addModel = () => {
    const m: ModelItem = { id: `model-${Date.now()}`, name: '新模型', providerId: activeId, contextLength: '8万', enabled: true }
    setModels(prev => [...prev, m])
  }
  const removeModel = (id: string) => {
    setModels(prev => prev.filter(m => m.id !== id))
    setConfirmingModel(null)
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', width: '100%' }}>
      {/* 标题 + 说明 + 刷新 */}
      <div style={{ padding: '0 0 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>模型设置</h2>
          <button title="刷新" style={iconBtn}><RefreshCw size={14} /></button>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
          管理自定义模型供应商，配置后可在聊天时选择使用。
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        {/* 左：自定义供应商 */}
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, padding: '0 8px' }}>自定义供应商</div>
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '8px 10px', marginBottom: 2, borderRadius: 'var(--radius)', cursor: 'pointer',
                border: 'none',
                background: p.id === activeId ? 'var(--bg-hover)' : 'transparent',
                color: p.id === activeId ? 'var(--text)' : 'var(--text)', fontSize: 13
              }}
            >
              <span style={{ fontSize: 10 }}>{p.id === activeId ? '●' : '○'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </button>
          ))}
          <button onClick={addProvider} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', padding: '8px 10px', marginTop: 4, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13 }}><Plus size={13} /> 添加供应商</button>
        </div>

        {/* 右：表单 + 模型列表 */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {provider && (
            <>
              {/* 供应商操作行 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {editingProviderName ? (
                  <input
                    autoFocus
                    defaultValue={provider.name}
                    onBlur={e => { updateProvider({ name: e.target.value }); setEditingProviderName(false) }}
                    onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
                    style={{ ...inputStyle, width: 'auto', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14 }}
                  />
                ) : (
                  <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{provider.name}</span>
                )}
                <button title="编辑名称" onClick={() => setEditingProviderName(true)} style={iconBtn}><Pencil size={13} /></button>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button onClick={() => updateProvider({ enabled: !provider.enabled })} style={provider.enabled ? { ...smallBtn, background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : smallBtn}>
                    {provider.enabled ? '已启用' : '启用'}
                  </button>
                  {provider.enabled && <button onClick={() => updateProvider({ enabled: false })} style={smallBtn}>禁用</button>}
                  {confirmingProvider === provider.id ? (
                    <button onClick={() => removeProvider(provider.id)} style={{ ...smallBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}>确认删除？</button>
                  ) : (
                    <button title="删除供应商" onClick={() => setConfirmingProvider(provider.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
                  )}
                </span>
              </div>

              {/* Base URL */}
              <div style={fieldLabelStyle}>Base URL</div>
              <input value={provider.baseUrl} onChange={e => updateProvider({ baseUrl: e.target.value })} placeholder="http://..." style={inputStyle} />

              {/* API 格式 */}
              <div style={fieldLabelStyle}>API 格式</div>
              <select value={provider.apiFormat} onChange={e => updateProvider({ apiFormat: e.target.value })} style={{ ...inputStyle, fontFamily: 'var(--font)' }}>
                {API_FORMATS.map(f => <option key={f}>{f}</option>)}
              </select>

              {/* API Key */}
              <div style={fieldLabelStyle}>API Key</div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={provider.apiKey}
                  onChange={e => updateProvider({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  style={inputStyle}
                />
                <button
                  onClick={() => setShowKey(s => !s)}
                  title={showKey ? '隐藏' : '显示'}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 13, padding: 4 }}
                >{showKey ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              </div>

              {/* 模型列表 */}
              <div style={fieldLabelStyle}>模型列表</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {providerModels.length === 0 && (
                  <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>暂无模型，点下方添加</div>
                )}
                {providerModels.map((m, i) => (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderBottom: i < providerModels.length - 1 ? '1px solid var(--border)' : 'none',
                    color: 'var(--text)', fontSize: 13
                  }}>
                    <span style={{ flex: 1 }}>{m.name}</span>
                    <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 11, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{m.contextLength}</span>
                    <button title="测试连接" style={iconBtn}><Link2 size={13} /></button>
                    <button title="编辑" style={iconBtn}><Pencil size={13} /></button>
                    {confirmingModel === m.id ? (
                      <button onClick={() => removeModel(m.id)} style={{ ...iconBtn, color: 'var(--danger)' }}>确认？</button>
                    ) : (
                      <button title="删除" onClick={() => setConfirmingModel(m.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addModel} style={{ marginTop: 10, ...smallBtn }}>+ 添加模型</button>
            </>
          )}
          {!provider && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>选择左侧供应商，或点"添加供应商"</div>
          )}
        </div>
      </div>
    </div>
  )
}
