import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type MonacoNS from 'monaco-editor'
import { useStore } from '../state/store'
import { monacoThemeFor, monacoLanguageFor } from '../editor/monacoEnv'

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
  const contentRef = useRef<string>('')   // 编辑器当前值，保存时读取，避免闭包过期
  const loadedRef = useRef<string>('')    // 上次落盘（或加载）的内容，作为脏标基准
  // tabId / filePath 同步到 ref：Cmd+S 在挂载时只注册一次，回调通过 ref 读最新值
  const tabIdRef = useRef<string>(tabId)
  const filePathRef = useRef<string | undefined>(filePath)
  useEffect(() => { tabIdRef.current = tabId }, [tabId])
  useEffect(() => { filePathRef.current = filePath }, [filePath])

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
        loadedRef.current = text
      })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filePath])

  // 保存实现：读 ref 里的最新路径/内容，挂载期注册的 Cmd+S 调到此处也不会陈旧
  const doSave = async (): Promise<boolean> => {
    const fp = filePathRef.current
    if (!fp) return false
    try {
      await window.api?.fs.writeFile(fp, contentRef.current)
      loadedRef.current = contentRef.current   // 重置脏标基准
      dispatch({ type: 'TAB_DIRTY', tabId: tabIdRef.current, dirty: false })
      setError(null)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      return false
    }
  }

  // 暴露 save 给父组件（关闭确认用）；doSave 只读 ref，deps 可为空
  useImperativeHandle(ref, () => ({ save: doSave }), [])

  const handleMount = (ed: editor.IStandaloneCodeEditor, monacoInstance: typeof MonacoNS) => {
    // Cmd/Ctrl+S 保存：用 onMount 第二参数（monaco 实例）取 KeyMod/KeyCode，类型可靠
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
    // 与已落盘内容比较，决定脏标
    dispatch({ type: 'TAB_DIRTY', tabId: tabIdRef.current, dirty: v !== loadedRef.current })
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
