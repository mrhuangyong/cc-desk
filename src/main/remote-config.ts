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

/**
 * 内存态「最近解绑设备」集合（不落盘）。
 *
 * 背景：中继 v1 无 unbind 端点，用户在桌面主动解绑（remote:unpair）后，中继 binding 里
 * 仍残留该设备。若该设备的业务信封还在转发（中继未清 binding），recordPairedDevice 会
 * 把它自动加回 pairedDevices —— 等于用户刚解绑就被偷偷加回，违背用户意图。
 *
 * 这里维护一个进程内的解绑名单，recordPairedDevice 跳过其中的设备，直到用户下次主动
 * 重新发起配对（remote:pair 流程会清空该名单）。不落盘：进程重启后 binding 若仍在转发，
 * 视作用户新会话，可重新登记（保守地倾向重新可见，避免永久屏蔽）。
 */
const recentlyUnpaired = new Set<string>()

/** 标记某设备为「最近解绑」，recordPairedDevice 应跳过它。 */
export function markUnpaired(deviceId: string): void {
  if (deviceId) recentlyUnpaired.add(deviceId)
}

/** 判断是否应把某手机设备登记进 pairedDevices（未解绑且未重复）。纯函数，便于单测。 */
export function shouldRecordPaired(cfg: RemoteConfig, mobileId: string): boolean {
  if (!mobileId) return false
  if (mobileId === cfg.deviceId) return false
  if (recentlyUnpaired.has(mobileId)) return false
  if (cfg.pairedDevices.includes(mobileId)) return false
  return true
}

/** 用户主动重新发起配对时调用，清空解绑名单，允许被解绑设备重新登记。 */
export function clearUnpaired(): void {
  recentlyUnpaired.clear()
}

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
