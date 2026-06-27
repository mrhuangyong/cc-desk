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

// 判断路径是否存在（文件或目录）。供渲染进程在把疑似路径识别为可点击链接前校验，
// 避免把普通文本误判成路径后点击打不开。任何异常都视为不存在。
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

// 区分路径类型，供渲染端决定是否把路径识别为可点击「文件」链接/卡片：
// 文件夹虽然存在，但不适合走「打开文件预览」，故返回 'dir' 让渲染端忽略。
// 'absent' 表示不存在或 stat 失败。任何异常都视为不存在。
export async function statKind(filePath: string): Promise<'file' | 'dir' | 'absent'> {
  try {
    const s = await stat(filePath)
    return s.isDirectory() ? 'dir' : 'file'
  } catch {
    return 'absent'
  }
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
  // gitignore 按目录作用域：每层目录读自己的 .gitignore/.aiignore，模式只对该目录及子树生效。
  // 关键 bug 修复：原实现把所有层的模式累加进同一个 ignore 实例，
  // 导致子目录 .gitignore 里的 `*`（如 .codegraph/.gitignore）被全局应用到项目所有文件。
  // 正确语义：父目录模式继承给子目录，但子目录模式绝不反向影响父级兄弟。
  // 实现：每层 walk 创建自己的 ignore 实例（继承父层 + 本层模式），判定用相对本目录的路径。
  async function walk(dir: string, rel: string, parentIg: ReturnType<typeof ignore>) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    // 本目录的 ignore = 父层继承模式 + 本目录 .gitignore/.aiignore。
    // 模式相对本目录解释（gitignore 语义），判定时用相对本目录的路径 e.name。
    const ig = ignore().add(parentIg as any)
    const localPatterns = await readIgnoreFile(dir, '.gitignore')
    const aiPatterns = await readIgnoreFile(dir, '.aiignore')
    if (localPatterns.length) ig.add(localPatterns)
    if (aiPatterns.length) ig.add(aiPatterns)
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue
      // 判定用「相对本目录的路径」（e.name），符合 gitignore 语义
      if (ig.ignores(e.name)) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (rel.split('/').length < 20) await walk(join(dir, e.name), relPath, ig)
      } else {
        result.push(relPath)
      }
    }
  }
  const rootIg = ignore()
  await walk(dirPath, '', rootIg)
  result.sort()
  searchCache.set(dirPath, result)
  return result
}
