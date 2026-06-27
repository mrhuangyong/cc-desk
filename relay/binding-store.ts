// relay/binding-store.ts
// 配对绑定关系持久化。**一对多**：一个桌面可绑定多个手机（1 D ↔ N M）。
//
// 历史坑（本文件修复的根因）：
//   原为单值映射 Record<string,string>（deviceId → 单个 peer）。当桌面绑多个手机时，
//   cache[桌面] 被反复覆盖成最后一个手机；桌面→手机的响应（session.list 等）经
//   router.getPeer(桌面) 路由到错误/离线的手机，导致新扫码的手机收不到数据。
//   现改为 Map<deviceId, Set<peerId>>，getPeers 返回全部对端，router 据此广播。
//
// 持久化格式：
//   新格式：{ [id]: [peer1, peer2, ...] }（值是数组，支持一对多）。
//   读盘向后兼容旧单值格式 { [id]: "peer" }（字符串）→ 转成单元素集合，不丢已配对关系。
import { readFile, writeFile, mkdir } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { dirname } from 'path'

/** 绑定表：deviceId → 对端集合（一对多）。 */
export type BindingMap = Record<string, string[]>

export interface BindingStore {
  addBinding(a: string, b: string): Promise<void>
  removeBinding(deviceId: string): Promise<void>
  /** 返回全部对端（一对多）。未绑定返回空集合。 */
  getPeers(deviceId: string): Set<string>
  /** 返回任意一个对端（向后兼容旧调用方；一对多下不保证是哪个）。未绑定返回 undefined。 */
  getPeer(deviceId: string): string | undefined
  has(deviceId: string): boolean
}

/** 从文件加载整张绑定表。文件不存在/损坏返回空表。兼容旧单值格式。 */
export async function loadBindings(filePath: string): Promise<BindingMap> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return normalizeMap(parsed)
  } catch {
    return {}
  }
}

/** 将整张绑定表写回文件（覆盖写）。自动建父目录。 */
export async function saveBindings(filePath: string, map: BindingMap): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(map), 'utf-8')
}

/** 把任意解析结果规整为 BindingMap（数组值）。兼容旧单值字符串格式与数组格式。 */
function normalizeMap(parsed: unknown): BindingMap {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: BindingMap = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = [v] // 旧单值格式
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string')
  }
  return out
}

/** 同步读盘：构造时立即填充 cache，保证 getPeers 同步可用。 */
function loadSync(filePath: string): BindingMap {
  try {
    if (!existsSync(filePath)) return {}
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return normalizeMap(parsed)
  } catch {
    return {}
  }
}

export function createBindingStore(filePath: string): BindingStore {
  let cache: BindingMap = loadSync(filePath)
  // 一次性数据修复（迁移）：旧单值格式下「桌面→手机」被反复覆盖，导致桌面只记得最后一个手机，
  // 但「手机→桌面」是完整的。这里在读盘后做对称化补全：若 A 的 peers 含 B，则 B 的 peers 也补上 A。
  // 修复后 persist 落盘成新格式（数组）。幂等：对称的数据不会被改动。
  let dirty = false
  for (const a in cache) {
    for (const b of cache[a]) {
      if (!cache[b]) { cache[b] = [a]; dirty = true; continue }
      if (!cache[b].includes(a)) { cache[b].push(a); dirty = true }
    }
  }
  if (dirty) void saveBindings(filePath, cache)

  async function persist() {
    await saveBindings(filePath, cache)
  }

  return {
    async addBinding(a, b) {
      // 双向加入集合（幂等）
      const setA = cache[a] ?? (cache[a] = [])
      const setB = cache[b] ?? (cache[b] = [])
      if (!setA.includes(b)) setA.push(b)
      if (!setB.includes(a)) setB.push(a)
      await persist()
    },
    async removeBinding(deviceId) {
      // 删自己 + 从所有对端的集合里移除自己
      const peers = cache[deviceId] ?? []
      delete cache[deviceId]
      for (const p of peers) {
        if (cache[p]) cache[p] = cache[p].filter((x) => x !== deviceId)
      }
      await persist()
    },
    getPeers(deviceId) {
      return new Set(cache[deviceId] ?? [])
    },
    getPeer(deviceId) {
      const arr = cache[deviceId]
      return arr && arr.length ? arr[0] : undefined
    },
    has(deviceId) {
      return (cache[deviceId]?.length ?? 0) > 0
    },
  }
}
