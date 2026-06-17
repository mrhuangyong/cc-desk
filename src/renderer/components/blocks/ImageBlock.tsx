export function ImageBlock({ source }: { source: string }) {
  if (!source) return null
  const src = source.startsWith('data:') || source.startsWith('http') ? source : `data:image/png;base64,${source}`
  return <img src={src} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />
}
