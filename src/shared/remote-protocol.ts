// src/shared/remote-protocol.ts
// 远程控制协议地基：桌面 / 中继 / PWA 三端共享。
// 纯类型 + 纯函数，无 IO，无副作用，便于测试。
//
// 类型与常量定义已拆到 remote-protocol-types.ts（纯类型文件，无 node:crypto 依赖），
// 供 web 端（浏览器）单独复用。本文件保留 Node 同步签名实现（createHmac / randomBytes），
// 所有现有 Node 端 import 路径（'../shared/remote-protocol'）透明兼容。

import { createHmac, randomBytes } from 'crypto'
import {
  PROTOCOL_VERSION,
  TS_TOLERANCE_MS,
  type Envelope,
  type MessageType,
  type ServerToClient,
  type ClientToServer,
  type ControlMessage,
} from './remote-protocol-types'

// 透传 re-export：保持 '../shared/remote-protocol' 的现有 API 表面不变。
export {
  PROTOCOL_VERSION,
  TS_TOLERANCE_MS,
}
export type {
  Envelope,
  MessageType,
  ServerToClient,
  ClientToServer,
  ControlMessage,
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
