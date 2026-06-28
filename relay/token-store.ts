// relay/token-store.ts
// 分享链接 token 的 CRUD + 持久化(照 key-store.ts 范式)。
// tokens.json 结构: { [token]: { desktopId, createdAt, expiresAt } }
// expiresAt=0 表示永久。
import { randomBytes } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export interface TokenEntry {
  desktopId: string
  createdAt: number
  expiresAt: number  // 0 = 永久
}

export type TokenMap = Record<string, TokenEntry>

export interface TokenStore {
  createToken(desktopId: string, expiresInDays: number): { token: string; expiresAt: number }
  getToken(token: string): TokenEntry | null
  revokeToken(token: string): boolean
  // listTokens 每项含 token + 完整 entry 字段展开到顶层
  // (token/desktopId/createdAt/expiresAt),便于调用方直接访问 desktopId
  // (测试与 server.ts bind 认证均按此结构消费)。
  listTokens(desktopId: string): ({ token: string; entry: TokenEntry } & TokenEntry)[]
}

function isTokenMap(raw: any): raw is TokenMap {
  if (!raw || typeof raw !== 'object') return false
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !v || typeof (v as any).desktopId !== 'string') return false
  }
  return true
}

export function createTokenStore(
  opts: {
    filePath?: string
    persist?: (data: TokenMap) => Promise<void> | void
  } = {},
  extra: { now?: () => number } = {},
): TokenStore {
  const now = extra.now ?? (() => Date.now())
  let cache: TokenMap = {}

  // 同步读盘(bind 握手需同步 get)。若注入 persist mock 则跳过文件 IO(测试用)。
  if (opts.filePath && !opts.persist) {
    try {
      const raw = require('fs').readFileSync(opts.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (isTokenMap(parsed)) cache = parsed
    } catch { /* 文件不存在/坏 JSON,空 cache 起步 */ }
  }

  const persist = opts.persist ?? (async (data: TokenMap) => {
    if (!opts.filePath) return
    try {
      await mkdir(dirname(opts.filePath), { recursive: true })
      await writeFile(opts.filePath, JSON.stringify(data, null, 2))
    } catch { /* 写盘失败不崩溃(与 key-store 一致) */ }
  })

  return {
    createToken(desktopId, expiresInDays) {
      const token = randomBytes(32).toString('hex')
      const createdAt = now()
      const expiresAt = expiresInDays > 0 ? createdAt + expiresInDays * 86400000 : 0
      cache[token] = { desktopId, createdAt, expiresAt }
      void persist(cache)
      return { token, expiresAt }
    },
    getToken(token) {
      const entry = cache[token]
      if (!entry) return null
      // 过期检查(expiresAt=0 永久)
      if (entry.expiresAt > 0 && now() > entry.expiresAt) {
        delete cache[token]
        void persist(cache)
        return null
      }
      return entry
    },
    revokeToken(token) {
      if (!cache[token]) return false
      delete cache[token]
      void persist(cache)
      return true
    },
    listTokens(desktopId) {
      return Object.entries(cache)
        .filter(([, entry]) => entry.desktopId === desktopId)
        .map(([token, entry]) => ({ token, entry, ...entry }))
    },
  }
}
