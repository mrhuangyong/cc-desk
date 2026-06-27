// src/main/paths.ts
// 应用数据的统一根目录。
//
// dev 与正式版隔离（边用边开发场景）：
//   - 正式版（app.isPackaged）：~/.cc-desk
//   - dev 版（!app.isPackaged）：~/.cc-desk-dev
//   两者各自一份 config/projects/settings/Claude 配置，避免同时运行时：
//   ① 中继 deviceId 相同导致连接互相挤掉（router.register 同 deviceId 覆盖）；
//   ② projects.json 并发写丢数据。
//   dev 版首次启动由 migrateDevFromProd 从正式版拷一份作起点（见 index.ts）。
//   显式 process.env.CC_DESK_DIR 仍优先（测试隔离 / 自定义部署）。
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, existsSync } from 'fs'

// 判断 dev 构建。
// 优先级：CC_DESK_DEV 环境变量 > 真实 Electron 运行时的 app.isPackaged > 视为正式版。
// 关键：必须先确认「在真实 Electron 主进程」(process.versions.electron 存在)，
// 否则 vitest 等测试环境里 require('electron') 可能返回桩对象（isPackaged=undefined→!undefined=true），
// 误判为 dev，让断言 ~/.cc-desk 路径的测试全挂。
function detectDevBuild(): boolean {
  if (process.env.CC_DESK_DEV === '1') return true
  if (process.env.CC_DESK_DEV === '0') return false
  // 仅在真实 Electron 运行时（process.versions.electron 由 Electron 注入）才读 app.isPackaged
  if (typeof process !== 'undefined' && (process as any).versions?.electron) {
    try {
      const { app } = require('electron')
      return !app?.isPackaged
    } catch {
      return false
    }
  }
  return false // 测试 / 纯 node 环境：视为正式版，保持 ~/.cc-desk 旧行为
}

const isDevBuild = detectDevBuild()

// 应用数据的统一根目录：dev 用 -dev 后缀隔离。
export const CC_DESK_DIR = process.env.CC_DESK_DIR || join(homedir(), isDevBuild ? '.cc-desk-dev' : '.cc-desk')

// Claude Agent SDK / CLI 子进程的隔离配置目录：默认 <CC_DESK_DIR>/claude。
// 使 SDK 运行时不再读取 ~/.claude/settings.json（其 env 块会覆盖 options.env 注入的
// 角色模型映射，导致 haiku 等后台子任务被 ~/.claude 的模型配置劫持）。
// 改为隔离后，模型/供应商/代理全部由 <CC_DESK_DIR> 自有配置决定。
export const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(CC_DESK_DIR, 'claude')

/** dev 构建？（供其他模块判断是否走 dev 隔离分支，如首次数据迁移）。 */
export const isDevDataDir = isDevBuild

// 在应用启动最早期调用一次：创建隔离目录并写入 process.env.CLAUDE_CONFIG_DIR，
// 使 Claude Agent SDK 的父进程（qt() memoized 读取）与 CLI 子进程 env 块均指向此处。
export function ensureClaudeConfigDir(): void {
  if (!existsSync(CLAUDE_CONFIG_DIR)) mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR
}
