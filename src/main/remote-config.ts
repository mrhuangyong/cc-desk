// src/main/remote-config.ts
// 远程控制配置：~/.cc-desk/config.json 的 remote 段。
// 与 model 配置（cc-desk-store 写同文件的 config 段）分开，独立 Store 实例读写同一文件不同 key。
// 写策略：深合并 + 仅动受管字段（remote 段整体合并），保留 config 段及未知顶层字段。
import Store from 'electron-store'
import { randomBytes, randomUUID } from 'crypto'
import { CC_DESK_DIR } from './paths'

export interface RemoteConfig {
  enabled: boolean
  relayUrl: string
  deviceId: string
  deviceKey: string
  pairedDevices: string[]
}

const DEFAULT: RemoteConfig = {
  enabled: false,
  relayUrl: 'https://ccdesk.mrhua.top',
  deviceId: '',
  deviceKey: '',
  pairedDevices: [],
}

// 与 cc-desk-store 同文件（name: 'config', cwd: CC_DESK_DIR），不同顶层 key（remote vs config）。
// electron-store 各 Store 实例独立读盘，set 只写自己的 key 段，互不覆盖。
const store = new Store<{ remote: RemoteConfig }>({
  name: 'config',
  cwd: CC_DESK_DIR,
  defaults: { remote: DEFAULT },
})

export function getRemoteConfig(): RemoteConfig {
  return { ...DEFAULT, ...store.get('remote', DEFAULT) }
}

/** 浅合并 patch 到 remote 段；未知顶层字段（config 段等）由 electron-store 保留。 */
export function saveRemoteConfig(patch: Partial<RemoteConfig>): void {
  store.set('remote', { ...getRemoteConfig(), ...patch })
}

/** 首次启用远程时生成设备身份（deviceId + 32字节 deviceKey），持久化。幂等。 */
export function ensureDeviceIdentity(): { deviceId: string; deviceKey: string } {
  const cfg = getRemoteConfig()
  if (cfg.deviceId && cfg.deviceKey) return { deviceId: cfg.deviceId, deviceKey: cfg.deviceKey }
  const identity = { deviceId: randomUUID(), deviceKey: randomBytes(32).toString('base64') }
  saveRemoteConfig(identity)
  return identity
}
