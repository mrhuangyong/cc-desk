import { shellEnvSync } from 'shell-env'

/**
 * 打包成 .app 后，GUI 进程不执行用户 shell 启动脚本（~/.zshrc / ~/.zprofile），
 * process.env.PATH 只有系统最小集合 /usr/bin:/bin:/usr/sbin:/sbin，于是继承
 * process.env 的 Claude SDK 子进程（见 claude-service.ts 的 env:{...process.env}）
 * 跑 node/npm/pnpm 时报「找不到命令」——这些来自 nvm/homebrew/pnpm/volta/fnm/asdf，
 * 全部由 shell 启动脚本注入，GUI 启动拿不到。
 *
 * 主进程最早调用本函数一次：跑 login shell 取回完整 PATH + 用户 export 的 env vars，
 * 合并进 process.env，让后续所有 SDK 子进程与终端里直接跑 claude 行为一致。
 *
 * 用户 shell 的值优先（覆盖 GUI 最小环境）；PATH 去重且 shell 路径优先、GUI 原路径兜底追加，
 * 既保证 nvm/brew 优先又不丢系统 bin。失败（无 login shell / 超时）静默回退，不阻塞启动。
 *
 * 注意：cc-desk 注入的供应商配置（apiKey/baseUrl）在 claude-service.ts 的
 * `{...process.env, ...buildSdkEnv(...)}` 里最后覆盖，优先级最高，不受此处影响。
 */
export function fixEnvSync(): void {
  let env: Readonly<Record<string, string>>
  try {
    env = shellEnvSync()
  } catch {
    // 无 login shell 或 spawn 失败：保持 GUI 默认 env，不阻塞启动。
    return
  }
  if (!env || typeof env !== 'object') return

  // 用户 shell 的 PATH 优先，GUI 原 PATH 兜底追加（去重，保系统 bin 不丢）。
  process.env.PATH = mergePath(env.PATH, process.env.PATH)

  for (const [k, v] of Object.entries(env)) {
    if (k === 'PATH') continue // 已单独处理
    if (v === undefined || v === null) continue
    process.env[k] = v
  }
}

/**
 * 合并两个 PATH 字符串，去重，前者优先出现。
 * primary（用户 shell PATH）的 nvm/brew 目录排在前面，fallback（GUI 原始 PATH）的系统 bin 兜底。
 */
export function mergePath(primary?: string, fallback?: string): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const list of [primary, fallback]) {
    if (!list) continue
    for (const p of list.split(':')) {
      if (p && !seen.has(p)) {
        seen.add(p)
        parts.push(p)
      }
    }
  }
  return parts.join(':')
}
