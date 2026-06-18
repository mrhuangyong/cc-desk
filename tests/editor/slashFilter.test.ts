import { describe, it, expect } from 'vitest'
import { filterSlashItems } from '../../src/renderer/editor/slashFilter'
import type { SlashMenuItem } from '../../src/renderer/editor/types'

const ITEMS: SlashMenuItem[] = [
  { kind: 'command', id: 'user:review', name: '/review', desc: 'PR 审查' },
  { kind: 'command', id: 'user:commit', name: '/commit', desc: '提交' },
  { kind: 'skill', id: 's:frontend-design', name: 'frontend-design', desc: '创建前端界面' },
  { kind: 'skill', id: 's:code-review', name: 'code-review', desc: '代码审查' },
]

describe('filterSlashItems', () => {
  it('空查询返回全部，命令在前技能在后', () => {
    const r = filterSlashItems(ITEMS, '')
    expect(r.map(i => i.id)).toEqual(['user:review', 'user:commit', 's:frontend-design', 's:code-review'])
  })
  it('按 name 匹配（去掉前导 /）', () => {
    const r = filterSlashItems(ITEMS, 'rev')
    expect(r.map(i => i.id)).toEqual(['user:review', 's:code-review'])
  })
  it('按 desc 匹配', () => {
    const r = filterSlashItems(ITEMS, '审查')
    expect(r.map(i => i.id)).toEqual(['user:review', 's:code-review'])
  })
  it('匹配不区分大小写', () => {
    const r = filterSlashItems(ITEMS, 'FRONTEND')
    expect(r.map(i => i.id)).toEqual(['s:frontend-design'])
  })
  it('无匹配返回空数组', () => {
    expect(filterSlashItems(ITEMS, 'zzz')).toEqual([])
  })
  it('命令始终排在技能前面', () => {
    const r = filterSlashItems(ITEMS, 'e')
    // review/commit/frontend-design/code-review 都含 e，但命令在前
    expect(r[0].kind).toBe('command')
  })
})
