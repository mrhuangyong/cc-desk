import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type MonacoNS from 'monaco-editor'
import { X } from 'lucide-react'
import { useStore } from '../../state/store'
import { monacoThemeFor } from '../../editor/monacoEnv'
import type { ClaudeSkill } from '../../../main/claude-config'

type SaveStatus = 'saved' | 'saving' | 'unsaved'

const AUTOSAVE_DEBOUNCE = 1200

interface Props {
  skill: ClaudeSkill
  onClose: () => void
}

export function SkillModal({ skill, onClose }: Props) {
  const { state } = useStore()
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [error, setError] = useState<string | null>(null)

  const contentRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef<boolean>(false)

  // 拉取 SKILL.md 全文
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api?.cc.skills.getFile(skill.id)
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
  }, [skill.id])

  // 写盘
  const flush = async () => {
    if (!dirtyRef.current) return
    setStatus('saving')
    try {
      await window.api?.cc.skills.saveFile(skill.id, contentRef.current)
      dirtyRef.current = false
      setStatus('saved')
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      setStatus('unsaved')
    }
  }

  // 卸载（关闭弹窗）兜底 flush
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const scheduleSave = (value: string) => {
    contentRef.current = value
    dirtyRef.current = true
    setStatus('unsaved')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flush() }, AUTOSAVE_DEBOUNCE)
  }

  const handleChange = (value: string | undefined) => {
    const v = value ?? ''
    setContent(v)
    scheduleSave(v)
  }

  const handleMount = (ed: editor.IStandaloneCodeEditor, _m: typeof MonacoNS) => {
    ed.onDidBlurEditorWidget(() => { void flush() })
  }

  const statusText = status === 'saved' ? '已保存' : status === 'saving' ? '保存中…' : '未保存'
  const statusColor = status === 'unsaved' ? 'var(--accent, #2563eb)' : 'var(--text-muted)'
  const canManualSave = status === 'unsaved'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(880px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-float)', overflow: 'hidden'
        }}
      >
        {/* 标题栏 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{skill.name}</span>
              <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{skill.scope}</span>
              <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{skill.source}</span>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.path}</div>
          </div>
          <button
            onClick={onClose}
            title="关闭"
            style={{ flexShrink: 0, padding: 4, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', display: 'inline-flex' }}
          ><X size={18} /></button>
        </div>

        {error && (
          <div style={{ padding: '6px 16px', background: 'rgba(220,38,38,.12)', color: 'var(--danger, #dc2626)', fontSize: 12, flexShrink: 0 }}>{error}</div>
        )}

        {/* 编辑器 */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>
          ) : (
            <Editor
              language="markdown"
              theme={monacoThemeFor(state.theme)}
              value={content}
              onChange={handleChange}
              onMount={handleMount}
              options={{
                fontSize: 13,
                wordWrap: 'on',
                lineNumbers: 'on',
                minimap: { enabled: false },
                automaticLayout: true,
                scrollBeyondLastLine: false,
              }}
            />
          )}
        </div>

        {/* 底部：保存状态 + 手动保存按钮 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0
        }}>
          <span style={{ fontSize: 12, color: statusColor }}>{statusText}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { void flush() }}
              disabled={!canManualSave}
              style={{
                padding: '5px 14px', fontSize: 12, cursor: canManualSave ? 'pointer' : 'default',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: canManualSave ? 'var(--accent)' : 'var(--bg-sidebar)',
                color: canManualSave ? 'var(--accent-text)' : 'var(--text-muted)'
              }}
            >保存</button>
          </div>
        </div>
      </div>
    </div>
  )
}
