import { useEffect } from 'react'
import { useStore } from '../state/store'

export function useTheme() {
  const { state, dispatch } = useStore()
  const { theme } = state

  // 应用到 document 并持久化
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cc-desk-theme', theme)
  }, [theme])

  const setTheme = (t: typeof theme) => {
    dispatch({ type: 'SET_THEME', theme: t })
    // 与设置页 applyTheme 一致：落盘到 electron-store（settings.get 为启动权威源），
    // 否则仅写 localStorage 会在刷新后被 settings 旧值覆盖，主题还原。
    window.api?.settings.save({ theme: t })
  }

  return { theme, setTheme }
}
