// src/main/migrate-dev.ts
// dev 版首次启动：从正式版 ~/.cc-desk 拷一份作起点到 ~/.cc-desk-dev。
//
// 背景：边用边开发场景下，dev 版与正式版数据隔离（见 paths.ts）。
// 为避免 dev 版从空白起步（要重新配模型/配对），首次启动时把正式版的
// config.json / projects.json / settings.json 拷过来。
//
// 关键：**不拷 relay 身份（remote 段）**——dev 版要生成自己的 deviceId，
// 否则 dev 与正式版同 deviceId 连中继仍会互相挤掉（隔离就没意义了）。
// 所以拷 config.json 时剥掉 remote 段，让 dev 版首次启用远程时 ensureDeviceIdentity 新生成。
//
// 幂等：dev 目录已存在则跳过（只首次迁移一次）。
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

const PROD_DIR = join(homedir(), '.cc-desk')

/** 是否 dev 构建（与 paths.ts 同口径）。 */
function isDevBuild(): boolean {
  if (process.env.CC_DESK_DEV === '1') return true
  if (process.env.CC_DESK_DEV === '0') return false
  if (typeof process !== 'undefined' && (process as any).versions?.electron) {
    try {
      const { app } = require('electron')
      return !app?.isPackaged
    } catch {
      return false
    }
  }
  return false
}

/** dev 版首次启动迁移。返回是否执行了迁移。 */
export function migrateDevFromProd(devDir: string): boolean {
  // 仅 dev 构建执行（双重保险）
  if (!isDevBuild()) return false
  // dev 目录已存在 → 已迁移过，跳过
  if (existsSync(devDir)) return false
  // 正式版目录不存在（全新机器）→ 无源可拷，跳过（dev 版从空白起步）
  if (!existsSync(PROD_DIR)) return false

  mkdirSync(devDir, { recursive: true })

  // 1. projects.json / settings.json：原样拷贝（会话、UI 设置）
  for (const name of ['projects.json', 'settings.json']) {
    const src = join(PROD_DIR, name)
    if (existsSync(src)) {
      try { copyFileSync(src, join(devDir, name)) } catch { /* 忽略单文件失败 */ }
    }
  }

  // 2. config.json：拷贝但**剥掉 remote 段**（relay 身份要 dev 独立生成）
  const cfgSrc = join(PROD_DIR, 'config.json')
  if (existsSync(cfgSrc)) {
    try {
      const parsed = JSON.parse(readFileSync(cfgSrc, 'utf-8'))
      if (parsed && typeof parsed === 'object') {
        delete parsed.remote // 剥掉 relay 身份（deviceId/deviceKey/pairedDevices）
        writeFileSync(join(devDir, 'config.json'), JSON.stringify(parsed), 'utf-8')
      }
    } catch { /* 解析失败则不拷，dev 版首次启动自建空配置 */ }
  }

  // 3. claude 子目录（插件/skills/mcp 配置）：不拷。
  //    插件体积大且 dev 版开发时可能频繁改，需要时由 dev 版设置页重装或 migrate-from-claude 处理。
  //    SDK 配置（model/env）已在 config.json 的 config 段，够用。

  return true
}
