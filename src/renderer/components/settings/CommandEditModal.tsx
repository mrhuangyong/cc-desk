// 命令编辑/查看弹窗：Monaco + 防抖自动保存（自定义命令）或只读展示（插件/内置命令）。
import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X } from 'lucide-react'
import { useStore } from '../../state/store'
import { monacoThemeFor } from '../../editor/monacoEnv'
import type { ClaudeCommand } from '../../../main/claude-config'

type SaveStatus = 'saved' | 'saving' | 'unsaved'

const AUTOSAVE_DEBOUNCE = 1200

interface Props {
  command: ClaudeCommand
  onClose: () => void
}

export function CommandEditModal({ command, onClose }: Props) {
  const { state } = useStore()
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [error, setError] = useState<string | null>(null)

  const contentRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef<boolean>(false)

  const isEditable = command.source === 'user'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api?.cc.commands.getFile(command.source, command.name)
      .then((text: string) => {
        if (cancelled) return
        const v = text ?? ''
        setContent(v)
        contentRef.current = v
        setStatus('saved')
      })
      .catch((err: unknown) => { if (!cancelled) setError(String(err instanceof Error ? err.message : err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [command.source, command.name])

  const flush = async () => {
    if (!dirtyRef.current || !isEditable) return
    setStatus('saving')
    try {
      await window.api?.cc.commands.saveFile(command.name, contentRef.current)
      dirtyRef.current = false
      setStatus('saved')
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      setStatus('unsaved')
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (v: string | undefined) => {
    const next = v ?? ''
    setContent(next)
    contentRef.current = next
    if (!isEditable) return
    dirtyRef.current = true
    setStatus('unsaved')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE)
  }

  const theme = monacoThemeFor(state?.settings?.theme)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 720, maxWidth: '92vw', height: 520, maxHeight: '85vh',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{command.name}</span>
            <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              {command.source === 'builtin' ? '内置' : command.source === 'user' ? '自定义' : command.source}
            </span>
            {isEditable && (
              <span style={{ fontSize: 11, color: status === 'saved' ? 'var(--text-muted)' : status === 'saving' ? 'var(--accent)' : 'var(--danger, #e57373)' }}>
                {status === 'saved' ? '已保存' : status === 'saving' ? '保存中…' : '未保存'}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>
        ) : command.source === 'builtin' ? (
          <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
            <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 8 }}>{command.desc}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              类型：{command.builtinAction?.type || 'unknown'}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Editor
              value={content}
              language="markdown"
              theme={theme}
              onChange={handleChange}
              options={{ readOnly: !isEditable, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false }}
            />
          </div>
        )}

        {error && (
          <div style={{ padding: '4px 16px', color: 'var(--danger, #e57373)', fontSize: 11 }}>{error}</div>
        )}
      </div>
    </div>
  )
}
