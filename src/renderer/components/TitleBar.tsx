import type { CSSProperties } from 'react'
import { ThemeSwitcher } from './ThemeSwitcher'

// WebkitAppRegion is an Electron/WebKit CSS property not present in React's
// CSSProperties. Define a local superset so the drag regions type-check.
type DragStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const drag: DragStyle = { WebkitAppRegion: 'drag' }
const noDrag: DragStyle = { WebkitAppRegion: 'no-drag' }

export function TitleBar({ projectName }: { projectName: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 32, padding: '0 12px',
      background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)',
      ...drag
    }}>
      <div style={{ display: 'flex', gap: 8, ...noDrag }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
      </div>
      <span style={{ flex: 1, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        {projectName}
      </span>
      <div style={{ display: 'flex', gap: 8, ...noDrag }}>
        <ThemeSwitcher />
        <button title="设置" style={{ fontSize: 14, padding: '4px 8px' }}>⚙</button>
      </div>
    </div>
  )
}
