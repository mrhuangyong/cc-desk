// relay/key-store.ts
// 设备密钥（deviceKey）注册表持久化。
//
// 为什么需要持久化（Important-3）：
// 原 server.ts 的 keyRegistry 是纯内存 Map，中继进程重启（部署/崩溃恢复/OOM）后密钥全丢。
// 已配对设备 bind 时需用密钥验签身份，密钥丢失 → 永久 bad_sig → 必须重新配对。
// 在「公网中继」场景这是严重可用性缺陷。本模块把密钥落盘到 dataDir/keys.json，
// 中继重启后读盘恢复，已配对设备仍可验签 bind。
//
// 安全语义（Task 5 决策不变）：
// - bind 握手时**不信任**客户端上报的新密钥，只用此表已登记密钥验签整条 bind 信封。
// - 登记密钥的唯一信任入口仍是配对流程（pair.code/pair.consume）。
// - registerKey 是「首次登记」语义：已存在则不覆盖（防重放覆盖攻击）。
// 与 binding-store 同构：轻量 JSON KV，构造即同步读盘填充 cache，写异步落盘。
import { readFile, writeFile, mkdir } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { dirname } from 'path'

export type KeyMap = Record<string, string>

export interface KeyStore {
  /** 首次登记语义：仅当 deviceId 尚无密钥时写入，已存在保持原值（信任首次）。返回是否实际写入。 */
  register(deviceId: string, key: string): boolean
  get(deviceId: string): string | undefined
  has(deviceId: string): boolean
}

function isKeyMap(v: unknown): v is KeyMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  // 值必须是字符串（base64 密钥）
  for (const k of Object.keys(v as Record<string, unknown>)) {
    if (typeof (v as Record<string, unknown>)[k] !== 'string') return false
  }
  return true
}

function loadSync(filePath: string): KeyMap {
  try {
    if (!existsSync(filePath)) return {}
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return isKeyMap(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function createKeyStore(filePath: string): KeyStore {
  // 构造即同步读盘：保证 bind 握手同步 get 可用（与 binding-store 一致）。
  let cache: KeyMap = loadSync(filePath)

  async function persist() {
    try {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(cache), 'utf-8')
    } catch {
      // 落盘失败不阻断登记（内存 cache 仍生效），但下次重启会丢这次登记。
      // 与 binding-store.persist 的容错策略一致。
    }
  }

  return {
    register(deviceId, key) {
      if (cache[deviceId] === key) return false // 幂等：同值不重复写
      if (cache[deviceId] !== undefined) return false // 首次登记语义：已存在不覆盖
      cache[deviceId] = key
      void persist() // fire-and-forget（与 pairing.consume 落 binding 同模式）
      return true
    },
    get(deviceId) {
      return cache[deviceId]
    },
    has(deviceId) {
      return cache[deviceId] !== undefined
    },
  }
}
