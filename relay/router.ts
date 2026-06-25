// relay/router.ts
// 中继消息路由：验签 → 查绑定 → 找对端在线连接 → 转发。不解析 payload。
import type { BindingStore } from './binding-store'
import { verifySig, isStale, isReplay, type Envelope } from '../src/shared/remote-protocol'

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
}

/**
 * @param resolveKey deviceId → deviceKey 的查密钥函数。
 *   中继需知道每端的 deviceKey 才能验签。v1 由 bind 握手时上报（或绑定表附带）。
 *   注意：deviceKey 仅用于验签，不用于转发；中继不长期持有也无妨，但需在 bind 时拿到。
 */
export function createRouter(
  bindings: BindingStore,
  resolveKey: (deviceId: string) => string | undefined,
  opts: { nonceWindow?: number; rateLimit?: number } = {},
): Router {
  const conns = new Map<string, SendFn>()
  const seen = new Set<string>()
  const rateLimit = opts.rateLimit ?? 50 // msg/s per device
  const counters = new Map<string, { count: number; windowStart: number }>()

  return {
    register(deviceId, send) { conns.set(deviceId, send) },
    unregister(deviceId) { conns.delete(deviceId) },
    route(env) {
      // 1. 绑定校验
      if (!bindings.has(env.deviceId)) return { ok: false, delivered: false, reason: 'unbound' }
      // 2. 签名校验
      const key = resolveKey(env.deviceId)
      if (!key || !verifySig(key, env)) return { ok: false, delivered: false, reason: 'bad_sig' }
      // 3. 时间戳
      if (isStale(env)) return { ok: false, delivered: false, reason: 'stale' }
      // 4. 重放
      if (isReplay(env, seen)) return { ok: false, delivered: false, reason: 'replay' }
      // 5. 限流（粗粒度，每秒每设备）
      const now = Date.now()
      const c = counters.get(env.deviceId) ?? { count: 0, windowStart: now }
      if (now - c.windowStart > 1000) { c.count = 0; c.windowStart = now }
      c.count++
      counters.set(env.deviceId, c)
      if (c.count > rateLimit) return { ok: false, delivered: false, reason: 'rate_limited' }

      // 6. 找对端并转发
      const peer = bindings.getPeer(env.deviceId)
      const send = peer ? conns.get(peer) : undefined
      if (!send) return { ok: true, delivered: false, reason: 'peer_offline' }
      send(env)
      return { ok: true, delivered: true }
    },
  }
}
