export function TextBlock({ text }: { text: string }) {
  if (!text) return null
  return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
}
