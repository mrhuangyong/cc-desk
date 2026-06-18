import { describe, it, expect } from 'vitest'
import { listDir, filterFileItems } from '../../src/renderer/editor/fileNav'
import type { FileNode } from '../../src/renderer/types'

// 构造测试树：root 下有 components/(含 InputBar.tsx, store.tsx) 和 package.json
const TREE: FileNode[] = [
  { name: 'components', path: '/root/components', isDir: true, children: [
    { name: 'InputBar.tsx', path: '/root/components/InputBar.tsx', isDir: false },
    { name: 'store.tsx', path: '/root/components/store.tsx', isDir: false },
  ] },
  { name: 'package.json', path: '/root/package.json', isDir: false },
]

describe('listDir', () => {
  it('无前缀返回根层（目录在前）', () => {
    const r = listDir(TREE, '')
    expect(r.map(n => n.name)).toEqual(['components', 'package.json'])
  })
  it('按前缀进入子目录', () => {
    const r = listDir(TREE, 'components/')
    expect(r.map(n => n.name)).toEqual(['InputBar.tsx', 'store.tsx'])
  })
  it('前缀指向不存在的目录返回空', () => {
    expect(listDir(TREE, 'nope/')).toEqual([])
  })
  it('多层前缀', () => {
    const tree: FileNode[] = [
      { name: 'a', path: '/r/a', isDir: true, children: [
        { name: 'b', path: '/r/a/b', isDir: true, children: [
          { name: 'c.txt', path: '/r/a/b/c.txt', isDir: false },
        ] },
      ] },
    ]
    expect(listDir(tree, 'a/b/').map(n => n.name)).toEqual(['c.txt'])
  })
})

describe('filterFileItems', () => {
  it('空 query 返回全部（受上限）', () => {
    const nodes = listDir(TREE, 'components/')
    const r = filterFileItems(nodes, '', 50)
    expect(r.items.map(i => i.name)).toEqual(['InputBar.tsx', 'store.tsx'])
    expect(r.truncatedCount).toBe(0)
  })
  it('按 name 子串过滤（不区分大小写）', () => {
    const nodes = listDir(TREE, '')
    const r = filterFileItems(nodes, 'comp', 50)
    expect(r.items.map(i => i.name)).toEqual(['components'])
  })
  it('超出上限截断，truncatedCount>0', () => {
    const nodes = listDir(TREE, 'components/')
    const r = filterFileItems(nodes, '', 1)
    expect(r.items).toHaveLength(1)
    expect(r.truncatedCount).toBe(1)
  })
})
