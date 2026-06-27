// web/src/lib/pair.ts
// 配对流程的纯函数与本地存储（Task 13）。
//
// 设计（Musk Algorithm：把可纯函数化的逻辑从 UI/IO 中拆出来测）：
// - URL pair 参数解析、配对消息构造、配对响应识别、设备身份生成、本地存储
//   全部是无副作用的纯逻辑（除 localStorage 读写，受管 key 受控）。
// - 真实 WebSocket 连中继 /pair 的传输逻辑放在 PairPage 组件里（e2e 覆盖），
//   这里只负责「填什么、怎么发、收到的怎么判」。
//
// 协议对齐（参考 relay/server.ts 的 /pair 实现，单一真相源）：
// - 手机发：{ type:'pair.consume', deviceId, code, deviceKey }
//   （server.ts L97: 校验 msg.type==='pair.consume' && deviceId && code；
//    L101: 配对成功时登记手机 deviceKey —— 所以必须上报自己的 deviceKey）
// - 中继回成功：{ type:'pair.success', payload:{ desktopId, deviceKey } }
//   （deviceKey 是桌面的密钥，下发给手机用于后续 /ws bind 验签）
// - 中继回失败：{ type:'error', payload:{ code:'bad_pair_code' } }

/** localStorage 键（受管字段，clear 时仅清这些，不动用户其他数据）。 */
const LS_KEY_DEVICE = 'ccdesk.device' // 手机自身身份 {deviceId, deviceKey}
const LS_KEY_DESKTOP = 'ccdesk.desktop' // 已配对桌面 {desktopId, desktopKey}

/** 配对码正则：恰好 6 位数字（与 pairing.ts issueCode 输出形态对齐）。 */
const PAIR_CODE_RE = /^\d{6}$/

/** URL 解析结果。 */
export function parsePairCodeFromUrl(urlOrSearch: string): string | null {
  if (!urlOrSearch) return null
  let search: string
  try {
    // 兼容完整 URL 或纯 search 字符串
    if (urlOrSearch.includes('?')) {
      search = urlOrSearch.slice(urlOrSearch.indexOf('?') + 1)
    } else if (urlOrSearch.startsWith('=')) {
      search = urlOrSearch.slice(1)
    } else {
      // 看起来像已剥掉的 key=value（极少见），按 search 处理
      search = urlOrSearch
    }
  } catch {
    return null
  }
  const params = new URLSearchParams(search)
  const raw = params.get('pair')
  if (!raw) return null
  if (!PAIR_CODE_RE.test(raw)) return null
  return raw
}

/** 配对请求消息（发往中继 /pair）。 */
export interface PairConsumeMessage {
  type: 'pair.consume'
  deviceId: string
  code: string
  deviceKey: string
}

/** 构造 pair.consume 请求。 */
export function buildPairConsumeMessage(
  deviceId: string,
  code: string,
  deviceKey: string,
): PairConsumeMessage {
  return { type: 'pair.consume', deviceId, code, deviceKey }
}

/** 配对成功后的桌面身份（手机端持久化）。 */
export interface DesktopIdentity {
  desktopId: string
  desktopKey: string
}

/** 中继下发的 pair.success 信封 payload。 */
interface PairSuccessPayload {
  desktopId: string
  deviceKey: string // 桌面的 deviceKey（中继字段名如此，非笔误）
}

/** 宽松判断是否 pair.success（容忍 payload 字段缺失）。 */
export function isPairSuccess(resp: unknown): boolean {
  return extractPairSuccess(resp) !== null
}

/** 从 pair.success 响应中提取桌面身份；非法返回 null。 */
export function extractPairSuccess(resp: any): DesktopIdentity | null {
  if (!resp || resp.type !== 'pair.success') return null
  const p = resp.payload as PairSuccessPayload | undefined
  if (!p) return null
  const { desktopId, deviceKey } = p
  if (typeof desktopId !== 'string' || !desktopId) return null
  if (typeof deviceKey !== 'string' || !deviceKey) return null
  // 中继字段 deviceKey 即桌面密钥
  return { desktopId, desktopKey: deviceKey }
}

/** 识别中继配对失败响应（type=error）。 */
export function isPairError(resp: any): boolean {
  return !!resp && resp.type === 'error'
}

// ---------- 设备身份生成（Web Crypto，真随机非 mock） ----------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function randomBytesHex(n: number): string {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** 生成手机设备 ID（m- 前缀 + 16 字节 hex）。 */
export function generateDeviceId(): string {
  return 'm-' + randomBytesHex(16)
}

/** 生成设备密钥：32 字节随机数 base64（HMAC-SHA256 key）。 */
export function generateDeviceKey(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return bytesToBase64(b)
}

// ---------- 本地存储（仅动受管字段，保留未知 key） ----------

export interface DeviceIdentity {
  deviceId: string
  deviceKey: string
}

/** 持久化手机自身身份。 */
export function saveDeviceIdentity(deviceId: string, deviceKey: string): void {
  localStorage.setItem(LS_KEY_DEVICE, JSON.stringify({ deviceId, deviceKey }))
}

/** 读取手机自身身份；未存储返回 null。 */
export function loadDeviceIdentity(): DeviceIdentity | null {
  const raw = localStorage.getItem(LS_KEY_DEVICE)
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (typeof v?.deviceId === 'string' && typeof v?.deviceKey === 'string') return v
    return null
  } catch {
    return null
  }
}

/** 持久化已配对桌面身份。 */
export function saveDesktopIdentity(desktopId: string, desktopKey: string): void {
  localStorage.setItem(LS_KEY_DESKTOP, JSON.stringify({ desktopId, desktopKey }))
}

/** 读取已配对桌面身份；未存储返回 null。 */
export function loadDesktopIdentity(): DesktopIdentity | null {
  const raw = localStorage.getItem(LS_KEY_DESKTOP)
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    if (typeof v?.desktopId === 'string' && typeof v?.desktopKey === 'string') return v
    return null
  } catch {
    return null
  }
}

/** 清空配对相关本地存储（仅受管 key，不动用户其他数据）。 */
export function clearPairingStorage(): void {
  localStorage.removeItem(LS_KEY_DEVICE)
  localStorage.removeItem(LS_KEY_DESKTOP)
}
