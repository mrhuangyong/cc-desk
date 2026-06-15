import { mockFileContents } from '../state/mockData'

export function FileTab({ filePath }: { filePath?: string }) {
  const content = filePath ? (mockFileContents[filePath] ?? '(空文件)') : '(未指定文件)'
  return (
    <div style={{ padding: 12, flex: 1, overflow: 'auto' }}>
      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', margin: 0 }}>
        {content}
      </pre>
    </div>
  )
}
