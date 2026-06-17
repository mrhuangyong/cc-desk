// src/renderer/i18n/useI18n.ts
import { useStore } from '../state/store'
import { translate, type Lang } from './index'

// 翻译 hook：读取 settings.lang，返回 t(key) 函数。
// lang 变更时组件重渲染并使用新语言。
export function useI18n() {
  const { state } = useStore()
  // 桌面端界面语言用 settings.lang（zh-CN / en）；
  // 注意：Claude CLI 的 language 配置（Chinese/English）是另一处，这里只管 UI。
  const lang: Lang = state.settings.lang === 'en' ? 'en' : 'zh-CN'
  const t = (key: string) => translate(lang, key)
  return { lang, t }
}
