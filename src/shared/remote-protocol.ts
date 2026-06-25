// src/shared/remote-protocol.ts
// 远程控制协议地基：桌面 / 中继 / PWA 三端共享。
// 纯类型 + 纯函数，无 IO，无副作用，便于测试。

import { createHmac, randomBytes } from 'crypto'

/** 协议版本 */
export const PROTOCOL_VERSION = 1

/** 时间戳容差（毫秒） */
export const TS_TOLERANCE_MS = 60_000

/** 消息类型 —— 桌面→手机 */
export type ServerToClient =
  | 'session.list'        // 当前可远程操作的会话清单
  | 'session.delta'       // 流式增量
  | 'session.blocks'      // tool_use/tool_result/计划卡片
  | 'session.notice'      // 系统提示
  | 'session.result'      // query 结束
  | 'dialog.request'      // 批准请求（对应 claude:dialog-request）
  | 'connection.state'    // 桌面在线状态

/** 消息类型 —— 手机→桌面 */
export type ClientToServer =
  | 'bind'                // /ws 连接后的身份握手
  | 'session.attach'      // 接管会话
  | 'session.create'      // 新建会话
  | 'session.message'     // 发消息
  | 'session.interrupt'   // 中断 query
  | 'dialog.response'     // 批准/拒绝/忽略

/** 控制类消息（配对、错误等） */
export type ControlMessage =
  | 'pair.code'           // 桌面→中继：请求生成配对码
  | 'pair.request'        // 中继→桌面：手机请求配对
  | 'pair.approve'        // 桌面→中继：同意配对
  | 'pair.success'        // 中继→手机：配对完成，下发密钥
  | 'error'               // 错误回报
  | 'peer_offline'        // 对端不在线

export type MessageType = ServerToClient | ClientToServer | ControlMessage

/** 消息信封（所有消息统一外壳） */
export interface Envelope<T = unknown> {
  v: number               // 协议版本
  type: MessageType
  deviceId: string        // 发送方设备
  ts: number              // 毫秒时间戳
  nonce: string           // 单调随机，防重放
  sig: string             // HMAC-SHA256(deviceKey, ts+nonce+payload) base64
  payload: T
}

/** 用 deviceKey 对 ts+nonce+payload 做 HMAC-SHA256，返回 base64 签名。 */
export function sign(deviceKey: string, ts: number, nonce: string, payload: unknown): string {
  const mac = createHmac('sha256', Buffer.from(deviceKey, 'base64'))
  mac.update(String(ts))
  mac.update(nonce)
  mac.update(JSON.stringify(payload))
  return mac.digest('base64')
}

/** 校验信封签名是否合法。 */
export function verifySig(deviceKey: string, env: Envelope): boolean {
  const expected = sign(deviceKey, env.ts, env.nonce, env.payload)
  // 定长比较防时序攻击
  return expected.length === env.sig.length && timingSafeEqual(expected, env.sig)
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 生成随机 nonce。 */
export function genNonce(): string {
  return randomBytes(16).toString('base64')
}

/** 构造一个已签名的信封。 */
export function makeEnvelope<T>(
  deviceKey: string,
  type: MessageType,
  deviceId: string,
  payload: T,
): Envelope<T> {
  const ts = Date.now()
  const nonce = genNonce()
  const sig = sign(deviceKey, ts, nonce, payload)
  return { v: PROTOCOL_VERSION, type, deviceId, ts, nonce, sig, payload }
}

/** 判断时间戳是否过期（±60s 容差）。 */
export function isStale(env: Envelope, now = Date.now()): boolean {
  return Math.abs(now - env.ts) > TS_TOLERANCE_MS
}

/** 判断是否为重放（基于已见 nonce 集合）。重复见到同一 nonce 返回 true。 */
export function isReplay(env: Envelope, seen: Set<string>): boolean {
  if (seen.has(env.nonce)) return true
  seen.add(env.nonce)
  return false
}
