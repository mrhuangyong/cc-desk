import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

type ModelProvider = {
  id: string; name: string; apiKey: string; baseUrl: string; enabled: boolean
}
type ModelItem = {
  id: string; name: string; providerId: string; sdkModelId: string; contextLength: string; enabled: boolean
}
type Cfg = {
  providers: ModelProvider[]; models: ModelItem[]
  modelRoleMap: Record<string, string>; activeModelId: string
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12 }
const fieldLabelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4, marginTop: 12 }
const iconBtn: React.CSSProperties = { padding: '4px 6px', fontSize: 13, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1 }
const smallBtn: React.CSSProperties = { padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)' }

export function ModelSettings() {
  const { t } = useI18n()
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [activeId, setActiveId] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [confirmingProvider, setConfirmingProvider] = useState<string | null>(null)
  const [editingModel, setEditingModel] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reload = () => {
    setError('')
    window.api?.ccDesk.model.get().then(c => {
      setCfg(c)
      if (!c.providers.some(p => p.id === activeId)) setActiveId(c.providers[0]?.id ?? '')
    }).catch(e => setError(String(e)))
  }
  useEffect(() => { reload() }, [])

  const persist = (patch: Partial<Cfg>) => {
    setCfg(prev => prev ? { ...prev, ...patch } : prev)
    window.api?.ccDesk.model.save(patch)
  }

  if (error) return <div style={{ maxWidth: 760, margin: '40px auto', color: 'var(--danger)', fontSize: 13 }}>读取配置失败：{error}</div>
  if (!cfg) return <div style={{ maxWidth: 760, margin: '40px auto', color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>

  const provider = cfg.providers.find(p => p.id === activeId)
  const providerModels = cfg.models.filter(m => m.providerId === activeId)

  const addProvider = () => {
    const id = `provider-${Date.now()}`
    const np: ModelProvider = { id, name: t('model.newProvider'), apiKey: '', baseUrl: '', enabled: true }
    persist({ providers: [...cfg.providers, np] })
    setActiveId(id)
  }
  const updateProvider = (patch: Partial<ModelProvider>) =>
    persist({ providers: cfg.providers.map(p => p.id === activeId ? { ...p, ...patch } : p) })
  const removeProvider = (id: string) => {
    persist({
      providers: cfg.providers.filter(p => p.id !== id),
      models: cfg.models.filter(m => m.providerId !== id),
    })
    setConfirmingProvider(null)
    if (activeId === id) {
      const rest = cfg.providers.filter(p => p.id !== id)
      setActiveId(rest[0]?.id ?? '')
    }
  }

  const addModel = () => {
    const id = `model-${Date.now()}`
    const name = t('model.newModel')
    const m: ModelItem = { id, name, providerId: activeId, sdkModelId: name, contextLength: '8万', enabled: true }
    persist({ models: [...cfg.models, m] })
    setEditingModel(id) // 新增后自动展开编辑表单，省去再点编辑图标
  }
  const updateModel = (id: string, patch: Partial<ModelItem>) =>
    persist({ models: cfg.models.map(m => m.id === id ? { ...m, ...patch } : m) })
  const removeModel = (id: string) => {
    persist({ models: cfg.models.filter(m => m.id !== id) })
    setEditingModel(null)
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 0 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>{t('model.title')}</h2>
          <button title="刷新" style={iconBtn} onClick={reload}><RefreshCw size={14} /></button>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>{t('model.desc')}</div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        {/* 左：供应商列表 */}
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, padding: '0 8px' }}>{t('model.providers')}</div>
          {cfg.providers.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
              padding: '8px 10px', marginBottom: 2, borderRadius: 'var(--radius)', cursor: 'pointer', border: 'none',
              background: p.id === activeId ? 'var(--bg-hover)' : 'transparent', color: 'var(--text)', fontSize: 13,
            }}>
              <span style={{ fontSize: 10 }}>{p.id === activeId ? '●' : '○'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </button>
          ))}
          <button onClick={addProvider} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', padding: '8px 10px', marginTop: 4, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13 }}><Plus size={13} /> {t('model.addProvider')}</button>
        </div>

        {/* 右：详情 + 模型 */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {provider && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {editingName ? (
                  <input autoFocus defaultValue={provider.name}
                    onBlur={e => { updateProvider({ name: e.target.value }); setEditingName(false) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    style={{ ...inputStyle, width: 'auto', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14 }} />
                ) : (
                  <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{provider.name}</span>
                )}
                <button title="编辑名称" onClick={() => setEditingName(true)} style={iconBtn}><Pencil size={13} /></button>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button onClick={() => updateProvider({ enabled: !provider.enabled })} style={provider.enabled ? { ...smallBtn, background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : smallBtn}>
                    {provider.enabled ? t('model.enabled') : t('model.enable')}
                  </button>
                  {confirmingProvider === provider.id ? (
                    <button onClick={() => removeProvider(provider.id)} style={{ ...smallBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{t('model.confirmDelete')}</button>
                  ) : (
                    <button title="删除" onClick={() => setConfirmingProvider(provider.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
                  )}
                </span>
              </div>

              <div style={fieldLabelStyle}>{t('model.baseUrl')}</div>
              <input value={provider.baseUrl} onChange={e => updateProvider({ baseUrl: e.target.value })} placeholder="http://..." style={inputStyle} />

              <div style={fieldLabelStyle}>{t('model.apiKey')}</div>
              <div style={{ position: 'relative' }}>
                <input type={showKey ? 'text' : 'password'} value={provider.apiKey} onChange={e => updateProvider({ apiKey: e.target.value })} placeholder="sk-..." style={inputStyle} />
                <button onClick={() => setShowKey(s => !s)} title={showKey ? '隐藏' : '显示'} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 13, padding: 4, color: 'var(--text-muted)' }}>{showKey ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              </div>

              <div style={fieldLabelStyle}>{t('model.models')}</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {providerModels.length === 0 && <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>{t('model.emptyModels')}</div>}
                {providerModels.map((m, i) => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 12px', borderBottom: i < providerModels.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)', fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{m.name}</span>
                      <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 11, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{m.contextLength}</span>
                      <button title="编辑" onClick={() => setEditingModel(editingModel === m.id ? null : m.id)} style={iconBtn}><Pencil size={13} /></button>
                      <button title="删除" onClick={() => removeModel(m.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
                    </div>
                    {editingModel === m.id && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input value={m.name} onChange={e => updateModel(m.id, { name: e.target.value })} placeholder="名称" style={{ ...inputStyle, flex: 1 }} />
                        <input value={m.sdkModelId} onChange={e => updateModel(m.id, { sdkModelId: e.target.value })} placeholder={t('model.sdkModelId')} style={{ ...inputStyle, flex: 1 }} />
                        <input value={m.contextLength} onChange={e => updateModel(m.id, { contextLength: e.target.value })} placeholder={t('model.contextLength')} style={{ ...inputStyle, width: 80 }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addModel} style={{ marginTop: 10, ...smallBtn }}>+ {t('model.addModel')}</button>
            </>
          )}
          {!provider && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>{t('model.emptyProvider')}</div>}
        </div>
      </div>
    </div>
  )
}
