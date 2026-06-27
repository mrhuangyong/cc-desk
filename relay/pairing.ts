// relay/pairing.ts
// 配对码生成/校验。6 位数字、TTL 60s、一次性、每 deviceId issue 限频。
//
// C1 安全修复（公网暴露，配对码仅 10^6 空间，防暴力枚举）：
//   原 consume(code, mobileId) 完全不限频，攻击者可用任意 deviceId 对中继
//   无限制发 pair.consume 暴力枚举，命中即拿 desktopKey。
//   spec §4.3 威胁#1 要求「每 IP 限频」。现改为 consumeAttempt(ip, code, mobileId)：
//   - 每 IP 每窗口（默认 60s）最多 maxConsumePerIp 次（默认 10）尝试。
//   - 失败次数（bad_code）超过 lockThreshold（默认 5）后锁定该 IP lockMs（默认 5 分钟）。
//   - 锁定期间该 IP 任何 consume 直接拒绝（locked），不消耗真实码查找。
//   10^6 空间 + 10 次/分 + 失败锁定 → 单 IP 全空间枚举需 ~7 天，且锁定后实际不可行。
//   （配合 I1 方案 B：此限频是猜码直绑威胁的等价防护，详见安全报告与 spec 声明。）
import { randomInt } from 'crypto'
import type { BindingStore } from './binding-store'

const CODE_TTL_MS = 60_000
const CODE_LEN = 6
const DEFAULT_MAX_ISSUE = 5 // 每个 deviceId 60s 窗口内最多 issue 次数
const DEFAULT_MAX_CONSUME_PER_IP = 10 // 每 IP 60s 窗口内最多 consume 尝试次数
const DEFAULT_LOCK_THRESHOLD = 5 // 每 IP 窗口内失败达此次数即锁定
const DEFAULT_LOCK_MS = 5 * 60_000 // 锁定时长

export interface PairingStore {
  issueCode(deviceId: string): { code: string; expiresAt: number }
  /**
   * 校验配对码并落绑定（带 IP 维度限频 + 失败锁定）。
   * 返回值 reason:
   *   - ok=true: 命中，desktopId 已填
   *   - bad_code: 码不存在/过期/已用（消耗 1 次失败计数）
   *   - rate_limited: 该 IP 本窗口尝试次数超上限（不消耗失败计数）
   *   - locked: 该 IP 因失败过多被锁定
   */
  consumeAttempt(
    ip: string,
    code: string,
    mobileId: string,
  ): { ok: true; desktopId: string } | { ok: false; reason: 'bad_code' | 'rate_limited' | 'locked' }
}

export function createPairingStore(
  bindings: BindingStore,
  opts: {
    maxIssuePerWindow?: number
    windowMs?: number
    maxConsumePerIp?: number
    lockThreshold?: number
    lockMs?: number
    /** 注入时钟便于测试；生产用 Date.now */
    now?: () => number
  } = {},
): PairingStore {
  const maxIssue = opts.maxIssuePerWindow ?? DEFAULT_MAX_ISSUE
  const windowMs = opts.windowMs ?? 60_000
  const maxConsumePerIp = opts.maxConsumePerIp ?? DEFAULT_MAX_CONSUME_PER_IP
  const lockThreshold = opts.lockThreshold ?? DEFAULT_LOCK_THRESHOLD
  const lockMs = opts.lockMs ?? DEFAULT_LOCK_MS
  const now = opts.now ?? (() => Date.now())

  // code → { deviceId, expiresAt }
  const codes = new Map<string, { deviceId: string; expiresAt: number }>()
  // deviceId → issue 时间戳列表（限频窗口）
  const issueLog = new Map<string, number[]>()
  // IP → consume 尝试时间戳列表（限频窗口）
  const consumeLog = new Map<string, number[]>()
  // IP → 失败次数（窗口内）
  const failCount = new Map<string, number>()
  // IP → 锁定到期时间戳（0/不存在=未锁）
  const lockUntil = new Map<string, number>()

  /** 窗口过滤：保留窗口内时间戳。 */
  function pruneWindow(log: number[], t: number): number[] {
    return log.filter(ts => t - ts < windowMs)
  }

  return {
    issueCode(deviceId) {
      const t = now()
      const log = pruneWindow(issueLog.get(deviceId) ?? [], t)
      if (log.length >= maxIssue) throw new Error('pairing rate limit exceeded')
      log.push(t)
      issueLog.set(deviceId, log)

      const code = String(randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0')
      const expiresAt = t + CODE_TTL_MS
      codes.set(code, { deviceId, expiresAt })
      return { code, expiresAt }
    },
    consumeAttempt(ip, code, mobileId) {
      const t = now()

      // 1. 锁定检查（优先，被锁直接拒）
      const until = lockUntil.get(ip) ?? 0
      if (until > t) return { ok: false, reason: 'locked' }

      // 2. 限频：窗口内尝试次数
      const clog = pruneWindow(consumeLog.get(ip) ?? [], t)
      if (clog.length >= maxConsumePerIp) {
        consumeLog.set(ip, clog)
        return { ok: false, reason: 'rate_limited' }
      }
      clog.push(t)
      consumeLog.set(ip, clog)

      // 3. 码校验
      const entry = codes.get(code)
      const hit = !!entry && t <= entry.expiresAt
      if (!hit) {
        // 删除过期/已用码（若存在且过期）
        if (entry && t > entry.expiresAt) codes.delete(code)
        // 失败计数 + 锁定判定
        const fails = (failCount.get(ip) ?? 0) + 1
        failCount.set(ip, fails)
        if (fails >= lockThreshold) {
          lockUntil.set(ip, t + lockMs)
          // 清该 IP 失败计数与窗口（锁定期间不再累积），锁定到期后从 0 重开
          failCount.delete(ip)
          consumeLog.delete(ip)
          return { ok: false, reason: 'locked' }
        }
        return { ok: false, reason: 'bad_code' }
      }

      // 4. 命中：一次性删除 + 落绑定 + 清该 IP 失败计数（成功重置可疑度）
      codes.delete(code)
      failCount.delete(ip)
      void bindings.addBinding(entry!.deviceId, mobileId)
      return { ok: true, desktopId: entry!.deviceId }
    },
  }
}
