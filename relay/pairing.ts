// relay/pairing.ts
// 配对码生成/校验。6 位数字、TTL 60s、一次性、每 deviceId 限频。
import { randomInt } from 'crypto'
import type { BindingStore } from './binding-store'

const CODE_TTL_MS = 60_000
const CODE_LEN = 6
const DEFAULT_MAX_ISSUE = 5 // 每个 deviceId 60s 窗口内最多 issue 次数

export interface PairingStore {
  issueCode(deviceId: string): { code: string; expiresAt: number }
  consume(code: string, mobileId: string): { desktopId: string } | null
}

export function createPairingStore(
  bindings: BindingStore,
  opts: { maxIssuePerWindow?: number; windowMs?: number } = {},
): PairingStore {
  const maxIssue = opts.maxIssuePerWindow ?? DEFAULT_MAX_ISSUE
  const windowMs = opts.windowMs ?? 60_000
  // code → { deviceId, expiresAt }
  const codes = new Map<string, { deviceId: string; expiresAt: number }>()
  // deviceId → issue 时间戳列表（限频窗口）
  const issueLog = new Map<string, number[]>()

  return {
    issueCode(deviceId) {
      const now = Date.now()
      const log = (issueLog.get(deviceId) ?? []).filter(t => now - t < windowMs)
      if (log.length >= maxIssue) throw new Error('pairing rate limit exceeded')
      log.push(now)
      issueLog.set(deviceId, log)

      const code = String(randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0')
      const expiresAt = now + CODE_TTL_MS
      codes.set(code, { deviceId, expiresAt })
      return { code, expiresAt }
    },
    consume(code, mobileId) {
      const entry = codes.get(code)
      if (!entry) return null
      if (Date.now() > entry.expiresAt) {
        codes.delete(code)
        return null
      }
      codes.delete(code) // 一次性
      // 落绑定（异步，consume 同步返回）
      void bindings.addBinding(entry.deviceId, mobileId)
      return { desktopId: entry.deviceId }
    },
  }
}
