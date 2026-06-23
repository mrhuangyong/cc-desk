import { useState } from 'react'
import type { ClaudeCommand } from '../../../main/claude-config'

interface Props {
  onCreated: (command: ClaudeCommand) => void
  onClose: () => void
}

const labelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
}
const primaryBtn: React.CSSProperties = {
  padding: '7px 18px', fontSize: 12, cursor: 'pointer',
  border: 'none', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, cursor: 'pointer',
  border: 'none', background: 'transparent', color: 'var(--text-muted)',
}

const NAME_RE = /^[a-z0-9-]+$/

export function CreateCommandDialog({ onCreated, onClose }: Props) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameValid = NAME_RE.test(name.trim())
  const canSubmit = nameValid && !loading

  const handleCreate = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api?.cc.commands.create(name.trim(), desc.trim())
      if (result?.success && result.command) {
        onCreated(result.command)
        onClose()
      } else {
        setError(result?.message || '创建失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 440, maxWidth: '90vw',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-float)',
        padding: 20,
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text)', fontSize: 15, margin: '0 0 16px 0' }}>新建命令</h3>

        <div>
          <div style={labelStyle}>命令名称</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/</span>
            <input
              placeholder="my-command"
              value={name} onChange={e => setName(e.target.value)}
              style={inputStyle} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleCreate() }}
            />
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: name && !nameValid ? 'var(--danger, #e57373)' : 'var(--text-muted)' }}>
            仅小写字母、数字、连字符
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={labelStyle}>描述</div>
          <input
            placeholder="命令用途说明"
            value={desc} onChange={e => setDesc(e.target.value)}
            style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleCreate() }}
          />
        </div>

        {error && (
          <div style={{ marginTop: 10, color: 'var(--danger, #e57373)', fontSize: 12, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={ghostBtn}>取消</button>
          <button onClick={handleCreate} disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5 }}>
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
