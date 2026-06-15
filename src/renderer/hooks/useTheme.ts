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
  }

  return { theme, setTheme }
}
