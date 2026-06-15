export function TerminalTab() {
  return (
    <div style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, overflow: 'auto' }}>
      <div style={{ color: 'var(--accent)' }}>$ npm run dev</div>
      <div style={{ color: 'var(--text-muted)' }}>&gt; cc-desk@0.0.0 dev</div>
      <div style={{ color: 'var(--text-muted)' }}>&gt; vite</div>
      <div style={{ color: 'var(--text)' }}>  VITE ready in 320 ms</div>
      <div style={{ color: 'var(--text)' }}>  ➜  Local: http://localhost:5173/</div>
      <div style={{ marginTop: 8, color: 'var(--accent)' }}>$<span style={{ display: 'inline-block', width: 8, height: 14, background: 'var(--accent)', marginLeft: 4, verticalAlign: 'middle' }} /></div>
    </div>
  )
}
