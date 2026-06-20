// src/main/memory-file.ts
// 全局记忆文件 CLAUDE.md 的读写：落在 CLAUDE_CONFIG_DIR（~/.cc-desk/claude）下，
// 与 Claude Agent SDK 运行时同一目录，确保设置页编辑即实际生效。
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { CLAUDE_CONFIG_DIR } from './paths'

const MEMORY_PATH = join(CLAUDE_CONFIG_DIR, 'CLAUDE.md')

// 读取全局记忆文件。文件不存在时返回空串（首次进入记忆设置页的场景），不报错。
export async function getMemoryFile(): Promise<string> {
  if (!existsSync(MEMORY_PATH)) return ''
  try {
    return await readFile(MEMORY_PATH, 'utf-8')
  } catch {
    return ''
  }
}

// 写入全局记忆文件。目录由 ensureClaudeConfigDir 保证存在，直接写。
export async function saveMemoryFile(content: string): Promise<void> {
  await writeFile(MEMORY_PATH, content, 'utf-8')
}
