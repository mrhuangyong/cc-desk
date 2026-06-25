import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type MonacoNS from 'monaco-editor'
import { Eye, Pencil } from 'lucide-react'
import { useStore } from '../state/store'
import { monacoThemeFor, monacoLanguageFor } from '../editor/monacoEnv'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'

export interface FileEditorPaneHandle {
  save: () => Promise<boolean>
}

interface Props {
  filePath?: string
  tabId: string
}

function isMarkdown(filePath?: string): boolean {
  if (!filePath) return false
  return /\.(md|markdown|mdown|mkd)$/i.test(filePath)
}

export const FileEditorPane = forwardRef<FileEditorPaneHandle, Props>(function FileEditorPane({ filePath, tabId }, ref) {
  const { state, dispatch } = useStore()
  const codePreview = state.settings.codePreview
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>(() => isMarkdown(filePath) ? 'preview' : 'edit')
  const contentRef = useRef<string>('')
  const loadedRef = useRef<string>('')
  const tabIdRef = useRef<string>(tabId)
  const filePathRef = useRef<string | undefined>(filePath)
  useEffect(() => { tabIdRef.current = tabId }, [tabId])
  useEffect(() => { filePathRef.current = filePath }, [filePath])

  // 加载文件
  useEffect(() => {
    if (!filePath) { setContent(''); loadedRef.current = ''; contentRef.current = ''; return }
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api?.fs.readFile(filePath)
      .then(text => {
        if (cancelled) return
        setContent(text)
        contentRef.current = text
        loadedRef.current = text
      })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filePath])

  const doSave = async (): Promise<boolean> => {
    const fp = filePathRef.current
    if (!fp) return false
    try {
      await window.api?.fs.writeFile(fp, contentRef.current)
      loadedRef.current = contentRef.current
      dispatch({ type: 'TAB_DIRTY', tabId: tabIdRef.current, dirty: false })
      setError(null)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      return false
    }
  }

  useImperativeHandle(ref, () => ({ save: doSave }), [])

  const handleMount = (ed: editor.IStandaloneCodeEditor, monacoInstance: typeof MonacoNS) => {
    const KeyMod = monacoInstance.KeyMod
    const KeyCode = monacoInstance.KeyCode
    ed.addCommand(
      // eslint-disable-next-line no-bitwise
      KeyMod.CtrlCmd | KeyCode.KeyS,
      () => { void doSave() }
    )
  }

  const handleChange = (value: string | undefined) => {
    const v = value ?? ''
    contentRef.current = v
    setContent(v)
    dispatch({ type: 'TAB_DIRTY', tabId: tabIdRef.current, dirty: v !== loadedRef.current })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void doSave()
    }
  }

  if (!filePath) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>选择一个文件</div>
  }
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
  }
  if (error && !content) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{error}</div>
  }

  const showMdToggle = isMarkdown(filePath)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 }} onKeyDown={onKeyDown}>
      {error && (
        <div style={{ padding: '6px 10px', background: 'rgba(220,38,38,.12)', color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>
      )}
      {showMdToggle && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => setViewMode(m => m === 'preview' ? 'edit' : 'preview')}
            title={viewMode === 'preview' ? '切换到编辑' : '切换到预览'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)' }}
          >
            {viewMode === 'preview' ? <Pencil size={13} /> : <Eye size={13} />}
            {viewMode === 'preview' ? '编辑' : '预览'}
          </button>
        </div>
      )}
      {showMdToggle && viewMode === 'preview' ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 12, minHeight: 0 }}>
          <MarkdownRenderer text={content} />
        </div>
      ) : (
        <Editor
          language={monacoLanguageFor(filePath)}
          theme={monacoThemeFor(state.theme)}
          value={content}
          onChange={handleChange}
          onMount={handleMount}
          options={{
            fontSize: codePreview.fontSize,
            wordWrap: codePreview.wordWrap ? 'on' : 'off',
            lineNumbers: codePreview.showLineNumbers ? 'on' : 'off',
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
        />
      )}
    </div>
  )
})
