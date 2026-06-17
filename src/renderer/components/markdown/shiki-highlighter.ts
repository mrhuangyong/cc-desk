// shiki 代码高亮单例 + CodePreviewSettings 主题名映射。
// 用 getSingletonHighlighter 复用同一实例，避免每个代码块重新加载语法/主题。
import { getSingletonHighlighter, type Highlighter } from 'shiki'

// CodePreviewSettings 里的展示名 → shiki 内置主题名（kebab-case）
export const THEME_NAME_MAP: Record<string, string> = {
  'GitHub Light': 'github-light',
  'Solarized Light': 'solarized-light',
  'One Light': 'one-light',
  'GitHub Dark': 'github-dark',
  'Dracula': 'dracula',
  'Monokai': 'monokai',
  'One Dark': 'one-dark-pro',
}

export function toShikiTheme(displayName: string): string {
  return THEME_NAME_MAP[displayName] || 'github-light'
}

// 常用语言（覆盖对话场景；未知语言会回退为纯文本）
const LANGS = [
  'javascript', 'typescript', 'jsx', 'tsx', 'json', 'bash', 'shell',
  'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp',
  'html', 'css', 'scss', 'vue', 'svelte',
  'markdown', 'yaml', 'toml', 'ini', 'sql', 'dockerfile',
  'diff', 'plaintext',
] as const

let _highlighterPromise: Promise<Highlighter> | null = null

// 按需把 light/dark 主题名传入，确保对应主题已加载。
// 同一 key 缓存最近一次创建的 highlighter；若主题名变化则重建。
let _loadedThemesKey = ''
export async function getHighlighter(lightTheme: string, darkTheme: string): Promise<Highlighter> {
  const key = `${lightTheme}|${darkTheme}`
  if (_highlighterPromise && _loadedThemesKey === key) return _highlighterPromise
  _loadedThemesKey = key
  _highlighterPromise = getSingletonHighlighter({
    themes: [lightTheme, darkTheme],
    langs: [...LANGS],
  })
  return _highlighterPromise
}

// 分别生成 light / dark 两套高亮 HTML，由 CodeBlock 包成两个 <pre>，
// 外层 CSS 按应用主题（data-theme）切换显隐。比 shiki 内置 dual-theme 变量机制更直观可控。
export interface HighlightedPair {
  light: string
  dark: string
}

export async function highlightCode(
  code: string,
  lang: string,
  lightTheme: string,
  darkTheme: string,
): Promise<HighlightedPair> {
  const hl = await getHighlighter(lightTheme, darkTheme)
  const loadedLangs = hl.getLoadedLanguages()
  const useLang = loadedLangs.includes(lang) ? lang : 'plaintext'
  const light = hl.codeToHtml(code, { lang: useLang, theme: lightTheme })
  const dark = hl.codeToHtml(code, { lang: useLang, theme: darkTheme })
  return { light, dark }
}
