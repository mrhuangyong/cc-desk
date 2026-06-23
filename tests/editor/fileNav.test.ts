import { describe, it, expect } from 'vitest'
import { fuzzyMatch, searchFlatFiles } from '../../src/renderer/editor/fileNav'

// listDir / filterFileItems 的测试已随其删除移除（@ 菜单改用 VSCode 式扁平搜索，
// 树状逐层导航逻辑已废弃，见 fileNav.ts）。

describe('fuzzyMatch', () => {
  it('空 query 返回空数组（全匹配）', () => {
    expect(fuzzyMatch('anything.ts', '')).toEqual([])
  })
  it('完整子序列匹配 → 返回匹配位置', () => {
    const pos = fuzzyMatch('PromptEditor.tsx', 'pe')
    expect(pos).not.toBeNull()
    // pe 匹配 'P'(0) 'r'... 实际匹配 P(0) 与第一个 e(2)？逐字符：P==p✓(0), r≠e, o≠e, m≠e, p≠e... 第一个 e 在 index 4? 'PromptEditor' P-r-o-m-p-t-E-d-i-t-o-r
    // 小写化后 'prompteditor.tsx'，查 'pe'：p(0)✓，e 在 index 5（prompt→p-r-o-m-p-t-e）。
    expect(pos![0]).toBe(0)
  })
  it('大小写不敏感', () => {
    expect(fuzzyMatch('README.md', 'readme')).not.toBeNull()
    expect(fuzzyMatch('readme.md', 'README')).not.toBeNull()
  })
  it('不匹配（query 含 path 没有的字符）→ null', () => {
    expect(fuzzyMatch('hello.ts', 'xyz')).toBeNull()
  })
  it('query 比 path 长 → null', () => {
    expect(fuzzyMatch('ab', 'abc')).toBeNull()
  })
  it('顺序必须一致（子序列，非集合）', () => {
    // 'ba' 在 'ab' 中作为子序列不存在（a 在 b 前）
    expect(fuzzyMatch('ab.ts', 'ba')).toBeNull()
  })
})

describe('searchFlatFiles', () => {
  const files = [
    'src/a.ts',
    'src/app.ts',
    'src/components/App.tsx',
    'lib/utils.ts',
    'docs/readme.md',
  ]
  it('空 query：按原序返回前 limit 个 + truncatedCount', () => {
    const r = searchFlatFiles(files, '', 2)
    expect(r.items.map(i => i.relPath)).toEqual(['src/a.ts', 'src/app.ts'])
    expect(r.truncatedCount).toBe(3)
  })
  it('空 query 且文件少于 limit：truncatedCount=0', () => {
    const r = searchFlatFiles(files, '', 100)
    expect(r.items.length).toBe(5)
    expect(r.truncatedCount).toBe(0)
  })
  it('fuzzy 过滤：仅返回匹配项', () => {
    const r = searchFlatFiles(files, 'app', 10)
    const names = r.items.map(i => i.relPath)
    expect(names).toEqual(expect.arrayContaining(['src/app.ts', 'src/components/App.tsx']))
    expect(names.some(n => n.includes('utils'))).toBe(false)
  })
  it('文件名部分匹配优先于路径深处匹配（fuzzyScore 文件名加分）', () => {
    // 'app' 在文件名（App.tsx）比分路径都加分。构造：文件名匹配 vs 仅路径匹配
    const r = searchFlatFiles(['apps/app.ts', 'src/app.tsx'], 'app', 10)
    // 两者文件名都含 app，但路径短的（src/app.tsx）应排前（路径长度惩罚）
    expect(r.items[0].relPath).toBe('src/app.tsx')
  })
  it('超过 limit 截断 + truncatedCount 正确', () => {
    const many = Array.from({ length: 10 }, (_, i) => `f${i}.ts`)  // 都含 'f'
    const r = searchFlatFiles(many, 'f', 3)
    expect(r.items.length).toBe(3)
    expect(r.truncatedCount).toBe(7)
  })
  it('无匹配 → 空结果', () => {
    const r = searchFlatFiles(files, 'zzzzz', 10)
    expect(r.items).toEqual([])
    expect(r.truncatedCount).toBe(0)
  })
})
