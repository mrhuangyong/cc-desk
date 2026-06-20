// 主进程菜单国际化：轻量字典，按 settings.lang 切换。
// Electron 原生 role（appMenu/editMenu/windowMenu/quit/close/minimize/about）
// 自动跟随系统语言本地化，这里只处理自定义 label。

export type Lang = 'zh-CN' | 'en'

const dict: Record<Lang, Record<string, string>> = {
  'zh-CN': {
    'menu.checkUpdate': '检查更新',
    'menu.reload': '刷新页面',
    'menu.devTools': '开发者工具',
    'menu.view': '视图',
    'menu.file': '文件',
    'menu.help': '帮助',
  },
  'en': {
    'menu.checkUpdate': 'Check for Updates',
    'menu.reload': 'Reload Page',
    'menu.devTools': 'Developer Tools',
    'menu.view': 'View',
    'menu.file': 'File',
    'menu.help': 'Help',
  },
}

export function menuT(lang: string, key: string): string {
  const l: Lang = lang === 'en' ? 'en' : 'zh-CN'
  return dict[l][key] ?? key
}
