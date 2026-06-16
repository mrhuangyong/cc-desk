import { useEffect, useState } from 'react'

export function FileTab({ filePath }: { filePath?: string }) {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api?.fs.readFile(filePath)
      .then(text => { if (!cancelled) setContent(text) })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filePath])

  let display: string
  if (!filePath) {
    display = '(未指定文件)'
  } else if (loading) {
    display = '加载中…'
  } else if (error) {
    display = `读取失败：${error}`
  } else if (!content) {
    display = '(空文件)'
  } else {
    display = content
  }

  return (
    <div style={{ padding: 12, flex: 1, overflow: 'auto' }}>
      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', margin: 0 }}>
        {display}
      </pre>
    </div>
  )
}
