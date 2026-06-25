// src/main/paths.ts
// 应用数据的统一根目录：~/.cc-desk
// 所有自有持久化（settings / projects / 模型供应商配置 / 日志）均落在此目录下，
// 不再散落到 electron 默认的 userData 目录，也不再用 dataPath 机制改写存储位置。
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, existsSync } from 'fs'

// 应用数据的统一根目录：默认 ~/.cc-desk。
// 若显式设置 process.env.CC_DESK_DIR（自定义部署 / 测试隔离），优先采用它。
// 与 CLAUDE_CONFIG_DIR 同模式，支持测试隔离到 tmpdir，不触碰真实 ~/.cc-desk。
export const CC_DESK_DIR = process.env.CC_DESK_DIR || join(homedir(), '.cc-desk')

// Claude Agent SDK / CLI 子进程的隔离配置目录：默认 ~/.cc-desk/claude。
// 使 SDK 运行时不再读取 ~/.claude/settings.json（其 env 块会覆盖 options.env 注入的
// 角色模型映射，导致 haiku 等后台子任务被 ~/.claude 的模型配置劫持）。
// 改为隔离后，模型/供应商/代理全部由 ~/.cc-desk 自有配置决定。
// 若已显式设置 process.env.CLAUDE_CONFIG_DIR（自定义部署 / 测试隔离），优先采用它。
export const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(CC_DESK_DIR, 'claude')

// 在应用启动最早期调用一次：创建隔离目录并写入 process.env.CLAUDE_CONFIG_DIR，
// 使 Claude Agent SDK 的父进程（qt() memoized 读取）与 CLI 子进程 env 均指向此处。
export function ensureClaudeConfigDir(): void {
  if (!existsSync(CLAUDE_CONFIG_DIR)) mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR
}
