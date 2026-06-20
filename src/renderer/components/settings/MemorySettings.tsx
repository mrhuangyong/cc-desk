import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type MonacoNS from 'monaco-editor'
import { useStore } from '../../state/store'
import { useI18n } from '../../i18n/useI18n'
import { monacoThemeFor } from '../../editor/monacoEnv'
import { SettingsLayout } from './SettingsLayout'
import { SettingsCard } from './SettingsCard'

type SaveStatus = 'saved' | 'saving' | 'unsaved'

// 自动保存防抖时长（ms）：内容变更后静置此时长才写盘，避免高频写文件。
const AUTOSAVE_DEBOUNCE = 1200

export function MemorySettings() {
  const { state } = useStore()
  const { t } = useI18n()
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [error, setError] = useState<string | null>(null)

  const contentRef = useRef<string>('')        // 编辑器当前值，防抖回调读取，避免闭包过期
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef<boolean>(false)       // 是否有未保存内容，卸载/失焦 flush 时判断

  // 拉取初始内容
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api?.cc.memory.get()
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
  }, [])

  // 实际写盘
  const flush = async () => {
    if (!dirtyRef.current) return
    setStatus('saving')
    try {
      await window.api?.cc.memory.save(contentRef.current)
      dirtyRef.current = false
      setStatus('saved')
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      setStatus('unsaved')
    }
  }

  // 卸载时兜底 flush（切走菜单 / 关闭页面）
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void flush()
    }
    // flush 只读 ref，mount 时注册一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleMount = (ed: editor.IStandaloneCodeEditor, _monacoInstance: typeof MonacoNS) => {
    // 编辑器失焦立即 flush（兜底防抖窗口内的未保存内容）
    ed.onDidBlurEditorWidget(() => { void flush() })
  }

  if (loading) {
    return (
      <SettingsLayout title={t('settings.memory')}>
        <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
      </SettingsLayout>
    )
  }
  if (error && !content && contentRef.current === '') {
    return (
      <SettingsLayout title={t('settings.memory')}>
        <div style={{ padding: 12, color: 'var(--text-muted)' }}>{error}</div>
      </SettingsLayout>
    )
  }

  const statusText = status === 'saved' ? '已保存' : status === 'saving' ? '保存中…' : '未保存'
  const statusColor = status === 'saved' ? 'var(--text-muted)' : status === 'saving' ? 'var(--text-muted)' : 'var(--accent, #2563eb)'

  return (
    <SettingsLayout title={t('settings.memory')}>
      {/* 保存状态 + 说明 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          编辑全局记忆（~/.cc-desk/claude/CLAUDE.md），所有会话都会自动加载。
        </span>
        <span style={{ fontSize: 12, color: statusColor, flexShrink: 0 }}>{statusText}</span>
      </div>
      {error && (
        <div style={{ padding: '6px 10px', background: 'rgba(220,38,38,.12)', color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>
      )}
      {/* 编辑器：SettingsCard 包裹，撑满可用高度 */}
      <SettingsCard>
        <div style={{ height: 'calc(100vh - 260px)', minHeight: 240 }}>
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
        </div>
      </SettingsCard>
    </SettingsLayout>
  )
}
