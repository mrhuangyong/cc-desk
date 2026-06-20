// 插件管理设置页：双 Tab（已安装 / 仓库）。
// 已安装 Tab：插件列表 + 启停 + 卸载。
// 仓库 Tab：仓库折叠卡片（浏览/安装插件）+ 搜索框双重上下文（空=仓库列表，有关键词=跨仓库搜索）。
import { useEffect, useState, useCallback } from 'react'
import type { ClaudePlugin } from '../../../main/claude-config'
import type { KnownMarketplace, PluginMarketplaceEntry, SearchResult } from '../../../main/marketplace-manager'
import { Toggle } from './Toggle'
import { AddMarketplaceDialog } from './AddMarketplaceDialog'
import { PluginDetailDialog } from './PluginDetailDialog'
import { RefreshCw, Plug, Trash2, Plus, FileText, Download, ChevronRight, ChevronDown } from 'lucide-react'
import { Tooltip } from '../Tooltip'

// ---- 样式常量 ----
const iconBtn: React.CSSProperties = {
  padding: '4px 6px', fontSize: 13, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1,
}
const topIconBtn: React.CSSProperties = { ...iconBtn, fontSize: 14, padding: '4px 8px' }
const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
  marginRight: 4,
})
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'transparent', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', outline: 'none', marginBottom: 14,
}

export function PluginSettings() {
  const [tab, setTab] = useState<'installed' | 'marketplaces'>('installed')

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>插件管理</h2>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        仓库与插件均存储在 ~/.cc-desk/claude/plugins/，SDK 运行时自动加载。
      </div>

      {/* Tab 栏 */}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <button style={segBtn(tab === 'installed')} onClick={() => setTab('installed')}>已安装</button>
        <button style={segBtn(tab === 'marketplaces')} onClick={() => setTab('marketplaces')}>仓库</button>
      </div>

      {tab === 'installed' && <InstalledTab />}
      {tab === 'marketplaces' && <MarketplacesTab />}
    </div>
  )
}

// ---- 已安装 Tab ----

function InstalledTab() {
  const [plugins, setPlugins] = useState<ClaudePlugin[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    window.api?.cc?.plugins.get().then(list => { setPlugins(list); setLoading(false) })
  }, [])
  useEffect(() => { reload() }, [reload])

  const filtered = plugins.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) || p.desc.toLowerCase().includes(q.toLowerCase())
  )

  const toggle = async (id: string) => {
    const p = plugins.find(x => x.id === id)
    if (!p) return
    await window.api?.cc?.plugins.setEnabled(id, !p.enabled)
    reload()
  }

  const handleUninstall = async () => {
    if (!confirmUninstall) return
    await window.api?.cc?.plugins.uninstall(confirmUninstall)
    setConfirmUninstall(null)
    reload()
  }

  return (
    <div>
      <input placeholder="搜索已安装插件..." value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>}
        {!loading && filtered.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配插件</div>}
        {filtered.map(p => (
          <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', boxShadow: 'var(--shadow-float)', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0, display: 'inline-flex' }}><Plug size={16} /></span>
              <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{p.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{p.version}</span>
              <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{p.source}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Toggle on={p.enabled} onChange={() => toggle(p.id)} aria-label={`${p.enabled ? '停用' : '启用'} ${p.name}`} />
                <Tooltip label="卸载">
                  <button onClick={() => setConfirmUninstall(p.id)} style={iconBtn}><Trash2 size={14} /></button>
                </Tooltip>
              </span>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, marginBottom: 8, paddingLeft: 26 }}>{p.desc}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, paddingLeft: 26 }}>{p.skills} 技能 · {p.commands} 命令 · {p.mcps} MCP</div>
          </div>
        ))}
      </div>

      {/* 卸载确认框 */}
      {confirmUninstall && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmUninstall(null)}>
          <div style={{ width: 400, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 16 }}>
              确定卸载「{confirmUninstall.split('@')[0]}」？将删除插件文件并移除配置。
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmUninstall(null)} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}>取消</button>
              <button onClick={handleUninstall} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--danger, #e57373)', color: '#fff' }}>卸载</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 仓库 Tab ----

function MarketplacesTab() {
  const [q, setQ] = useState('')
  const [marketplaces, setMarketplaces] = useState<KnownMarketplace[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [detailEntry, setDetailEntry] = useState<{ entry: PluginMarketplaceEntry; marketplace: string; installed: boolean } | null>(null)
  const [refreshingName, setRefreshingName] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ name: string; cascaded: string[] } | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    window.api?.cc?.marketplaces.get().then(list => { setMarketplaces(list); setLoading(false) })
  }, [])
  useEffect(() => { reload() }, [reload])

  // 搜索：空输入时清空搜索结果，有关键词时跨仓库搜索（防抖 300ms）
  useEffect(() => {
    if (!q.trim()) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    const timer = setTimeout(async () => {
      const results = await window.api?.cc?.marketplaces.search(q.trim())
      setSearchResults(results || [])
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  const handleRefresh = async (name: string) => {
    setRefreshingName(name)
    try { await window.api?.cc?.marketplaces.refresh(name) } catch {}
    setRefreshingName(null)
    reload()
  }
  const handleRefreshAll = async () => {
    for (const m of marketplaces) {
      setRefreshingName(m.name)
      try { await window.api?.cc?.marketplaces.refresh(m.name) } catch {}
    }
    setRefreshingName(null)
    reload()
  }
  const handleRemove = async () => {
    if (!confirmRemove) return
    await window.api?.cc?.marketplaces.remove(confirmRemove.name)
    setConfirmRemove(null)
    reload()
  }
  const handleSetAutoUpdate = async (name: string, enabled: boolean) => {
    await window.api?.cc?.marketplaces.setAutoUpdate(name, enabled)
    reload()
  }

  const showSearch = q.trim().length > 0

  return (
    <div>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={primaryBtn} onClick={() => setShowAdd(true)}><Plus size={14} /> 添加仓库</button>
        <Tooltip label="刷新全部仓库">
          <button style={topIconBtn} onClick={handleRefreshAll}><RefreshCw size={14} /></button>
        </Tooltip>
      </div>

      {/* 搜索框（双重上下文） */}
      <input
        placeholder="搜索仓库或插件..."
        value={q} onChange={e => setQ(e.target.value)}
        style={inputStyle}
      />
      {showSearch && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          {searching ? '搜索中...' : `在 ${marketplaces.length} 个仓库中搜索，${searchResults.length} 个结果`}
        </div>
      )}

      {/* 搜索结果视图 */}
      {showSearch && !searching && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {searchResults.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配插件</div>}
          {searchResults.map((r, i) => (
            <PluginRow
              key={`${r.pluginName}@${r.marketplace}-${i}`}
              name={r.pluginName} version={r.version} desc={r.description}
              marketplaceName={r.marketplace}
              installed={r.installed}
              onDetail={async () => {
                const plugins = await window.api?.cc?.marketplaces.getPlugins(r.marketplace)
                const entry = plugins?.find((p: PluginMarketplaceEntry) => p.name === r.pluginName)
                if (entry) setDetailEntry({ entry, marketplace: r.marketplace, installed: r.installed })
              }}
              onInstalled={reload}
            />
          ))}
        </div>
      )}

      {/* 仓库列表视图（空搜索时） */}
      {!showSearch && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>}
          {!loading && marketplaces.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>尚未添加任何仓库</div>}
          {!loading && marketplaces.map((m, idx) => (
            <MarketplaceCard
              key={idx}
              mkt={m}
              expanded={expanded === `${idx}`}
              refreshing={refreshingName === m.name}
              onToggle={() => setExpanded(expanded === `${idx}` ? null : `${idx}`)}
              onRefresh={() => handleRefresh(m.name)}
              onRemove={async () => {
                const installed = await window.api?.cc?.plugins.get()
                const cascaded = installed?.filter(p => p.id.endsWith(`@${m.name}`)).map(p => p.name) || []
                setConfirmRemove({ name: m.name, cascaded })
              }}
              onSetAutoUpdate={(en) => handleSetAutoUpdate(m.name, en)}
              onDetail={setDetailEntry}
            />
          ))}
        </div>
      )}

      {showAdd && <AddMarketplaceDialog onAdded={reload} onClose={() => setShowAdd(false)} />}

      {detailEntry && (
        <PluginDetailDialog
          entry={detailEntry.entry}
          marketplaceName={detailEntry.marketplace}
          installed={detailEntry.installed}
          onInstalled={reload}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {/* 删除仓库确认框 */}
      {confirmRemove && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmRemove(null)}>
          <div style={{ width: 420, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: 20, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 12 }}>
              确定删除仓库「{confirmRemove.name}」？
            </div>
            {confirmRemove.cascaded.length > 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
                将同时卸载从此仓库安装的 {confirmRemove.cascaded.length} 个插件：
                {confirmRemove.cascaded.map(p => <div key={p} style={{ paddingLeft: 12 }}>• {p}</div>)}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
                未发现从此仓库安装的插件。
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmRemove(null)} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}>取消</button>
              <button onClick={handleRemove} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--danger, #e57373)', color: '#fff' }}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 仓库卡片 ----

function MarketplaceCard({ mkt, expanded, refreshing, onToggle, onRefresh, onRemove, onSetAutoUpdate, onDetail }: {
  mkt: KnownMarketplace
  expanded: boolean
  refreshing: boolean
  onToggle: () => void
  onRefresh: () => void
  onRemove: () => void
  onSetAutoUpdate: (enabled: boolean) => void
  onDetail: (d: { entry: PluginMarketplaceEntry; marketplace: string; installed: boolean }) => void
}) {
  const [plugins, setPlugins] = useState<PluginMarketplaceEntry[]>([])
  const [loadingPlugins, setLoadingPlugins] = useState(false)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())

  // 展开时加载插件列表 + 已安装状态
  useEffect(() => {
    if (!expanded) return
    setLoadingPlugins(true)
    Promise.all([
      window.api?.cc?.marketplaces.getPlugins(mkt.name),
      window.api?.cc?.plugins.get(),
    ]).then(([list, installed]) => {
      setPlugins(list || [])
      const ids = new Set((installed || []).map((p: ClaudePlugin) => p.id))
      setInstalledIds(ids)
    }).catch(() => setPlugins([]))
      .finally(() => setLoadingPlugins(false))
  }, [expanded, mkt.name])

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', boxShadow: 'var(--shadow-float)' }}>
      {/* 卡片头 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer' }} onClick={onToggle}>
        <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{mkt.name}</span>
        <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{mkt.source.source}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
          <Tooltip label={mkt.autoUpdate ? '自动更新已开启' : '自动更新已关闭'}>
            <Toggle on={mkt.autoUpdate ?? false} onChange={onSetAutoUpdate} />
          </Tooltip>
          <Tooltip label="刷新">
            <button onClick={onRefresh} style={iconBtn}>
              <RefreshCw size={14} className={refreshing ? 'cc-spin' : ''} />
            </button>
          </Tooltip>
          <Tooltip label="删除仓库">
            <button onClick={onRemove} style={iconBtn}><Trash2 size={14} /></button>
          </Tooltip>
        </span>
      </div>
      {/* 展开内容 */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            更新于 {mkt.lastUpdated ? new Date(mkt.lastUpdated).toLocaleString() : '未知'}
          </div>
          {loadingPlugins && <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 12 }}>加载插件列表...</div>}
          {!loadingPlugins && plugins.length === 0 && <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 12 }}>此仓库无插件</div>}
          {!loadingPlugins && plugins.map((entry, i) => (
            <PluginRow
              key={`${entry.name}-${i}`}
              name={entry.name} version={entry.version || 'unknown'} desc={entry.description || ''}
              marketplaceName={mkt.name}
              installed={installedIds.has(`${entry.name}@${mkt.name}`)}
              onDetail={() => onDetail({ entry, marketplace: mkt.name, installed: installedIds.has(`${entry.name}@${mkt.name}`) })}
              onInstalled={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- 插件行（搜索结果和仓库展开共用） ----

function PluginRow({ name, version, desc, marketplaceName, installed, onDetail, onInstalled }: {
  name: string
  version: string
  desc: string
  marketplaceName: string
  installed: boolean
  onDetail: () => void
  onInstalled: () => void
}) {
  const [nowInstalled, setNowInstalled] = useState(installed)
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await window.api?.cc?.plugins.install(`${name}@${marketplaceName}`)
      setNowInstalled(true)
      onInstalled()
    } catch {}
    setInstalling(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>v{version}</span>
          <span style={{ padding: '0px 6px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{marketplaceName}</span>
        </div>
        {desc && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Tooltip label="详情">
          <button onClick={onDetail} style={iconBtn}><FileText size={13} /></button>
        </Tooltip>
        {!nowInstalled ? (
          <Tooltip label="安装">
            <button onClick={handleInstall} disabled={installing} style={{ ...iconBtn, opacity: installing ? 0.5 : 1 }}>
              <Download size={13} />
            </button>
          </Tooltip>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>已安装</span>
        )}
      </div>
    </div>
  )
}
