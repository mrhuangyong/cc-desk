import { useState } from 'react'
import type { PluginMarketplaceEntry } from '../../../main/marketplace-manager'

interface Props {
  entry: PluginMarketplaceEntry
  marketplaceName: string
  installed: boolean
  onInstalled: () => void
  onClose: () => void
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

export function PluginDetailDialog({ entry, marketplaceName, installed, onInstalled, onClose }: Props) {
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nowInstalled, setNowInstalled] = useState(installed)

  const handleInstall = async () => {
    setInstalling(true)
    setError(null)
    try {
      const result = await window.api?.cc.plugins.install(`${entry.name}@${marketplaceName}`)
      if (result?.success) {
        setNowInstalled(true)
        onInstalled()
      } else {
        setError(result?.message || '安装失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 520, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-float)',
        padding: 20,
      }} onClick={e => e.stopPropagation()}>
        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ color: 'var(--text)', fontSize: 15, margin: 0, fontFamily: 'var(--font-mono)' }}>{entry.name}</h3>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>v{entry.version || 'unknown'}</span>
        </div>

        {/* 描述 */}
        {entry.description && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
            {entry.description}
          </div>
        )}

        {/* 来源 + 分类 */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>仓库：<span style={{ color: 'var(--text)' }}>{marketplaceName}</span></span>
          {entry.category && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>分类：<span style={{ color: 'var(--text)' }}>{entry.category}</span></span>}
        </div>

        {/* source 类型提示 */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          {typeof entry.source === 'string'
            ? `本地路径: ${entry.source}`
            : '远程 source'}
        </div>

        {/* tags */}
        {entry.tags && entry.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {entry.tags.map((tag: string) => (
              <span key={tag} style={{
                padding: '1px 7px', borderRadius: 999, fontSize: 10,
                border: '1px solid var(--border)', color: 'var(--text-muted)',
              }}>{tag}</span>
            ))}
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger, #e57373)', fontSize: 12, marginBottom: 10, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        {/* 操作栏 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={ghostBtn}>关闭</button>
          {!nowInstalled && (
            <button onClick={handleInstall} disabled={installing} style={{ ...primaryBtn, opacity: installing ? 0.5 : 1 }}>
              {installing ? '安装中...' : '安装'}
            </button>
          )}
          {nowInstalled && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>已安装</span>
          )}
        </div>
      </div>
    </div>
  )
}
