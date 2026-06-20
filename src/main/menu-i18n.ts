// 主进程菜单国际化：轻量字典，按 settings.lang 切换。
// macOS 原生 role 菜单（editMenu/windowMenu 等）默认跟随系统语言，
// 与 app 内部语言设置不一致，因此这里对 role 菜单也显式设置 label + 子菜单项。

export type Lang = 'zh-CN' | 'en'

const dict: Record<Lang, Record<string, string>> = {
  'zh-CN': {
    'menu.checkUpdate': '检查更新',
    'menu.reload': '刷新页面',
    'menu.devTools': '开发者工具',
    'menu.view': '视图',
    'menu.file': '文件',
    'menu.help': '帮助',
    'menu.edit': '编辑',
    'menu.window': '窗口',
    'menu.undo': '撤销',
    'menu.redo': '重做',
    'menu.cut': '剪切',
    'menu.copy': '复制',
    'menu.paste': '粘贴',
    'menu.selectAll': '全选',
    'menu.close': '关闭窗口',
    'menu.minimize': '最小化',
    'menu.about': '关于 cc-desk',
    'menu.quit': '退出 cc-desk',
    'menu.bringToFront': '全部置于顶层',
    'menu.zoom': '缩放',
  },
  'en': {
    'menu.checkUpdate': 'Check for Updates',
    'menu.reload': 'Reload Page',
    'menu.devTools': 'Developer Tools',
    'menu.view': 'View',
    'menu.file': 'File',
    'menu.help': 'Help',
    'menu.edit': 'Edit',
    'menu.window': 'Window',
    'menu.undo': 'Undo',
    'menu.redo': 'Redo',
    'menu.cut': 'Cut',
    'menu.copy': 'Copy',
    'menu.paste': 'Paste',
    'menu.selectAll': 'Select All',
    'menu.close': 'Close Window',
    'menu.minimize': 'Minimize',
    'menu.about': 'About cc-desk',
    'menu.quit': 'Quit cc-desk',
    'menu.bringToFront': 'Bring All to Front',
    'menu.zoom': 'Zoom',
  },
}

export function menuT(lang: string, key: string): string {
  const l: Lang = lang === 'en' ? 'en' : 'zh-CN'
  return dict[l][key] ?? key
}
