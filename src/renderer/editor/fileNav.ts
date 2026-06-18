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

// ===== VSCode 式扁平文件搜索 =====

// fuzzy 匹配：query 的字符按顺序作为子序列出现在 path 里即匹配（如 'pt' 匹配 'project-tree.tsx'）。
// 返回匹配位置数组（用于高亮），null 表示不匹配。偏好连续匹配、匹配靠近末尾（文件名部分）。
export function fuzzyMatch(path: string, query: string): number[] | null {
  if (!query) return []
  const p = path.toLowerCase()
  const q = query.toLowerCase()
  const positions: number[] = []
  let pi = 0
  for (let i = 0; i < p.length && pi < q.length; i++) {
    if (p[i] === q[pi]) { positions.push(i); pi++ }
  }
  return pi === q.length ? positions : null
}

// 给路径打分（用于排序）：匹配越连续、越靠近末尾（文件名）分越高。
function fuzzyScore(path: string, positions: number[]): number {
  if (positions.length === 0) return 0
  let score = 0
  // 连续匹配加分
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] === positions[i - 1] + 1) score += 5
  }
  // 匹配在文件名部分（最后一个 / 之后）大幅加分
  const lastSep = path.lastIndexOf('/')
  const fnameStart = lastSep + 1
  if (positions[0] >= fnameStart) score += 50
  // 路径越短分越高（更精确匹配）
  score -= path.length * 0.1
  return score
}

export interface FlatFileItem {
  relPath: string   // 相对项目根的完整路径，如 apps/web/src/components/left-tree/project-tree.tsx
  absPath: string   // 绝对路径
}

// 对全量文件列表做 fuzzy 过滤 + 排序 + 截断。
export function searchFlatFiles(files: string[], query: string, limit: number): { items: FlatFileItem[]; truncatedCount: number } {
  const q = query.trim()
  if (!q) {
    // 空 query：按路径排序返回前 limit 个
    return { items: files.slice(0, limit).map(relPath => ({ relPath, absPath: relPath })), truncatedCount: Math.max(0, files.length - limit) }
  }
  const scored: Array<{ item: FlatFileItem; score: number }> = []
  for (const relPath of files) {
    const positions = fuzzyMatch(relPath, q)
    if (positions) scored.push({ item: { relPath, absPath: relPath }, score: fuzzyScore(relPath, positions) })
  }
  scored.sort((a, b) => b.score - a.score)
  const truncatedCount = Math.max(0, scored.length - limit)
  return { items: scored.slice(0, limit).map(s => s.item), truncatedCount }
}
