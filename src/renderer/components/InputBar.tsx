import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Paperclip, Check, AtSign, Hash, Slash, ShieldCheck, ChevronDown, ArrowUp, Square } from 'lucide-react'
import { useStore } from '../state/store'
import { mockModels } from '../state/mockData'
import { AttachmentChip } from './AttachmentChip'

type MenuId = 'attach' | 'permission' | 'model' | 'thinking'

const PERMISSIONS = ['变更前确认', '自动编辑', '计划模式', '完全访问']
const ATTACH_ITEMS: { icon: LucideIcon; label: string }[] = [
  { icon: Paperclip, label: '添加附件' },
  { icon: AtSign, label: '插入 @ 提及' },
  { icon: Hash, label: '插入 # 会话' },
  { icon: Slash, label: '插入 / 命令' },
]
const THINKINGS = ['minimal', 'standard', 'thorough']

export function InputBar() {
  const { state, dispatch } = useStore()
  const { text, attachment } = state.draft

  const [generating, setGenerating] = useState(false)
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [permission, setPermission] = useState('变更前确认')
  const [modelId, setModelId] = useState(mockModels[0]?.id ?? '')
  const [thinking, setThinking] = useState('standard')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载时清理定时器，避免 setState on unmounted 泄漏
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const canSend = text.trim().length > 0 || !!attachment

  const startGeneration = () => {
    setGenerating(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setGenerating(false), 3000)
  }

  const onSendClick = () => {
    if (generating) {
      // 点停止：中断生成
      if (timerRef.current) clearTimeout(timerRef.current)
      setGenerating(false)
      return
    }
    if (!canSend) return
    dispatch({ type: 'SEND_MESSAGE' })
    startGeneration()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !generating) {
      e.preventDefault()
      if (canSend) {
        dispatch({ type: 'SEND_MESSAGE' })
        startGeneration()
      }
    }
  }

  const toggleMenu = (id: MenuId) => setOpenMenu(prev => (prev === id ? null : id))

  const modelName = mockModels.find(m => m.id === modelId)?.name ?? '模型'

  // 通用下拉菜单容器
  const menuStyle: React.CSSProperties = {
    position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 10, boxShadow: 'var(--shadow-float)',
    padding: 5, minWidth: 180, zIndex: 100,
  }
  const itemStyle: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 6, color: 'var(--text)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    cursor: 'pointer', fontSize: 12,
  }
  const btnBase: React.CSSProperties = {
    padding: '5px 9px', borderRadius: 7, background: 'transparent',
    border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  }

  return (
    <div style={{
      background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-float)',
      // 不用 overflow:hidden——否则向上展开的下拉菜单会被裁掉
    }}>
      {/* 文本区 */}
      <div style={{ position: 'relative' }}>
        {attachment && (
          <div style={{ padding: '8px 16px 0' }}>
            <AttachmentChip
              attachment={attachment}
              onRemove={() => dispatch({ type: 'CLEAR_DRAFT_ATTACHMENT' })}
            />
          </div>
        )}
        <textarea
          value={text}
          onChange={e => dispatch({ type: 'SET_DRAFT_TEXT', text: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder="给 AI 发消息…"
          rows={1}
          style={{
            width: '100%', minHeight: 48, padding: '14px 16px 8px',
            border: 'none', outline: 'none', background: 'transparent',
            color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14,
            resize: 'none', boxSizing: 'border-box', display: 'block',
          }}
        />
      </div>

      {/* 控件栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 6, position: 'relative' }}>
        {/* 点外部关闭层 */}
        {openMenu && (
          <div
            onClick={() => setOpenMenu(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 90 }}
          />
        )}

        {/* 左下组 */}
        <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
          {/* 附件按钮 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => toggleMenu('attach')}
              style={{ ...btnBase, background: openMenu === 'attach' ? 'var(--bg-hover)' : undefined, color: openMenu === 'attach' ? 'var(--text)' : undefined }}
            >
              <Paperclip size={13} /><span>附件</span><ChevronDown size={10} />
            </button>
            {openMenu === 'attach' && (
              <div style={menuStyle}>
                {ATTACH_ITEMS.map(it => (
                  <div
                    key={it.label}
                    style={itemStyle}
                    onClick={() => setOpenMenu(null)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <it.icon size={13} />{it.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 权限按钮 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => toggleMenu('permission')}
              style={{ ...btnBase, background: 'var(--bg-hover)', color: 'var(--text)' }}
            >
              <ShieldCheck size={13} /><span>{permission}</span><ChevronDown size={10} />
            </button>
            {openMenu === 'permission' && (
              <div style={menuStyle}>
                {PERMISSIONS.map(p => (
                  <div
                    key={p}
                    style={{
                      ...itemStyle,
                      background: p === permission ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => { setPermission(p); setOpenMenu(null) }}
                    onMouseEnter={e => { if (p !== permission) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (p !== permission) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>{p}</span>
                    {p === permission && <Check size={13} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右下组 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {/* 模型按钮 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => toggleMenu('model')}
              style={{ ...btnBase, background: openMenu === 'model' ? 'var(--bg-hover)' : undefined, color: openMenu === 'model' ? 'var(--text)' : undefined }}
            >
              <span>{modelName}</span><ChevronDown size={10} />
            </button>
            {openMenu === 'model' && (
              <div style={{ ...menuStyle, minWidth: 200 }}>
                {mockModels.map(m => (
                  <div
                    key={m.id}
                    style={{
                      ...itemStyle,
                      background: m.id === modelId ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => { setModelId(m.id); setOpenMenu(null) }}
                    onMouseEnter={e => { if (m.id !== modelId) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (m.id !== modelId) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>{m.name}</span>
                    {m.id === modelId && <Check size={13} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 思考强度按钮 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => toggleMenu('thinking')}
              style={{ ...btnBase, background: openMenu === 'thinking' ? 'var(--bg-hover)' : undefined, color: openMenu === 'thinking' ? 'var(--text)' : undefined }}
            >
              <span>思考:{thinking}</span><ChevronDown size={10} />
            </button>
            {openMenu === 'thinking' && (
              <div style={menuStyle}>
                {THINKINGS.map(t => (
                  <div
                    key={t}
                    style={{
                      ...itemStyle,
                      background: t === thinking ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => { setThinking(t); setOpenMenu(null) }}
                    onMouseEnter={e => { if (t !== thinking) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (t !== thinking) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>{t}</span>
                    {t === thinking && <Check size={13} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 发送钮三态 */}
          <button
            onClick={onSendClick}
            aria-label={generating ? '停止' : '发送'}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: generating || canSend ? 'var(--accent)' : 'var(--bg-hover)',
              color: generating || canSend ? 'var(--accent-text)' : 'var(--text-faint)',
              border: 'none', cursor: generating || canSend ? 'pointer' : 'not-allowed',
              padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, lineHeight: 1,
            }}
          >
            {generating ? <Square size={12} /> : <ArrowUp size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
