// src/main/marketplace-manager.ts
// 插件仓库（marketplace）管理：添加/删除/刷新/列表/搜索。
// 全部操作 ~/.cc-desk/claude/plugins/（CLAUDE_CONFIG_DIR），不触碰 ~/.claude。
// SDK 通过 CLAUDE_CONFIG_DIR 自动发现 settings.json + installed_plugins.json 加载插件。

import { readFile, writeFile, stat, mkdir, rm, cp } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { CLAUDE_CONFIG_DIR } from './paths'

const execFileAsync = promisify(execFile)

const CLAUDE_DIR = CLAUDE_CONFIG_DIR
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins')
const MARKETPLACES_DIR = join(PLUGINS_DIR, 'marketplaces')
const KNOWN_MARKETPLACES_PATH = join(PLUGINS_DIR, 'known_marketplaces.json')

const GIT_TIMEOUT_MS = 120000

// ---- 类型定义 ----

export type MarketplaceSource =
  | { source: 'github'; repo: string; ref?: string }
  | { source: 'git'; url: string; ref?: string }
  | { source: 'url'; url: string; headers?: Record<string, string> }
  | { source: 'file'; path: string }
  | { source: 'directory'; path: string }

export interface KnownMarketplace {
  name: string               // marketplace 名（known_marketplaces.json 的 key）
  source: MarketplaceSource
  installLocation: string
  lastUpdated: string
  autoUpdate?: boolean
}

export interface PluginMarketplaceEntry {
  name: string
  description?: string
  version?: string
  source: string | object
  category?: string
  tags?: string[]
}

export interface PluginMarketplace {
  name: string
  owner?: { name: string; email?: string; url?: string }
  plugins: PluginMarketplaceEntry[]
}

export interface SearchResult {
  pluginName: string
  marketplace: string
  version: string
  description: string
  category?: string
  tags?: string[]
  installed: boolean
}

// ---- 工具函数 ----

async function readJson<T = any>(path: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(path)) return fallback
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch { return fallback }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

// ---- parseSource：智能识别输入字符串的仓库来源类型 ----

export function parseSource(input: string): MarketplaceSource {
  const trimmed = input.trim()

  // git@ SSH：git@github.com:owner/repo → github
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (sshMatch) return { source: 'github', repo: sshMatch[1] }

  // git@ SSH 非 github → git
  if (trimmed.startsWith('git@')) return { source: 'git', url: trimmed }

  // https://github.com/owner/repo → github
  const ghHttpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/)
  if (ghHttpsMatch) return { source: 'github', repo: ghHttpsMatch[1] }

  // 其他 .git 结尾 URL → git
  if (/^https?:\/\//.test(trimmed) && trimmed.endsWith('.git')) {
    return { source: 'git', url: trimmed }
  }

  // http(s):// 非 .git → url（直链 marketplace.json）
  if (/^https?:\/\//.test(trimmed)) return { source: 'url', url: trimmed }

  // 绝对路径（/ 开头 Unix，或盘符开头 Windows，~ 开头）→ 本地路径占位
  // addMarketplace 内会用 stat 校正为 file/directory。
  // .json 结尾的路径先猜 file（绝大多数 marketplace.json 场景）。
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('~')) {
    if (trimmed.endsWith('.json')) return { source: 'file', path: trimmed }
    return { source: 'directory', path: trimmed }
  }

  // owner/repo 简写（含 / 无 :// 无空格，非绝对路径）→ github
  if (trimmed.includes('/') && !trimmed.includes('://') && !/\s/.test(trimmed)) {
    return { source: 'github', repo: trimmed }
  }

  // 其他本地路径（相对路径），返回 directory 占位
  return { source: 'directory', path: trimmed }
}
