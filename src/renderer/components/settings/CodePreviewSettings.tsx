import { useState } from 'react'
import { SettingsLayout } from './SettingsLayout'

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', color: 'var(--text)', borderBottom: '1px solid var(--border)' }

export function CodePreviewSettings() {
  const [theme, setTheme] = useState('github-dark')
  const [fontSize, setFontSize] = useState(13)
  return (
    <SettingsLayout title="代码预览">
      <label style={rowStyle}><span>代码主题</span>
        <select value={theme} onChange={e => setTheme(e.target.value)}>
          <option value="github-dark">GitHub Dark</option>
          <option value="github-light">GitHub Light</option>
          <option value="dracula">Dracula</option>
        </select>
      </label>
      <label style={rowStyle}><span>字号</span>
        <input type="number" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ width: 60 }} />
      </label>
      <label style={rowStyle}><span>显示行号</span><input type="checkbox" defaultChecked /></label>
    </SettingsLayout>
  )
}
