import { TabBar } from './TabBar'

export function RightPanel() {
  return (
    <div style={{
      width: 320, flexShrink: 0, background: 'var(--bg-elevated)',
      borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
    }}>
      <TabBar />
    </div>
  )
}
