import { useStore } from '../../state/store'
import { SettingsLayout } from './SettingsLayout'

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', color: 'var(--text)', borderBottom: '1px solid var(--border)' }

export function GeneralSettings() {
  const { state, dispatch } = useStore()
  return (
    <SettingsLayout title="常规">
      <label style={rowStyle}>
        <span>主题</span>
        <select value={state.theme} onChange={e => dispatch({ type: 'SET_THEME', theme: e.target.value as never })}>
          <option value="dark-warm">暖色暗夜</option>
          <option value="dark-cool">冷峻深空</option>
          <option value="light-editorial">纸感明亮</option>
          <option value="dark-acid">酸性极客</option>
        </select>
      </label>
      <label style={rowStyle}><span>语言</span><select><option>简体中文</option><option>English</option></select></label>
      <label style={rowStyle}><span>开机自启</span><input type="checkbox" /></label>
    </SettingsLayout>
  )
}
