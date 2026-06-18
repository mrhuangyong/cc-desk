// src/main/file-service.ts
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.claude', '.vscode', '.DS_Store'])

export async function readDirTree(dirPath: string, depth = 3): Promise<FileNode[]> {
  if (depth <= 0) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const children = await readDirTree(fullPath, depth - 1)
      nodes.push({ name: entry.name, path: fullPath, isDir: true, children })
    } else {
      nodes.push({ name: entry.name, path: fullPath, isDir: false })
    }
  }
  return nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function readFileContent(filePath: string): Promise<string> {
  const s = await stat(filePath)
  if (s.size > 1024 * 200) throw new Error('文件过大（>200KB）')
  return readFile(filePath, 'utf-8')
}

// 全量递归扫描项目所有文件（排除 IGNORE 目录），返回相对路径列表。
// 供 @ 面板做 VSCode 式扁平文件搜索。结果按 cwd 缓存（项目生命周期内只扫一次）。
const searchCache = new Map<string, string[]>()
export async function searchFiles(dirPath: string): Promise<string[]> {
  if (searchCache.has(dirPath)) return searchCache.get(dirPath)!
  const result: string[] = []
  async function walk(dir: string, rel: string) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        // 限制深度避免超大项目卡死（20 层足够覆盖任何正常项目）
        if (rel.split('/').length < 20) await walk(join(dir, e.name), relPath)
      } else {
        result.push(relPath)
      }
    }
  }
  await walk(dirPath, '')
  result.sort()
  searchCache.set(dirPath, result)
  return result
}
