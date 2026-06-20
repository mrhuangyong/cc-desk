// 右侧 matcher 编辑区：展示选中事件下的 matcher 块，支持增删 hook + 新增 matcher。
// 插件来源（isReadonly）整块只读。
import { useState } from 'react'
import type { HookMatcher, HookEntry } from '../../../main/claude-config'
import { HookEditDialog } from './HookEditDialog'
import { Pencil, Trash2 } from 'lucide-react'
import { Tooltip } from '../Tooltip'

interface Props {
  eventName: string
  matchers: HookMatcher[]
  isReadonly: boolean
  source: string
  onChange: (matchers: HookMatcher[]) => void
}

const iconBtn: React.CSSProperties = {
  padding: '3px 5px', fontSize: 12, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1,
}
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  marginBottom: 10, background: 'var(--bg)', overflow: 'hidden',
}
const typeBadge = (t: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 7px', borderRadius: 999,
  fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)',
  marginRight: 6,
})

export function HookMatcherList({ eventName, matchers, isReadonly, source, onChange }: Props) {
  const [editing, setEditing] = useState<{ mi: number; hi: number } | null>(null)

  const hookSummary = (h: HookEntry): string => {
    if (h.type === 'command') return h.command
    if (h.type === 'prompt') return h.prompt
    if (h.type === 'agent') return h.prompt
    if (h.type === 'http') return h.url
    return ''
  }

  const deleteHook = (mi: number, hi: number) => {
    const next = matchers.map((m, i) => {
      if (i !== mi) return m
      return { ...m, hooks: m.hooks.filter((_, j) => j !== hi) }
    }).filter(m => m.hooks.length > 0)
    onChange(next)
  }

  const saveHook = (entry: HookEntry) => {
    if (!editing) return
    const { mi, hi } = editing
    const next = matchers.map((m, i) => {
      if (i !== mi) return m
      const hooks = m.hooks.map((h, j) => j === hi ? entry : h)
      return { ...m, hooks }
    })
    onChange(next)
    setEditing(null)
  }

  const addHook = (mi: number) => {
    const newEntry: HookEntry = { type: 'command', command: '' }
    const next = matchers.map((m, i) => {
      if (i !== mi) return m
      return { ...m, hooks: [...m.hooks, newEntry] }
    })
    onChange(next)
    setEditing({ mi, hi: next[mi].hooks.length - 1 })
  }

  const addMatcher = () => {
    const newMatcher: HookMatcher = { matcher: '', hooks: [{ type: 'command', command: '' }] }
    onChange([...matchers, newMatcher])
    setEditing({ mi: matchers.length, hi: 0 })
  }

  const editingEntry = editing ? matchers[editing.mi]?.hooks[editing.hi] ?? null : null

  if (matchers.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
        {isReadonly ? '该事件无插件 hook' : '该事件尚未配置 hook'}
        {!isReadonly && (
          <div style={{ marginTop: 8 }}>
            <button onClick={addMatcher} style={{ padding: '6px 14px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'var(--accent-text)' }}>
              + 新建 Hook
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {matchers.map((m, mi) => (
        <div key={mi} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              matcher: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{m.matcher || '(全部)'}</span>
            </span>
            {isReadonly && <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 999 }}>{source}</span>}
          </div>
          <div style={{ padding: '4px 12px' }}>
            {m.hooks.map((h, hi) => (
              <div key={hi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: hi < m.hooks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={typeBadge(h.type)}>{h.type}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {hookSummary(h) || '(空)'}
                </span>
                {!isReadonly && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <Tooltip label="编辑"><button onClick={() => setEditing({ mi, hi })} style={iconBtn}><Pencil size={12} /></button></Tooltip>
                    <Tooltip label="删除"><button onClick={() => deleteHook(mi, hi)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={12} /></button></Tooltip>
                  </div>
                )}
              </div>
            ))}
            {!isReadonly && (
              <div style={{ padding: '6px 0' }}>
                <button onClick={() => addHook(mi)} style={{ padding: '3px 10px', fontSize: 11, cursor: 'pointer', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--text-muted)' }}>
                  + 添加 hook
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {!isReadonly && (
        <button onClick={addMatcher} style={{ padding: '6px 14px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--text-muted)' }}>
          + 新建 matcher
        </button>
      )}

      {editing && (
        <HookEditDialog
          entry={editingEntry}
          onSave={saveHook}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
