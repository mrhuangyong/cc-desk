// src/main/json-utils.ts
// 共享的 JSON 存储读写工具：claude-config / marketplace-manager 等模块统一复用，
// 避免在多处复制 readJson/writeJson（曾因两份拷贝漂移而踩坑）。
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname } from 'path'

// 读取 JSON 文件；文件不存在或解析失败时返回 fallback（绝不抛错，调用方按需处理）。
export async function readJson<T = any>(path: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(path)) return fallback
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// 写入前确保父目录存在（隔离目录的 plugins/ 等子目录首次写入时缺失）。
export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}
