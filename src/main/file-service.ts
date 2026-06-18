// src/main/file-service.ts
import { readdir, readFile, stat, writeFile, rename, unlink } from 'fs/promises'
import { join } from 'path'
import ignore from 'ignore'

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

// 原子写：先写临时文件再 rename 覆盖，避免写一半崩溃损坏原文件。
// 任一步失败均不触碰原文件，并清理 tmp。
export async function writeFileContent(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.ccdesk-tmp`
  try {
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, filePath)
  } catch (err) {
    try { await rmQuiet(tmp) } catch { /* 忽略清理失败 */ }
    throw err
  }
}

async function rmQuiet(p: string): Promise<void> {
  try { await unlink(p) } catch { /* noop */ }
}

// 读单个目录的 .gitignore / .aiignore，返回合并后的模式行（去空行/注释）。
async function readIgnoreFile(dir: string, name: string): Promise<string[]> {
  try {
    const content = await readFile(join(dir, name), 'utf-8')
    return content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  } catch { return [] }
}

// 全量递归扫描项目所有文件，尊重各级 .gitignore / .aiignore。
// 采用"模式累加"：递归时收集每层的 gitignore/aiignore 模式到单个 ignore 实例，
// 对相对路径匹配。这是 gitignore 层级语义的合理近似（根模式全项目生效，
// 子目录模式补充），覆盖绝大多数项目。
// 供 @ 面板做 VSCode 式扁平文件搜索。结果按 cwd 缓存（项目生命周期内只扫一次）。
const searchCache = new Map<string, string[]>()
export async function searchFiles(dirPath: string): Promise<string[]> {
  if (searchCache.has(dirPath)) return searchCache.get(dirPath)!
  const result: string[] = []
  const ig = ignore()
  async function walk(dir: string, rel: string) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    // 本层 gitignore/aiignore 模式累加进同一实例
    const gitPatterns = await readIgnoreFile(dir, '.gitignore')
    const aiPatterns = await readIgnoreFile(dir, '.aiignore')
    if (gitPatterns.length) ig.add(gitPatterns)
    if (aiPatterns.length) ig.add(aiPatterns)
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (ig.ignores(relPath)) continue
      if (e.isDirectory()) {
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
