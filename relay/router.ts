// relay/router.ts
// 中继消息路由：验签 → 查绑定 → 找对端在线连接 → 转发。不解析 payload。
import type { BindingStore } from './binding-store'
import { verifySig, isStale, type Envelope } from '../src/shared/remote-protocol'

type SendFn = (env: Envelope) => void

export interface RouteResult {
  ok: boolean
  delivered: boolean
  reason?: 'bad_sig' | 'stale' | 'replay' | 'unbound' | 'peer_offline' | 'rate_limited'
}

export interface Router {
  register(deviceId: string, send: SendFn): void
  unregister(deviceId: string): void
  route(env: Envelope): RouteResult
  /** 去重表当前条目数（可观测性：内存安全回归监控）。 */
  seenSize(): number
}

/**
 * @param resolveKey deviceId → deviceKey 的查密钥函数。
 *   中继需知道每端的 deviceKey 才能验签。v1 由 bind 握手时上报（或绑定表附带）。
 *   注意：deviceKey 仅用于验签，不用于转发；中继不长期持有也无妨，但需在 bind 时拿到。
 *
 * I2 内存泄漏修复（公网长生命周期中继）：
 *   原 seen = new Set<string>() 只 add 不 delete，nonce 永久累积，OOM 只是时间问题。
 *   nonce 只需在 ts 容差窗口（±60s）内去重即有防重放意义；超过窗口的老 nonce，
 *   isStale 本就会拒掉其携带的消息，留在 seen 里毫无价值。
 *   现改为 Map<nonce, insertedTs>，两条清理路径叠加（任一即可，双保险）：
 *   - TTL：定期（cleanupIntervalMs，默认 5 分钟）扫描，删掉 insertedTs 早于 seenTtlMs（默认 2 分钟）的项。
 *   - CAP：集合超 seenCap（默认 100k）时按插入序驱逐最旧项（LRU-ish），兜底防异常流量尖峰。
 */
export function createRouter(
  bindings: BindingStore,
  resolveKey: (deviceId: string) => string | undefined,
  opts: {
    nonceWindow?: number
    rateLimit?: number
    seenTtlMs?: number
    cleanupIntervalMs?: number
    seenCap?: number
    now?: () => number
  } = {},
): Router {
  const conns = new Map<string, SendFn>()
  const rateLimit = opts.rateLimit ?? 50 // msg/s per device
  const counters = new Map<string, { count: number; windowStart: number }>()

  // I2：带 TTL + CAP 的 nonce 去重表。nonce → 入表时间戳。
  const seen = new Map<string, number>()
  const seenTtlMs = opts.seenTtlMs ?? 120_000 // 超过 ts 容差窗口即可安全删
  const cleanupIntervalMs = opts.cleanupIntervalMs ?? 5 * 60_000
  const seenCap = opts.seenCap ?? 100_000
  const now = opts.now ?? (() => Date.now())
  let lastCleanup = now()

  /** 删掉超过 TTL 的旧 nonce。O(n) 但只在 interval 到点时跑一次，平摊成本低。 */
  function cleanupStale(t: number) {
    if (t - lastCleanup < cleanupIntervalMs) return
    lastCleanup = t
    const cutoff = t - seenTtlMs
    for (const [nonce, ts] of seen) {
      if (ts < cutoff) seen.delete(nonce)
    }
  }

  return {
    register(deviceId, send) { conns.set(deviceId, send) },
    unregister(deviceId) { conns.delete(deviceId) },
    seenSize() { return seen.size },
    route(env) {
      // 0. token 模式放行（Task 2）：已 register 的连接（bind 握手通过，含 token 连接）
      //    直接转发，跳过 bindings + 签名校验。
      //    为什么：token 连接的 deviceId = desktopId（来自 token entry），不在 bindings 里
      //    （bindings 是配对设备关系，token 桌面未必配对过），走旧路径必 unbound；
      //    且 token 模式无 deviceKey 签名，走 verifySig 必 bad_sig。
      //    安全性由 bind 握手的 token 校验（tokenStore.getToken）保证：只有持有效 token 的
      //    连接才能 register，此处 conns.has 为真即代表已通过 bind 认证。
      if (conns.has(env.deviceId)) {
        const peers = bindings.getPeers(env.deviceId)
        let delivered = false
        if (peers.size > 0) {
          for (const peer of peers) {
            // 转发给除发送方外的在线对端（避免回环）
            const send = conns.get(peer)
            if (send && peer !== env.deviceId) { send(env); delivered = true }
          }
        }
        return delivered
          ? { ok: true, delivered: true }
          : { ok: true, delivered: false, reason: 'peer_offline' }
      }
      // 1. 绑定校验
      if (!bindings.has(env.deviceId)) return { ok: false, delivered: false, reason: 'unbound' }
      // 2. 签名校验
      const key = resolveKey(env.deviceId)
      if (!key || !verifySig(key, env)) return { ok: false, delivered: false, reason: 'bad_sig' }
      // 3. 时间戳
      if (isStale(env)) return { ok: false, delivered: false, reason: 'stale' }
      // 4. 重放（Map 版：命中即重放，否则登记）
      const t = now()
      if (seen.has(env.nonce)) return { ok: false, delivered: false, reason: 'replay' }
      // I2 清理：先清旧（可能腾出空间），再登记新 nonce
      cleanupStale(t)
      // I2 CAP 兜底：超上限驱逐最旧项（Map 保持插入序，首个即最旧）
      if (seen.size >= seenCap) {
        const oldest = seen.keys().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
      seen.set(env.nonce, t)
      // 5. 限流（粗粒度，每秒每设备）
      const c = counters.get(env.deviceId) ?? { count: 0, windowStart: t }
      if (t - c.windowStart > 1000) { c.count = 0; c.windowStart = t }
      c.count++
      counters.set(env.deviceId, c)
      if (c.count > rateLimit) return { ok: false, delivered: false, reason: 'rate_limited' }

      // 6. 找对端并转发（一对多广播：桌面绑多个手机时，桌面→手机的消息投递给所有在线手机）
      const peers = bindings.getPeers(env.deviceId)
      let delivered = false
      if (peers.size > 0) {
        for (const peer of peers) {
          const send = conns.get(peer)
          if (send) { send(env); delivered = true }
        }
      }
      return delivered
        ? { ok: true, delivered: true }
        : { ok: true, delivered: false, reason: 'peer_offline' }
    },
  }
}
