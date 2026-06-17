// src/renderer/editor/fileNav.ts
// @ 菜单的目录导航 + 文件过滤纯函数。
// listDir：在已加载树里按累积前缀取当前层；
// filterFileItems：当前层条目按 query 过滤 + 截断上限。
import type { FileNode } from '../types'
import type { FileMenuItem } from './types'

export interface FilterResult {
  items: FileMenuItem[]
  truncatedCount: number   // 被截断的条目数（0 = 未截断）
}

// 按前缀（如 'components/' 或 '' ）取当前目录层的直接子节点
export function listDir(tree: FileNode[], prefix: string): FileNode[] {
  if (!prefix) return tree
  const segs = prefix.replace(/\/+$/, '').split('/').filter(Boolean)
  let current: FileNode[] = tree
  for (const seg of segs) {
    const found = current.find(n => n.isDir && n.name === seg)
    if (!found || !found.children) return []
    current = found.children
  }
  return current
}

// 过滤当前层 + 截断上限；返回菜单项 + 被截断数
export function filterFileItems(nodes: FileNode[], query: string, limit: number): FilterResult {
  const q = query.trim().toLowerCase()
  const matched = q === ''
    ? nodes
    : nodes.filter(n => n.name.toLowerCase().includes(q))
  const truncatedCount = Math.max(0, matched.length - limit)
  const items: FileMenuItem[] = matched.slice(0, limit).map(n => ({
    kind: n.isDir ? 'dir' : 'file',
    name: n.name,
    absPath: n.path,
  }))
  return { items, truncatedCount }
}
