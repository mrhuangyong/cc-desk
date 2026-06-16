import { useState } from 'react'
import { mockProviders, mockModels } from '../../state/mockData'
import type { ModelProvider, ModelItem } from '../../types'
import { RefreshCw, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react'
import { SettingsLayout } from './SettingsLayout'
import { SettingsCard } from './SettingsCard'
import { SettingsRow } from './SettingsRow'
import { Toggle } from './Toggle'

const inputStyle: React.CSSProperties = { width: '100%', padding: '6px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12 }
const selectStyle: React.CSSProperties = { ...inputStyle, fontFamily: 'var(--font)' }
const smallBtn: React.CSSProperties = { padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)' }
const iconBtn: React.CSSProperties = { padding: '4px 6px', fontSize: 13, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1 }

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

  const addModel = () => {
    const m: ModelItem = { id: `model-${Date.now()}`, name: '新模型', providerId: activeId, contextLength: '8万', enabled: true }
    setModels(prev => [...prev, m])
  }
  const removeModel = (id: string) => {
    setModels(prev => prev.filter(m => m.id !== id))
    setConfirmingModel(null)
  }

  return (
    <SettingsLayout title="模型设置">
      {/* 供应商列表 */}
      <SettingsCard>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>自定义供应商</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={addProvider} style={smallBtn}><Plus size={13} /> 添加</button>
            <button title="刷新" style={iconBtn}><RefreshCw size={13} /></button>
          </div>
        </div>
        {providers.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActiveId(p.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
              padding: '10px 16px', cursor: 'pointer', border: 'none',
              borderBottom: i < providers.length - 1 ? '1px solid var(--border)' : 'none',
              background: p.id === activeId ? 'var(--bg-hover)' : 'transparent',
              color: 'var(--text)', fontSize: 13
            }}
          >
            <span style={{ fontSize: 10, color: p.id === activeId ? 'var(--accent)' : 'var(--text-muted)' }}>{p.id === activeId ? '●' : '○'}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.enabled ? '已启用' : '未启用'}</span>
          </button>
        ))}
        {providers.length === 0 && (
          <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>暂无供应商</div>
        )}
      </SettingsCard>

      {/* 选中供应商的详情表单 */}
      {provider && (
        <SettingsCard>
          {/* 供应商名称 + 操作 */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            {editingProviderName ? (
              <input
                autoFocus
                defaultValue={provider.name}
                onBlur={e => { updateProvider({ name: e.target.value }); setEditingProviderName(false) }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                style={{ ...inputStyle, width: 'auto', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14 }}
              />
            ) : (
              <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{provider.name}</span>
            )}
            <button title="编辑名称" onClick={() => setEditingProviderName(true)} style={iconBtn}><Pencil size={13} /></button>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <Toggle on={provider.enabled} onChange={v => updateProvider({ enabled: v })} />
              {confirmingProvider === provider.id ? (
                <button onClick={() => removeProvider(provider.id)} style={{ ...smallBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}>确认删除？</button>
              ) : (
                <button title="删除供应商" onClick={() => setConfirmingProvider(provider.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
              )}
            </span>
          </div>

          <SettingsRow title="Base URL" desc="API 端点地址。">
            <input value={provider.baseUrl} onChange={e => updateProvider({ baseUrl: e.target.value })} placeholder="http://..." style={{ ...inputStyle, minWidth: 280 }} />
          </SettingsRow>

          <SettingsRow title="API 格式" desc="选择 API 兼容格式。">
            <select value={provider.apiFormat} onChange={e => updateProvider({ apiFormat: e.target.value })} style={{ ...selectStyle, minWidth: 280 }}>
              {API_FORMATS.map(f => <option key={f}>{f}</option>)}
            </select>
          </SettingsRow>

          <SettingsRow title="API Key" desc="供应商的 API 密钥。">
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={provider.apiKey}
                onChange={e => updateProvider({ apiKey: e.target.value })}
                placeholder="sk-..."
                style={{ ...inputStyle, minWidth: 280 }}
              />
              <button onClick={() => setShowKey(s => !s)} style={smallBtn} title={showKey ? '隐藏' : '显示'}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </span>
          </SettingsRow>

          {/* 模型列表 */}
          <SettingsRow title="模型列表" desc="该供应商下的可用模型。">
            <button onClick={addModel} style={smallBtn}><Plus size={13} /> 添加</button>
          </SettingsRow>
          {providerModels.map((m, i) => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
              borderBottom: i < providerModels.length - 1 ? '1px solid var(--border)' : 'none',
              color: 'var(--text)', fontSize: 13
            }}>
              <span style={{ flex: 1 }}>{m.name}</span>
              <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 11, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{m.contextLength}</span>
              <Toggle on={m.enabled} onChange={v => setModels(prev => prev.map(x => x.id === m.id ? { ...x, enabled: v } : x))} />
              <button title="编辑" style={iconBtn}><Pencil size={13} /></button>
              {confirmingModel === m.id ? (
                <button onClick={() => removeModel(m.id)} style={{ ...iconBtn, color: 'var(--danger)' }}>确认？</button>
              ) : (
                <button title="删除" onClick={() => setConfirmingModel(m.id)} style={iconBtn}><Trash2 size={13} /></button>
              )}
            </div>
          ))}
          {providerModels.length === 0 && (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>暂无模型，点上方添加</div>
          )}
        </SettingsCard>
      )}

      {!provider && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          选择上方供应商查看详情，或点"添加"新建
        </div>
      )}
    </SettingsLayout>
  )
}
