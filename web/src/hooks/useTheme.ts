// web/src/hooks/useTheme.ts
// 主题切换：亮色（默认）/ 暗色。持久化到 localStorage，跟随系统可选。
//
// 用 data-theme 属性挂在 <html> 上，CSS 变量据 [data-theme="light"|"dark"] 切换。
// 默认 light（按需求）。首次无存储时取 light，不跟随系统（避免首屏闪烁且需求明确要默认亮色）。
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'ccdesk.theme'

function applyTheme(t: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', t)
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof localStorage === 'undefined') return 'light'
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'dark' ? 'dark' : 'light' // 默认 light，未知值回退 light
  })

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* 隐私模式可能禁写 */ }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  return { theme, toggle }
}
