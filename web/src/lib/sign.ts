// web/src/lib/sign.ts
// 协议签名的 Web Crypto 适配层。
//
// 为什么存在（单一真相源 vs 浏览器兼容的处理说明）：
// src/shared/remote-protocol.ts 是 Node 端实现，用 node:crypto 的 createHmac（同步）
// 和 randomBytes。浏览器/Web Worker 没有 node:crypto，且 Web Crypto API 的
// subtle.sign('HMAC') 返回 Promise（异步），无法做成与 Node 同步实现共用的同签名。
//
// 处理决策（避免类型漂移 + 零破坏 Node 端）：
// 1. 类型零漂移：信封/消息类型（Envelope / MessageType / PROTOCOL_VERSION 等）
//    从 @shared/remote-protocol 直接 import（tsconfig path mapping），不复制。
// 2. 加密函数重实现：sign / verifySig / makeEnvelope 用 Web Crypto 重写，
//    与 Node 端 sign 使用同一算法（HMAC-SHA256，key=base64 解码后的 deviceKey，
//    data = ts || nonce || JSON.stringify(payload)），保证两端签名可互验。
// 3. Node 端 remote-protocol.ts 不动 —— relay/remote-bridge 继续用同步实现。
//
// 真实现，非 mock / 非 polyfill：用浏览器原生 globalThis.crypto.subtle。
import { PROTOCOL_VERSION, type Envelope, type MessageType } from '@shared/remote-protocol-types'

const encoder = new TextEncoder()

/** 把 base64 字符串解码成 Uint8Array（兼容 atob + 手动字节展开，无 Buffer）。
 *  显式用 ArrayBuffer（非 SharedArrayBuffer）以匹配 Web Crypto 的 BufferSource 签名。 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** 把 Uint8Array 编码成 base64 字符串。 */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/** 用 deviceKey 对 ts+nonce+payload 做 HMAC-SHA256，返回 base64 签名。与 Node 端 sign 同算法。 */
export async function signEnvelope(
  deviceKey: string,
  env: Pick<Envelope, 'ts' | 'nonce' | 'payload'>,
): Promise<string> {
  const keyBytes = base64ToBytes(deviceKey)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  // data = ts || nonce || JSON.stringify(payload)，与 Node 端 sign 的 update 顺序一致。
  const encoded = encoder.encode(
    String(env.ts) + env.nonce + JSON.stringify(env.payload),
  )
  // 拷贝到独立 ArrayBuffer，规避 TS5.7+ 的 Uint8Array<ArrayBufferLike> 与
  // BufferSource（要求 ArrayBuffer）的类型不兼容。
  const dataBuf = new ArrayBuffer(encoded.length)
  new Uint8Array(dataBuf).set(encoded)
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBuf)
  return bytesToBase64(new Uint8Array(sig))
}

/** 校验信封签名是否合法（定长比较防时序攻击）。 */
export async function verifyEnvelopeSig(deviceKey: string, env: Envelope): Promise<boolean> {
  const expected = await signEnvelope(deviceKey, env)
  if (expected.length !== env.sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ env.sig.charCodeAt(i)
  return diff === 0
}

/** 生成随机 nonce（16 字节 base64）。用 getRandomValues，两端均有。 */
export function genNonceWeb(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

/** 构造一个已签名的信封（浏览器异步版 makeEnvelope）。 */
export async function makeSignedEnvelope<T>(
  deviceKey: string,
  type: MessageType,
  deviceId: string,
  payload: T,
): Promise<Envelope<T>> {
  const ts = Date.now()
  const nonce = genNonceWeb()
  const sig = await signEnvelope(deviceKey, { ts, nonce, payload })
  return { v: PROTOCOL_VERSION, type, deviceId, ts, nonce, sig, payload }
}
