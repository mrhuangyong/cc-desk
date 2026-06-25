// relay/binding-store.ts
// 配对绑定关系持久化。双向绑定（A↔B），存一张 deviceId → peerDeviceId 的映射。
// 轻量 JSON KV；v1 单文件，将来可换 Redis（接口不变）。
import { readFile, writeFile, mkdir } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { dirname } from 'path'

export type BindingMap = Record<string, string>

export interface BindingStore {
  addBinding(a: string, b: string): Promise<void>
  removeBinding(deviceId: string): Promise<void>
  getPeer(deviceId: string): string | undefined
  has(deviceId: string): boolean
}

/** 从文件加载整张绑定表。文件不存在或损坏时返回空表。 */
export async function loadBindings(filePath: string): Promise<BindingMap> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 将整张绑定表写回文件（覆盖写）。自动建父目录。 */
export async function saveBindings(filePath: string, map: BindingMap): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(map), 'utf-8')
}

/** 同步读盘：构造时立即填充 cache，保证 getPeer 同步可用。 */
function loadSync(filePath: string): BindingMap {
  try {
    if (!existsSync(filePath)) return {}
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function createBindingStore(filePath: string): BindingStore {
  // 构造即同步读盘，cache 立即可用
  let cache: BindingMap = loadSync(filePath)

  async function persist() {
    await saveBindings(filePath, cache)
  }

  return {
    async addBinding(a, b) {
      cache[a] = b
      cache[b] = a
      await persist()
    },
    async removeBinding(deviceId) {
      const peer = cache[deviceId]
      delete cache[deviceId]
      if (peer) delete cache[peer]
      await persist()
    },
    getPeer(deviceId) {
      return cache[deviceId]
    },
    has(deviceId) {
      return deviceId in cache
    },
  }
}
