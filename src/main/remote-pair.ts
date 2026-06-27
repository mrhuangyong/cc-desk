// src/main/remote-pair.ts
// 远程控制配对辅助：构造中继配对消息 + 二维码 URL。
//
// 纯函数，无 IO，便于单元测试。把「pair 协议消息形态」与「二维码 URL 规则」收敛在这里，
// index.ts 的 IPC handler 只做编排（建临时 ws、发消息、转二维码）。
import type { Envelope, MessageType } from '../shared/remote-protocol'

/** 中继 /pair 端点接收的请求消息（非签名信封，明文 JSON：pair 阶段尚无对端，无需验签）。 */
export interface PairCodeRequest {
  type: 'pair.code'
  deviceId: string
  deviceKey: string
}

/** 中继 /pair 端点对 pair.code 的响应。 */
export interface PairCodeResponse {
  type: 'pair.code'
  payload: { code: string; expiresAt: number }
}

/** 中继 /pair 端点对 pair.consume 失败的响应。 */
export interface PairErrorResponse {
  type: 'error'
  payload: { code: string }
}

/** 构造向中继申请配对码的请求消息。 */
export function buildPairCodeRequest(deviceId: string, deviceKey: string): PairCodeRequest {
  return { type: 'pair.code', deviceId, deviceKey }
}

/**
 * 把配对码拼成手机可扫的 PWA URL。
 * 规则：`${relayUrl}/?pair=${code}`。
 * relayUrl 尾部斜杠归一（避免 `https://x/?pair=` 这种丑陋形式）。
 */
export function buildPairUrl(relayUrl: string, code: string): string {
  const base = relayUrl.replace(/\/+$/, '')
  return `${base}/?pair=${encodeURIComponent(code)}`
}

/** 类型守卫：判断中继返回的 JSON 是否为 pair.code 成功响应。 */
export function isPairCodeResponse(msg: unknown): msg is PairCodeResponse {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as any).type === 'pair.code' &&
    typeof (msg as any).payload?.code === 'string'
  )
}

/** 类型守卫：判断中继返回的 JSON 是否为 error。 */
export function isPairErrorResponse(msg: unknown): msg is PairErrorResponse {
  return (
    typeof msg === 'object' && msg !== null &&
    (msg as any).type === 'error'
  )
}

/**
 * 判断一条入站业务信封是否为「配对请求」（pair.request）。
 * 协议里 pair.request 是中继转发给桌面的「手机请求配对」控制消息；
 * 当前中继 v1 不主动发它（配对走手机单方 consume），但协议定义了该类型，
 * 桌面端防御性处理：收到则弹原生 dialog 让用户确认。
 */
export function isPairRequestEnvelope(env: Envelope): boolean {
  return (env.type as MessageType | string) === 'pair.request'
}
