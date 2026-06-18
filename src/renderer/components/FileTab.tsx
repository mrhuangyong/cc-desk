import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '../state/store'
import { monacoThemeFor, monacoLanguageFor } from '../editor/monacoEnv'
import '../editor/monacoEnv'

export interface FileTabHandle {
  // 保存当前编辑器内容到磁盘；成功返回 true。供关闭确认流程调用。
  save: () => Promise<boolean>
}

interface Props {
  tabId: string
  filePath?: string
}

export const FileTab = forwardRef<FileTabHandle, Props>(function FileTab({ tabId, filePath }, ref) {
  const { state, dispatch } = useStore()
  const codePreview = state.settings.codePreview
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const contentRef = useRef<string>('')   // 保存时读取最新值，避免闭包过期

  // 加载文件
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api?.fs.readFile(filePath)
      .then(text => {
        if (cancelled) return
        setContent(text)
        contentRef.current = text
      })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filePath])

  // 保存实现
  const doSave = async (): Promise<boolean> => {
    if (!filePath) return false
    try {
      await window.api?.fs.writeFile(filePath, contentRef.current)
      dispatch({ type: 'TAB_DIRTY', tabId, dirty: false })
      setError(null)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      return false
    }
  }

  // 暴露 save 给父组件（关闭确认用）
  useImperativeHandle(ref, () => ({ save: doSave }), [filePath, tabId])

  const handleMount = (ed: editor.IStandaloneCodeEditor, monacoInstance: any) => {
    editorRef.current = ed
    // Cmd/Ctrl+S 保存：用 onMount 第二参数（monaco 实例）取 KeyMod/KeyCode，类型可靠
    monacoInstance?.editor?.addCommand(
      // eslint-disable-next-line no-bitwise
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
      () => { void doSave() }
    )
  }

  const handleChange = (value: string | undefined) => {
    const v = value ?? ''
    contentRef.current = v
    if (v !== content) {
      // 内容相对已保存版本有改动 → 置脏
      dispatch({ type: 'TAB_DIRTY', tabId, dirty: true })
    }
  }

  // 无文件 / 加载 / 错误态
  if (!filePath) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>(未指定文件)</div>
  }
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
  }
  if (error && !content) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{error}</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {error && (
        <div style={{ padding: '6px 10px', background: 'rgba(220,38,38,.12)', color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>
      )}
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
    </div>
  )
})
