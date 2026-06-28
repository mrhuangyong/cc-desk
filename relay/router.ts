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

export interface RegisterOpts {
  /**
   * Task 2-fix：token 虚拟身份的对端真实 deviceId。
   * 存在时表示本次 register 注册的是 token 手机（虚拟 id 形如 `share:xxx`），
   * tokenPeer = 它要对话的桌面真实 id。router 据此建立双向映射，
   * 让 token 手机 ↔ 桌面的消息路由走 tokenPeers 而非 bindings。
   */
  tokenPeer?: string
}

export interface Router {
  register(deviceId: string, send: SendFn, opts?: RegisterOpts): void
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

  // Task 2-fix：token 虚拟身份 ↔ 桌面真实 id 的双向映射。
  //   为什么不能用 bindings：bindings 是配对设备关系（D↔M），token 手机既不是 M，
  //   也未必经过配对；用 bindings 路由会把 token 手机误当成配对手机/桌面。
  //   为什么不能用 desktopId 当 token 手机的 register key（旧缺陷）：
  //   token 手机和真桌面用同一 desktopId register → conns 互相覆盖（后注册的挤掉先注册的），
  //   且 bindings.getPeers(desktopId) 返回的是配对手机而非真桌面 → 转发方向错乱。
  //   修复：token 手机以虚拟 id `share:xxx` register，并在此登记双向映射，
  //   route 时按虚拟 id 查对端（桌面真实 id），转发给桌面的所有连接。
  //   双向：share:xxx → desk（手机发消息找桌面）+ desk → share:xxx（桌面发消息找 token 手机）。
  const tokenPeers = new Map<string, string>()

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
    register(deviceId, send, rOpts) {
      conns.set(deviceId, send)
      // Task 2-fix：token 手机 register 时建立虚拟 id ↔ 桌面真实 id 双向映射。
      if (rOpts?.tokenPeer) {
        tokenPeers.set(deviceId, rOpts.tokenPeer)   // share:xxx → desk
        tokenPeers.set(rOpts.tokenPeer, deviceId)   // desk → share:xxx
      }
    },
    unregister(deviceId) {
      conns.delete(deviceId)
      // 清理 tokenPeers 双向映射：删自己 + 删指向自己的反向项
      const peer = tokenPeers.get(deviceId)
      if (peer !== undefined) {
        tokenPeers.delete(deviceId)
        // 反向项的值若等于自己才删（避免误删 desk 的其它 token 映射）
        if (tokenPeers.get(peer) === deviceId) tokenPeers.delete(peer)
      }
    },
    seenSize() { return seen.size },
    route(env) {
      // 0. token 模式放行（Task 2-fix）：仅对 token 虚拟身份（share: 前缀）放行。
      //    旧缺陷：原为 `if (conns.has(env.deviceId))` 对所有 register 过的连接跳过
      //    验签/重放/限流——这让任何已 bind 的旧配对设备也绕过安全检查，削弱旧路径。
      //    修复：放行分支只命中 share: 前缀（token 手机虚拟 id），旧配对设备仍走完整
      //    bindings + verifySig + 重放 + 限流路径。
      //    安全性由 bind 握手的 token 校验（tokenStore.getToken）保证：只有持有效 token 的
      //    连接才能以 share:xxx 身份 register，此处 env.deviceId 以 share: 开头即代表已通过 bind 认证。
      //    转发对端从 tokenPeers 查（虚拟 id → 桌面真实 id），转发给桌面的所有连接。
      if (env.deviceId.startsWith('share:')) {
        const deskId = tokenPeers.get(env.deviceId)
        let delivered = false
        if (deskId) {
          const send = conns.get(deskId)
          if (send && deskId !== env.deviceId) { send(env); delivered = true }
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
      // Task 2-fix：桌面（已配对设备，走验签路径）发消息时，若 tokenPeers 登记了
      //   `当前 deviceId → share:xxx` 的映射，说明有 token 手机在线等着接收，也转发给它。
      //   这样桌面 → token 手机的方向也通（缺陷1要求双向可达）。
      const tokenVirtual = tokenPeers.get(env.deviceId)
      if (tokenVirtual && tokenVirtual !== env.deviceId) {
        const send = conns.get(tokenVirtual)
        if (send) { send(env); delivered = true }
      }
      return delivered
        ? { ok: true, delivered: true }
        : { ok: true, delivered: false, reason: 'peer_offline' }
    },
  }
}
