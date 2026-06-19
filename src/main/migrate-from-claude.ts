// src/main/migrate-from-claude.ts
// 一次性迁移：把 Claude CLI 原生目录 ~/.claude 的插件/技能/设置迁移到隔离的
// CLAUDE_CONFIG_DIR（~/.cc-desk/claude），使设置页与 SDK 运行时在隔离目录也能看到
// 原有插件与配置。迁移后 cc-desk 完全自洽，不再依赖 ~/.claude。
//
// 迁移内容：
//   - plugins/（cache + marketplaces + data + installed_plugins.json + known_marketplaces.json）
//   - skills/（用户级技能）
//   - settings.json 的非运行时字段（enabledPlugins / extraKnownMarketplaces / hooks / theme /
//     language / permissions / worktree / enableWorkflows 等）
//
// 明确排除（避免再次污染 cc-desk 运行时）：
//   - settings.json 的 env（模型/API/代理配置，由 cc-desk config.json 自管）
//   - settings.json 的 model（由 cc-desk activeModelId 自管）
//
// 绝对路径改写：installed_plugins.json 的 installPath、known_marketplaces.json 的
// installLocation 原指向 ~/.claude/plugins/...，迁移后改写为 CLAUDE_CONFIG_DIR/plugins/...。
import { existsSync, cpSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { CLAUDE_CONFIG_DIR } from './paths'

const SOURCE_CLAUDE_DIR = join(homedir(), '.claude')

export interface MigrationResult {
  migrated: boolean
  reason?: string
  plugins?: number
  skills?: boolean
}

// settings.json 中禁止迁移的字段（cc-desk 运行时自管，迁移会引入污染）。
const EXCLUDED_SETTINGS_KEYS = new Set(['env', 'model'])

// 需要迁移的 settings.json 顶层字段（白名单外的未知字段也一并带过去，除非在排除集里）。
function pickSettingsFields(src: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(src)) {
    if (EXCLUDED_SETTINGS_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

// 把 json 文件里的 ~/.claude 绝对路径前缀改写为 CLAUDE_CONFIG_DIR。
function rewritePaths(filePath: string, oldPrefix: string, newPrefix: string): void {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, 'utf-8')
  // 字符串替换：installPath / installLocation 均以 SOURCE_CLAUDE_DIR 为前缀。
  const rewritten = raw.split(oldPrefix).join(newPrefix)
  writeFileSync(filePath, rewritten, 'utf-8')
}

/**
 * 执行迁移。幂等：若 CLAUDE_CONFIG_DIR/plugins 已存在则视为已迁移，跳过 plugins 拷贝
 * （但仍合并 settings.json 缺失字段，保证配置补齐）。
 * 源目录 ~/.claude 不存在时安全返回。
 */
export async function migrateFromClaude(): Promise<MigrationResult> {
  if (!existsSync(SOURCE_CLAUDE_DIR)) {
    return { migrated: false, reason: 'source ~/.claude not found' }
  }

  const destPluginsDir = join(CLAUDE_CONFIG_DIR, 'plugins')
  let pluginCount = 0

  // 1. plugins 目录：已存在则跳过（幂等），否则整目录拷贝并改写绝对路径。
  if (!existsSync(destPluginsDir)) {
    const srcPluginsDir = join(SOURCE_CLAUDE_DIR, 'plugins')
    if (existsSync(srcPluginsDir)) {
      cpSync(srcPluginsDir, destPluginsDir, { recursive: true })
      // 改写 installed_plugins.json / known_marketplaces.json 里的绝对路径
      rewritePaths(join(destPluginsDir, 'installed_plugins.json'), SOURCE_CLAUDE_DIR, CLAUDE_CONFIG_DIR)
      rewritePaths(join(destPluginsDir, 'known_marketplaces.json'), SOURCE_CLAUDE_DIR, CLAUDE_CONFIG_DIR)
      try {
        const installed = JSON.parse(readFileSync(join(destPluginsDir, 'installed_plugins.json'), 'utf-8'))
        pluginCount = Object.keys(installed.plugins ?? {}).length
      } catch { /* 计数失败不影响迁移 */ }
    }
  } else {
    try {
      const installed = JSON.parse(readFileSync(join(destPluginsDir, 'installed_plugins.json'), 'utf-8'))
      pluginCount = Object.keys(installed.plugins ?? {}).length
    } catch { /* ignore */ }
  }

  // 2. 用户级 skills/：逐次拷贝（已存在的文件不覆盖，保留隔离目录自建技能）。
  const srcSkillsDir = join(SOURCE_CLAUDE_DIR, 'skills')
  let skillsMigrated = false
  if (existsSync(srcSkillsDir)) {
    const destSkillsDir = join(CLAUDE_CONFIG_DIR, 'skills')
    if (!existsSync(destSkillsDir)) {
      cpSync(srcSkillsDir, destSkillsDir, { recursive: true })
      skillsMigrated = true
    } else {
      // 已存在：合并拷贝（同名目录跳过，避免覆盖自建技能）
      cpSync(srcSkillsDir, destSkillsDir, { recursive: true, force: false, errorOnExist: false })
      skillsMigrated = true
    }
  }

  // 3. settings.json：合并迁移非运行时字段到隔离目录，不覆盖已有字段。
  const srcSettingsPath = join(SOURCE_CLAUDE_DIR, 'settings.json')
  const destSettingsPath = join(CLAUDE_CONFIG_DIR, 'settings.json')
  if (existsSync(srcSettingsPath)) {
    const srcSettings = JSON.parse(readFileSync(srcSettingsPath, 'utf-8'))
    const picked = pickSettingsFields(srcSettings)
    let merged: Record<string, any>
    if (existsSync(destSettingsPath)) {
      // 隔离目录已有 settings.json：只补充缺失字段，不动已有（保留 cc-desk 运行时配置）
      const dest = JSON.parse(readFileSync(destSettingsPath, 'utf-8'))
      merged = { ...picked, ...dest }
    } else {
      merged = picked
    }
    writeFileSync(destSettingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
  }

  return { migrated: true, plugins: pluginCount, skills: skillsMigrated }
}
