// Hooks 设置：左侧分组事件列表 + 右侧 matcher 编辑区，顶部列表/JSON 双视图。
// 自定义 hooks 可增删改，插件来源 hooks 只读展示。
import { useEffect, useState, useMemo } from 'react'
import type { HooksFull, HookEventView, HookMatcher } from '../../../main/claude-config'
import { HookMatcherList } from './HookMatcherList'
import { Plus } from 'lucide-react'
import { Tooltip } from '../Tooltip'

const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
  marginRight: 4,
})
const groupLabelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, padding: '8px 10px 4px', fontWeight: 600 }
const eventRowStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '6px 10px', cursor: 'pointer', borderRadius: 'var(--radius)',
  background: selected ? 'var(--accent)' : 'transparent',
  color: selected ? 'var(--accent-text)' : 'var(--text)',
})
const badgeStyle: React.CSSProperties = { fontSize: 10, padding: '0 6px', borderRadius: 999, background: 'var(--bg-sidebar)', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' }
const topIconBtn: React.CSSProperties = { padding: '4px 8px', fontSize: 14, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1 }

const GROUP_LABELS: Record<string, string> = {
  tool: '工具', session: '会话', task: '任务', permission: '权限', system: '系统',
}
const GROUP_ORDER = ['tool', 'session', 'task', 'permission', 'system']

export function HooksSettings() {
  const [data, setData] = useState<HooksFull>({ custom: [], plugins: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'json'>('list')
  const [q, setQ] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const reload = () => {
    setLoading(true); setError(null)
    window.api?.cc?.hooks.get().then(d => {
      setData(d)
      window.api?.cc?.hooks.getJson().then(txt => setJsonText(txt))
      setLoading(false)
    }).catch(() => { setError('加载失败'); setLoading(false) })
  }
  useEffect(() => { reload() }, [])

  // 合并自定义 + 插件事件（同名事件合并 matchers）
  const allEvents = useMemo(() => {
    const map = new Map<string, HookEventView>()
    for (const ev of data.custom) {
      map.set(ev.eventName, { ...ev })
    }
    for (const ev of data.plugins) {
      const existing = map.get(ev.eventName)
      if (existing) {
        existing.matchers = [...existing.matchers, ...ev.matchers]
      } else {
        map.set(ev.eventName, { ...ev, matchers: [...ev.matchers] })
      }
    }
    return Array.from(map.values())
  }, [data])

  const groupedEvents = useMemo(() => {
    const filtered = allEvents.filter(e => e.eventName.toLowerCase().includes(q.toLowerCase()))
    const groups: Record<string, HookEventView[]> = {}
    for (const ev of filtered) {
      if (!groups[ev.group]) groups[ev.group] = []
      groups[ev.group].push(ev)
    }
    return groups
  }, [allEvents, q])

  const selectedDetail = selectedEvent ? allEvents.find(e => e.eventName === selectedEvent) : null
  const customMatchers = selectedEvent ? data.custom.find(e => e.eventName === selectedEvent)?.matchers ?? [] : []
  const pluginMatchers = selectedEvent ? data.plugins.filter(e => e.eventName === selectedEvent) : []

  const persistCustomHooks = (updatedCustom: HookEventView[]) => {
    const hooksObj: Record<string, any> = {}
    for (const ev of updatedCustom) {
      if (ev.matchers.length > 0) hooksObj[ev.eventName] = ev.matchers
    }
    window.api?.cc?.hooks.save(hooksObj).then(r => {
      if (!r.success) setError(r.errors.join('; '))
      else { setError(null); reload() }
    })
  }

  const onMatchersChange = (eventName: string, matchers: HookMatcher[]) => {
    const existing = data.custom.find(e => e.eventName === eventName)
    let updatedCustom: HookEventView[]
    if (existing) {
      updatedCustom = data.custom.map(ev =>
        ev.eventName === eventName ? { ...ev, matchers } : ev
      )
    } else if (matchers.length > 0) {
      updatedCustom = [...data.custom, { eventName, group: selectedDetail?.group ?? 'system', matchers, source: 'custom' as const, isReadonly: false }]
    } else {
      updatedCustom = data.custom
    }
    persistCustomHooks(updatedCustom)
  }

  const saveJson = async () => {
    const r = await window.api?.cc?.hooks.saveJson(jsonText)
    if (!r?.success) setJsonError(r?.errors.join('; ') ?? '保存失败')
    else { setJsonError(null); reload() }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>Hooks</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip label="新建"><button aria-label="新建 Hook" onClick={() => { setSelectedEvent(null); setView('list') }} style={topIconBtn}><Plus size={14} /></button></Tooltip>
        </div>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        读写 ~/.cc-desk/claude/settings.json 的 hooks 字段。管理 Claude 各生命周期事件的命令钩子。
      </div>

      <div style={{ display: 'flex', marginBottom: 14 }}>
        <button onClick={() => setView('list')} style={segBtn(view === 'list')}>列表</button>
        <button onClick={() => { setView('json'); setJsonError(null) }} style={segBtn(view === 'json')}>JSON</button>
      </div>

      {error && <div style={{ marginBottom: 10, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>}

      {view === 'list' && (
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ width: 280, flexShrink: 0 }}>
            <input placeholder="搜索事件..." value={q} onChange={e => setQ(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none', marginBottom: 8 }} />
            {loading && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>}
            {!loading && GROUP_ORDER.map(g => {
              const evs = groupedEvents[g] ?? []
              if (evs.length === 0) return null
              return (
                <div key={g}>
                  <div style={groupLabelStyle}>{GROUP_LABELS[g]}</div>
                  {evs.map(ev => {
                    const count = ev.matchers.reduce((sum, m) => sum + m.hooks.length, 0)
                    const isPluginOnly = ev.isReadonly
                    return (
                      <div key={ev.eventName} onClick={() => setSelectedEvent(ev.eventName)} style={eventRowStyle(selectedEvent === ev.eventName)}>
                        <span style={{ fontSize: 12, fontWeight: isPluginOnly ? 400 : 500, opacity: isPluginOnly ? 0.7 : 1 }}>{ev.eventName}</span>
                        <span style={badgeStyle}>{count}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {!selectedDetail && (
              <div style={{ padding: 40, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>选择左侧事件查看或编辑 hook 配置</div>
            )}
            {selectedDetail && (
              <>
                <div style={{ marginBottom: 10, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{selectedDetail.eventName}</div>
                <HookMatcherList
                  eventName={selectedEvent!}
                  matchers={customMatchers}
                  isReadonly={false}
                  source="custom"
                  onChange={(m) => onMatchersChange(selectedEvent!, m)}
                />
                {pluginMatchers.map(pm => (
                  <div key={pm.source}>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, margin: '12px 0 6px' }}>来自插件：{pm.source.replace('plugin:', '')}</div>
                    <HookMatcherList
                      eventName={selectedEvent!}
                      matchers={pm.matchers}
                      isReadonly={true}
                      source={pm.source}
                      onChange={() => {}}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {view === 'json' && (
        <>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setJsonError(null) }}
            spellCheck={false}
            style={{ width: '100%', minHeight: 400, padding: '10px', background: 'var(--bg-sidebar)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', resize: 'vertical' }}
          />
          {jsonError && <div style={{ marginTop: 6, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{jsonError}</div>}
          <div style={{ marginTop: 10 }}>
            <button onClick={saveJson} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'var(--accent-text)' }}>保存</button>
          </div>
        </>
      )}
    </div>
  )
}
