import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface Props {
  onAdded: () => void
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

// 客户端预判来源类型（仅用于显示 badge，实际识别在后端）
function guessType(input: string): string {
  const t = input.trim()
  if (/^git@github\.com:/.test(t) || /^https?:\/\/github\.com\//.test(t)) return 'GitHub'
  if (/^git@/.test(t) || (/^https?:\/\//.test(t) && t.endsWith('.git'))) return 'Git'
  if (/^https?:\/\//.test(t)) return 'URL'
  if (t.endsWith('.json')) return '本地文件'
  if (t.startsWith('/') || t.startsWith('~')) return '本地目录'
  return ''
}

export function AddMarketplaceDialog({ onAdded, onClose }: Props) {
  const [input, setInput] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [typeOverride, setTypeOverride] = useState('')
  const [ref, setRef] = useState('')
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guessed = input.trim() ? guessType(input) : ''

  const handleAdd = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    try {
      const options: any = { autoUpdate }
      if (typeOverride) options.type = typeOverride
      if (ref.trim()) options.ref = ref.trim()
      await window.api?.cc.marketplaces.add(input.trim(), options)
      onAdded()
      onClose()
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
        width: 480, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-float)',
        padding: 20,
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text)', fontSize: 15, margin: '0 0 16px 0' }}>添加插件仓库</h3>

        <div>
          <div style={labelStyle}>来源（GitHub / Git URL / HTTP URL / 本地路径）</div>
          <input
            placeholder="anthropics/claude-plugins 或 https://... 或 /path/to/dir"
            value={input} onChange={e => setInput(e.target.value)}
            style={inputStyle} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && !loading) handleAdd() }}
          />
          {guessed && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent)' }}>
              识别为：{guessed}
            </div>
          )}
        </div>

        {/* 高级选项 */}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            高级选项
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 8, paddingLeft: 16 }}>
              <div style={labelStyle}>来源类型（手动覆盖自动识别）</div>
              <select
                value={typeOverride} onChange={e => setTypeOverride(e.target.value)}
                style={{ ...inputStyle, width: 'auto', marginBottom: 10 }}
              >
                <option value="">自动识别</option>
                <option value="github">GitHub</option>
                <option value="git">Git</option>
                <option value="url">URL</option>
                <option value="file">本地文件</option>
                <option value="directory">本地目录</option>
              </select>
              <div style={labelStyle}>分支 / Tag（GitHub / Git 用）</div>
              <input
                placeholder="main"
                value={ref} onChange={e => setRef(e.target.value)}
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)} />
                启动时自动刷新
              </label>
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 10, color: 'var(--danger, #e57373)', fontSize: 12, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        {/* 操作栏 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={ghostBtn}>取消</button>
          <button onClick={handleAdd} disabled={loading || !input.trim()} style={{ ...primaryBtn, opacity: (loading || !input.trim()) ? 0.5 : 1 }}>
            {loading ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
