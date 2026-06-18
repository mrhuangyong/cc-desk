// src/renderer/editor/slashFilter.ts
// / 菜单本地过滤：按 name/desc 子串匹配（不区分大小写），命令在前、技能在后。
import type { SlashMenuItem } from './types'

export function filterSlashItems(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  const q = query.replace(/^\//, '').trim().toLowerCase()
  const filtered = q === ''
    ? items
    : items.filter(it => {
        const name = it.name.replace(/^\//, '').toLowerCase()
        const desc = it.desc.toLowerCase()
        return name.includes(q) || desc.includes(q)
      })
  // 顺序：内置 → 命令 → 技能；各自保持原顺序
  return [
    ...filtered.filter(i => i.kind === 'builtin'),
    ...filtered.filter(i => i.kind === 'command'),
    ...filtered.filter(i => i.kind === 'skill'),
  ]
}
