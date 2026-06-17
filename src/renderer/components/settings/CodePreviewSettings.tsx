import { SettingsLayout } from './SettingsLayout'
import { SettingsCard } from './SettingsCard'
import { SettingsRow } from './SettingsRow'
import { Toggle } from './Toggle'
import { useStore } from '../../state/store'

const selectStyle: React.CSSProperties = { padding: '5px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }

const LIGHT_THEMES = ['GitHub Light', 'Solarized Light', 'One Light']
const DARK_THEMES = ['GitHub Dark', 'Dracula', 'Monokai', 'One Dark']

// 实时预览的代码内容
const PREVIEW_CODE = `const themePreview:
  ThemeConfig = {
  surface: "sidebar",
  accent: "#339CFF",
  contrast: 45,
};`

function PreviewBox({ title, badge, isDark, themeName }: { title: string; badge: string; isDark: boolean; themeName: string }) {
  return (
    <div style={{
      flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden',
      background: isDark ? '#0d1117' : '#ffffff'
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', borderBottom: `1px solid ${isDark ? '#21262d' : '#e5dfd2'}`,
        color: isDark ? '#8b949e' : '#8a7f70', fontSize: 12
      }}>
        <span>{title}</span>
        <span style={{
          padding: '2px 8px', borderRadius: 999, fontSize: 11,
          border: `1px solid ${isDark ? '#339CFF' : '#8a7f70'}`,
          color: isDark ? '#339CFF' : '#8a7f70'
        }}>{badge}</span>
      </div>
      <div style={{
        padding: '8px 12px', fontSize: 11,
        color: isDark ? '#8b949e' : '#8a7f70', borderBottom: `1px solid ${isDark ? '#21262d' : '#e5dfd2'}`
      }}>{themeName}</div>
      <pre style={{
        margin: 0, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 12,
        color: isDark ? '#c9d1d9' : '#3a3530', lineHeight: 1.6, whiteSpace: 'pre'
      }}>{PREVIEW_CODE}</pre>
    </div>
  )
}

export function CodePreviewSettings() {
  const { state, dispatch } = useStore()
  const cp = state.settings.codePreview
  // 持久化代码预览子对象
  const persist = (patch: Partial<typeof cp>) => {
    const next = { ...cp, ...patch }
    dispatch({ type: 'SET_SETTINGS', settings: { codePreview: next } })
    window.api?.settings.save({ codePreview: next })
  }

  return (
    <SettingsLayout title="代码预览">
      <SettingsCard>
        <SettingsRow title="浅色代码主题" desc="浅色模式下代码块使用的高亮主题。">
          <select value={cp.lightTheme} onChange={e => persist({ lightTheme: e.target.value })} style={selectStyle}>
            {LIGHT_THEMES.map(t => <option key={t}>{t}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow title="深色代码主题" desc="深色模式下代码块使用的高亮主题。">
          <select value={cp.darkTheme} onChange={e => persist({ darkTheme: e.target.value })} style={selectStyle}>
            {DARK_THEMES.map(t => <option key={t}>{t}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow title="显示行号" desc="在代码预览中显示每一行的行号。">
          <Toggle on={cp.showLineNumbers} onChange={v => persist({ showLineNumbers: v })} aria-label="显示行号" />
        </SettingsRow>
        <SettingsRow title="长行自动换行" desc="内容过长时在预览区域内自动换行。">
          <Toggle on={cp.wordWrap} onChange={v => persist({ wordWrap: v })} aria-label="长行自动换行" />
        </SettingsRow>
        <SettingsRow title="代码字号" desc="调整代码预览的默认字号。" noBorder>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <input
              type="range" min={10} max={20} value={cp.fontSize}
              onChange={e => persist({ fontSize: Number(e.target.value) })}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span style={{ minWidth: 20, textAlign: 'right' }}>{cp.fontSize}</span>
          </span>
        </SettingsRow>
      </SettingsCard>

      {/* 实时预览 */}
      <div>
        <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 6 }}>实时预览</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>
          右侧代码预览会按当前界面主题自动切换对应配色。
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <PreviewBox title="浅色预览" badge="当前生效" isDark={false} themeName={cp.lightTheme} />
          <PreviewBox title="深色预览" badge="深色" isDark={true} themeName={cp.darkTheme} />
        </div>
      </div>
    </SettingsLayout>
  )
}
