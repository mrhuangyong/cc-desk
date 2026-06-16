import { useState } from 'react'
import { mockProviders, mockModels } from '../../state/mockData'

const h3Style: React.CSSProperties = { color: 'var(--text)', fontSize: 14, margin: '0 0 10px' }
const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, color: 'var(--text-muted)', fontSize: 12 }
const inputStyle: React.CSSProperties = { padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }

export function ModelSettings() {
  const [activeProvider, setActiveProvider] = useState(mockProviders[0]?.id ?? '')
  const provider = mockProviders.find(p => p.id === activeProvider)
  const models = mockModels.filter(m => m.providerId === activeProvider)

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16 }}>
      <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', paddingRight: 16 }}>
        <h3 style={h3Style}>提供商</h3>
        {mockProviders.map(p => (
          <button key={p.id} onClick={() => setActiveProvider(p.id)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
            marginBottom: 2, borderRadius: 'var(--radius)', cursor: 'pointer', border: 'none',
            background: p.id === activeProvider ? 'var(--bg-hover)' : 'transparent',
            color: p.id === activeProvider ? 'var(--accent)' : 'var(--text)'
          }}>{p.name}</button>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h3 style={h3Style}>{provider?.name} 配置</h3>
          <label style={fieldStyle}><span>API Key</span>
            <input defaultValue={provider?.apiKey} placeholder="sk-..." style={inputStyle} />
          </label>
          <label style={fieldStyle}><span>Base URL</span>
            <input defaultValue={provider?.baseUrl} style={inputStyle} />
          </label>
        </div>
        <div>
          <h3 style={h3Style}>模型</h3>
          {models.map(m => (
            <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{m.name}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
