// src/main/claude-config.ts
// 设置页的数据源：读写 cc-desk 隔离的 Claude 配置目录（CLAUDE_CONFIG_DIR = ~/.cc-desk/claude）。
// 与 Claude Agent SDK 运行时同一目录，确保设置页展示/编辑的配置即实际生效配置，
// 不再读写 ~/.claude（那是 Claude CLI 原生目录，与 cc-desk 运行时隔离）。
//
// 数据源映射（均在 CLAUDE_CONFIG_DIR 下）：
//   settings.json        —— 用户级设置：env / model / theme / language /
//                            enabledPlugins / hooks / permissions / extraKnownMarketplaces
//   .claude.json         —— 全局状态：mcpServers（全局 MCP 配置）+ projects（各项目配置）
//   plugins/installed_plugins.json —— 已安装插件清单
//   plugins/cache/<marketplace>/<plugin>/<version>/.claude-plugin/plugin.json —— 插件 manifest
//   <pluginPath>/skills/<name>/SKILL.md   —— 技能（frontmatter: name + description）
//   <pluginPath>/commands/<name>.md        —— 命令
//
// 写策略：深合并 + 仅动受管字段，保留用户的其他配置（append-only 思想，不删除未知 key）。
import { readFile, writeFile, readdir, stat, mkdir, cp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { BUILTIN_COMMANDS } from './builtin-commands'
import { CLAUDE_CONFIG_DIR } from './paths'

// 所有配置文件均落在 CLAUDE_CONFIG_DIR（~/.cc-desk/claude），与 SDK 运行时一致。
const CLAUDE_DIR = CLAUDE_CONFIG_DIR
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')
const GLOBAL_PATH = join(CLAUDE_DIR, '.claude.json')
const INSTALLED_PLUGINS_PATH = join(CLAUDE_DIR, 'plugins', 'installed_plugins.json')
const PLUGINS_CACHE_DIR = join(CLAUDE_DIR, 'plugins', 'cache')

async function readJson<T = any>(path: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(path)) return fallback
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// 写入前确保父目录存在（隔离目录的 plugins/ 等子目录首次写入时缺失）。
async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

// ---- 类型定义（与渲染端 types.ts 的子集对应，独立声明避免循环依赖）----

export interface ClaudeMcpServer {
  id: string                // 用 name 作 id
  name: string
  transport: 'stdio' | 'http'
  command: string           // stdio: 命令本体；http: URL
  args: string              // stdio: 空格分隔参数
  env: string               // KEY=VALUE 每行一个
  headers: string           // http 类型：KEY: VALUE 每行一个
  enabled: boolean
  scope: '用户' | '工作区'  // 当前仅读全局（用户级）
}

export interface ClaudePlugin {
  id: string                // plugin@marketplace
  name: string
  version: string
  desc: string
  enabled: boolean          // 来自 settings.json 的 enabledPlugins
  source: string            // marketplace 名
  installPath: string
  skills: number
  commands: number
  mcps: number
}

export interface ClaudeSkill {
  id: string
  name: string
  desc: string
  enabled: boolean          // 跟随所属插件的启用状态
  scope: '个人' | '工作区'  // 个人=用户级（~/.claude/skills），工作区=插件提供
  source: string            // 来源插件名
  path: string              // SKILL.md 绝对路径（详情弹窗读写用）
}

export interface ClaudeCommand {
  id: string
  name: string              // /name
  desc: string
  enabled: boolean          // 跟随所属插件
  source: string
  // 内置命令透传：渲染端据此区分 builtin 并分发到 handler
  kind?: 'command' | 'builtin'
  builtinAction?: import('../renderer/editor/types').BuiltinAction
}

export interface ClaudeHook {
  id: string
  name: string              // 事件名（PreToolUse / PostToolUse / 等）
  desc: string
  enabled: boolean
}

// ---- settings.json 读写（受管字段）----

const SETTINGS_KEYS = ['env', 'model', 'theme', 'language', 'enabledPlugins', 'hooks', 'permissions'] as const

export async function getSettingsJson(): Promise<Record<string, any>> {
  return readJson<Record<string, any>>(SETTINGS_PATH, {})
}

// 仅写回受管字段的合并；其它顶层 key 原样保留
export async function saveSettingsJson(patch: Record<string, any>): Promise<void> {
  const cur = await getSettingsJson()
  for (const k of Object.keys(patch)) {
    const v = patch[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object') {
      cur[k] = { ...(cur[k] as object), ...v }
    } else {
      cur[k] = v
    }
  }
  await writeJson(SETTINGS_PATH, cur)
}

async function saveSettingsJsonReplace(patch: Record<string, any>): Promise<void> {
  const cur = await getSettingsJson()
  for (const k of Object.keys(patch)) cur[k] = patch[k]
  await writeJson(SETTINGS_PATH, cur)
}

// ---- ~/.claude.json（全局 mcpServers）----

export async function getGlobalJson(): Promise<Record<string, any>> {
  return readJson<Record<string, any>>(GLOBAL_PATH, {})
}

async function saveGlobalJson(mutator: (root: Record<string, any>) => void): Promise<void> {
  const root = await getGlobalJson()
  mutator(root)
  await writeJson(GLOBAL_PATH, root)
}

// ---- MCP ----

// 真实 mcpServers 结构（两种形态）：
//   stdio: { command, args[], env?, type?:'stdio' }
//   http:  { type:'http', url, headers? }
const DISABLED_MCP_STASH_KEY = 'ccDeskDisabledMcpServers'

function parseMcpEntry(name: string, raw: any, enabled = true): ClaudeMcpServer {
  const isHttp = raw.type === 'http' || (!!raw.url && !raw.command)
  if (isHttp) {
    return {
      id: name, name, transport: 'http',
      command: raw.url || '',
      args: '', env: '',
      headers: raw.headers && typeof raw.headers === 'object'
        ? Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`).join('\n')
        : '',
      enabled, scope: '用户',
    }
  }
  return {
    id: name, name, transport: 'stdio',
    command: raw.command || '',
    args: Array.isArray(raw.args) ? raw.args.join(' ') : '',
    env: raw.env && typeof raw.env === 'object'
      ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join('\n')
      : '',
    headers: '',
    enabled, scope: '用户',
  }
}

// args 归一化：数组 join，字符串 split。兼容 JSON 模式传入标准格式形态。
function normalizeArgs(args: any): string[] {
  if (Array.isArray(args)) return args.map(String)
  if (typeof args === 'string') {
    const t = args.trim()
    return t ? t.split(/\s+/) : []
  }
  return []
}
// env 归一化：对象直用，字符串按 KEY=VALUE 解析。
function normalizeEnv(env: any): Record<string, string> {
  if (env && typeof env === 'object') return env as Record<string, string>
  const obj: Record<string, string> = {}
  if (typeof env === 'string') {
    env.split('\n').forEach(line => {
      const i = line.indexOf('=')
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1)
    })
  }
  return obj
}
// headers 归一化：对象直用，字符串按 KEY: VALUE 解析。
function normalizeHeaders(headers: any): Record<string, string> {
  if (headers && typeof headers === 'object') return headers as Record<string, string>
  const obj: Record<string, string> = {}
  if (typeof headers === 'string') {
    headers.split('\n').forEach(line => {
      const i = line.indexOf(':')
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    })
  }
  return obj
}

function buildMcpEntry(s: ClaudeMcpServer): Record<string, any> {
  if (s.transport === 'http') {
    const obj: any = { type: 'http', url: s.command }
    const headers = normalizeHeaders(s.headers)
    if (Object.keys(headers).length) obj.headers = headers
    return obj
  }
  const obj: any = { command: s.command }
  const args = normalizeArgs(s.args)
  if (args.length) obj.args = args
  const envObj = normalizeEnv(s.env)
  if (Object.keys(envObj).length) obj.env = envObj
  return obj
}

export async function getMcpServers(): Promise<ClaudeMcpServer[]> {
  const root = await getGlobalJson()
  const settings = await getSettingsJson()
  const servers = root.mcpServers && typeof root.mcpServers === 'object' ? root.mcpServers : {}
  const disabled = settings[DISABLED_MCP_STASH_KEY] && typeof settings[DISABLED_MCP_STASH_KEY] === 'object'
    ? settings[DISABLED_MCP_STASH_KEY]
    : {}
  const active = Object.entries(servers).map(([name, raw]) => parseMcpEntry(name, raw, true))
  const stashed = Object.entries(disabled)
    .filter(([name]) => !(name in servers))
    .map(([name, raw]) => parseMcpEntry(name, raw, false))
  return [...active, ...stashed]
}

export async function saveMcpServers(servers: ClaudeMcpServer[]): Promise<void> {
  const map: Record<string, any> = {}
  const disabled: Record<string, any> = {}
  for (const s of servers) {
    if (s.enabled) map[s.name] = buildMcpEntry(s)
    else disabled[s.name] = buildMcpEntry(s)
  }
  await saveGlobalJson(root => { root.mcpServers = map })
  await saveSettingsJsonReplace({ [DISABLED_MCP_STASH_KEY]: disabled })
}

// ---- 插件 ----

export interface InstalledPlugin { scope: string; installPath: string; version: string }

async function readPluginManifest(installPath: string): Promise<any | null> {
  const manifestPath = join(installPath, '.claude-plugin', 'plugin.json')
  return readJson<any>(manifestPath, null)
}

// 读取 installed_plugins.json 原始结构（供 marketplace-manager 级联清理用）
export async function readInstalledPlugins(): Promise<{ version?: number; plugins: Record<string, InstalledPlugin[]> }> {
  return readJson<{ version?: number; plugins: Record<string, InstalledPlugin[]> }>(INSTALLED_PLUGINS_PATH, { plugins: {} })
}

// 写回 installed_plugins.json
export async function writeInstalledPlugins(data: { version?: number; plugins: Record<string, InstalledPlugin[]> }): Promise<void> {
  await writeJson(INSTALLED_PLUGINS_PATH, data)
}

async function countDir(path: string): Promise<number> {
  try {
    if (!existsSync(path)) return 0
    const st = await stat(path)
    if (!st.isDirectory()) return 0
    const entries = await readdir(path)
    return entries.length
  } catch { return 0 }
}

export async function getPlugins(): Promise<ClaudePlugin[]> {
  const installed = await readJson<{ plugins?: Record<string, InstalledPlugin[]> }>(INSTALLED_PLUGINS_PATH, { plugins: {} })
  const settings = await getSettingsJson()
  const enabledPlugins: Record<string, boolean> = settings.enabledPlugins ?? {}
  const out: ClaudePlugin[] = []
  for (const [id, installs] of Object.entries(installed.plugins ?? {})) {
    const inst = installs?.[0]
    if (!inst) continue
    const manifest = await readPluginManifest(inst.installPath)
    const name = manifest?.name ?? id.split('@')[0]
    const marketplace = id.split('@')[1] ?? ''
    out.push({
      id,
      name,
      version: inst.version || manifest?.version || 'unknown',
      desc: manifest?.description ?? '',
      enabled: enabledPlugins[id] === true,
      source: marketplace,
      installPath: inst.installPath,
      skills: await countDir(join(inst.installPath, 'skills')),
      commands: await countDir(join(inst.installPath, 'commands')),
      mcps: await countDir(join(inst.installPath, 'mcp')),
    })
  }
  return out
}

// 切换插件启用：写回 settings.json 的 enabledPlugins（append-only，只改这一个 map）
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const settings = await getSettingsJson()
  const map: Record<string, boolean> = { ...(settings.enabledPlugins ?? {}) }
  if (enabled) map[id] = true
  else delete map[id]
  // 注意：不能用 saveSettingsJson({ enabledPlugins: map })——其对象字段深合并会让被 delete 的旧 key 复活。
  // 直接整对象替换，确保删除生效。
  settings.enabledPlugins = map
  await writeJson(SETTINGS_PATH, settings)
}

// ---- 技能（扫描已启用插件的 skills/ + 用户级 ~/.claude/skills/）----

function parseSkillFrontmatter(md: string): { name: string; description: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return { name: '', description: '' }
  const fm = m[1]
  const name = fm.match(/name:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  const desc = fm.match(/description:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
  return { name, description: desc }
}

async function scanSkillsInDir(dir: string, source: string, scope: '个人' | '工作区', enabled: boolean): Promise<ClaudeSkill[]> {
  const out: ClaudeSkill[] = []
  if (!existsSync(dir)) return out
  let entries: string[]
  try { entries = await readdir(dir) } catch { return out }
  for (const e of entries) {
    const skillMd = join(dir, e, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    try {
      const md = await readFile(skillMd, 'utf-8')
      const { name, description } = parseSkillFrontmatter(md)
      out.push({
        id: `${source}:${e}`,
        name: name || e,
        desc: description,
        enabled,
        scope,
        source,
        path: skillMd,
      })
    } catch { /* skip */ }
  }
  return out
}

export async function getSkills(): Promise<ClaudeSkill[]> {
  const plugins = await getPlugins()
  const out: ClaudeSkill[] = []
  for (const p of plugins) {
    if (!p.enabled) continue
    const skills = await scanSkillsInDir(join(p.installPath, 'skills'), p.name, '工作区', true)
    out.push(...skills)
  }
  // 用户级技能（~/.claude/skills/）—— 这些是用户自建，默认启用
  const userSkills = await scanSkillsInDir(join(CLAUDE_DIR, 'skills'), 'user', '个人', true)
  out.push(...userSkills)
  // 用 disabledSkills 黑名单覆盖 enabled（黑名单里的技能标记为禁用）
  const disabled = await getDisabledSkills()
  for (const s of out) s.enabled = !disabled.includes(s.name)
  return out
}

// 读取 settings.json 的 disabledSkills 黑名单（技能级启停）。
export async function getDisabledSkills(): Promise<string[]> {
  const settings = await getSettingsJson()
  const arr = settings.disabledSkills
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
}

// 切换单条技能启用状态：false 加入黑名单，true 从黑名单移除。落盘 settings.json。
export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const cur = await getDisabledSkills()
  const next = enabled ? cur.filter(n => n !== name) : [...new Set([...cur, name])]
  await saveSettingsJsonReplace({ disabledSkills: next })
}

// 按技能 id 读取 SKILL.md 全文。找不到时返回空串（详情弹窗容错）。
export async function getSkillFile(id: string): Promise<string> {
  const skill = (await getSkills()).find(s => s.id === id)
  if (!skill || !skill.path || !existsSync(skill.path)) return ''
  try { return await readFile(skill.path, 'utf-8') } catch { return '' }
}

// 按技能 id 写回 SKILL.md（详情弹窗编辑后落盘）。
export async function saveSkillFile(id: string, content: string): Promise<void> {
  const skill = (await getSkills()).find(s => s.id === id)
  if (!skill || !skill.path) return
  await writeFile(skill.path, content, 'utf-8')
}

// ---- 命令（扫描已启用插件的 commands/*.md + 用户级）----

async function scanCommandsInDir(dir: string, source: string, enabled: boolean): Promise<ClaudeCommand[]> {
  const out: ClaudeCommand[] = []
  if (!existsSync(dir)) return out
  let entries: string[]
  try { entries = await readdir(dir) } catch { return out }
  for (const e of entries) {
    if (!e.endsWith('.md')) continue
    const name = e.replace(/\.md$/, '')
    let desc = ''
    try {
      const md = await readFile(join(dir, e), 'utf-8')
      const fm = md.match(/^---\n([\s\S]*?)\n---/)
      if (fm) desc = fm[1].match(/description:\s*(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
      if (!desc) desc = md.split('\n').find(l => l.startsWith('#'))?.replace(/^#+\s*/, '') ?? ''
    } catch { /* skip */ }
    out.push({ id: `${source}:${name}`, name: `/${name}`, desc, enabled, source })
  }
  return out
}

export async function getCommands(): Promise<ClaudeCommand[]> {
  const plugins = await getPlugins()
  const out: ClaudeCommand[] = []
  // 内置命令（最前）
  for (const b of BUILTIN_COMMANDS) {
    out.push({ id: b.id, name: b.name, desc: b.desc, enabled: true, source: 'builtin', kind: 'builtin', builtinAction: b.builtinAction })
  }
  for (const p of plugins) {
    if (!p.enabled) continue
    out.push(...await scanCommandsInDir(join(p.installPath, 'commands'), p.name, true))
  }
  out.push(...await scanCommandsInDir(join(CLAUDE_DIR, 'commands'), 'user', true))
  return out
}

// ---- hooks（settings.json 的 hooks 字段）----

// Claude Code 的 hooks 结构：{ PreToolUse: [{ matcher, hooks: [...] }], ... }
// 这里以「事件类型是否存在配置」作为是否「启用」的展示依据（简化）。
const HOOK_EVENTS = ['PreToolUse', 'PostToolUse', 'Notification', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'PreCompact']

export async function getHooks(): Promise<ClaudeHook[]> {
  const settings = await getSettingsJson()
  const hooks = settings.hooks ?? {}
  return HOOK_EVENTS.map(name => ({
    id: name,
    name,
    desc: `${name} 钩子`,
    enabled: Array.isArray(hooks[name]) && hooks[name].length > 0,
  }))
}

// 切换 hook 启用：简化为「有配置=启用，无=禁用」。当前仅展示状态，写入需具体配置，
// 故 toggle 在「禁用」时清空该事件数组，「启用」时若为空补一个空配置占位。
export async function setHookEnabled(name: string, enabled: boolean): Promise<void> {
  const settings = await getSettingsJson()
  const hooks: Record<string, any> = { ...(settings.hooks ?? {}) }
  if (enabled) {
    if (!Array.isArray(hooks[name]) || hooks[name].length === 0) {
      hooks[name] = [{ matcher: '', hooks: [{ type: 'command', command: '' }] }]
    }
  } else {
    hooks[name] = []
  }
  await saveSettingsJson({ hooks })
}

// ---- 模型 / 常规（env + model + theme + language）----

export interface ModelConfig {
  // 来自 settings.json
  model: string
  apiKey: string              // env.ANTHROPIC_API_KEY
  baseUrl: string             // env.ANTHROPIC_BASE_URL
  authToken: string           // env.ANTHROPIC_AUTH_TOKEN
  // 三个角色映射到具体模型
  opusModel: string           // env.ANTHROPIC_DEFAULT_OPUS_MODEL
  sonnetModel: string         // env.ANTHROPIC_DEFAULT_SONNET_MODEL
  haikuModel: string          // env.ANTHROPIC_DEFAULT_HAIKU_MODEL
}

export async function getModelConfig(): Promise<ModelConfig> {
  const settings = await getSettingsJson()
  const env: Record<string, string> = settings.env ?? {}
  return {
    model: settings.model ?? '',
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    baseUrl: env.ANTHROPIC_BASE_URL ?? '',
    authToken: env.ANTHROPIC_AUTH_TOKEN ?? '',
    opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? '',
    sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '',
    haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? '',
  }
}

export async function saveModelConfig(cfg: Partial<ModelConfig>): Promise<void> {
  const envPatch: Record<string, string> = {}
  if (cfg.apiKey !== undefined) envPatch.ANTHROPIC_API_KEY = cfg.apiKey
  if (cfg.baseUrl !== undefined) envPatch.ANTHROPIC_BASE_URL = cfg.baseUrl
  if (cfg.authToken !== undefined) envPatch.ANTHROPIC_AUTH_TOKEN = cfg.authToken
  if (cfg.opusModel !== undefined) envPatch.ANTHROPIC_DEFAULT_OPUS_MODEL = cfg.opusModel
  if (cfg.sonnetModel !== undefined) envPatch.ANTHROPIC_DEFAULT_SONNET_MODEL = cfg.sonnetModel
  if (cfg.haikuModel !== undefined) envPatch.ANTHROPIC_DEFAULT_HAIKU_MODEL = cfg.haikuModel
  const settingsPatch: Record<string, any> = {}
  if (Object.keys(envPatch).length) settingsPatch.env = envPatch
  if (cfg.model !== undefined) settingsPatch.model = cfg.model
  if (Object.keys(settingsPatch).length) await saveSettingsJson(settingsPatch)
}

// ---- 常规设置（theme/language/proxy 等）----

export interface GeneralConfig {
  theme: string
  language: string
  proxy: string              // env.HTTP_PROXY / HTTPS_PROXY
}

export async function getGeneralConfig(): Promise<GeneralConfig> {
  const settings = await getSettingsJson()
  const env: Record<string, string> = settings.env ?? {}
  return {
    theme: settings.theme ?? 'dark',
    language: settings.language ?? 'English',
    proxy: env.HTTPS_PROXY ?? env.HTTP_PROXY ?? '',
  }
}

export async function saveGeneralConfig(cfg: Partial<GeneralConfig>): Promise<void> {
  const settingsPatch: Record<string, any> = {}
  if (cfg.theme !== undefined) settingsPatch.theme = cfg.theme
  if (cfg.language !== undefined) settingsPatch.language = cfg.language
  const envPatch: Record<string, string> = {}
  if (cfg.proxy !== undefined) { envPatch.HTTPS_PROXY = cfg.proxy; envPatch.HTTP_PROXY = cfg.proxy }
  if (Object.keys(envPatch).length) settingsPatch.env = envPatch
  if (Object.keys(settingsPatch).length) await saveSettingsJson(settingsPatch)
}

// 导出 PLUGINS_CACHE_DIR 供其它用途（暂留）
export { PLUGINS_CACHE_DIR }

// ---- 插件安装 / 卸载 ----

// 安装插件：从 marketplace 目录拷贝到 versioned cache + 写 installed_plugins.json + 写 settings.json。
// pluginId 格式：plugin@marketplace。当前仅支持本地相对路径 source（'./xxx'）。
export async function installPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
  const [pluginName, marketplaceName] = pluginId.split('@')
  if (!pluginName || !marketplaceName) {
    return { success: false, message: `无效的插件 ID: ${pluginId}（格式：plugin@marketplace）` }
  }

  // 从 known_marketplaces.json 找仓库条目（含 installLocation + source）
  const knownConfig = await readJson<Record<string, any>>(join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json'), {})
  const mktEntry = knownConfig[marketplaceName]
  if (!mktEntry) {
    return { success: false, message: `仓库「${marketplaceName}」未注册` }
  }

  // 读 marketplace.json 找插件 entry
  const { getMarketplacePlugins } = await import('./marketplace-manager')
  let entry: any
  try {
    const plugins = await getMarketplacePlugins(marketplaceName)
    entry = plugins.find((p: any) => p.name === pluginName)
  } catch {
    return { success: false, message: `仓库「${marketplaceName}」不存在或无法读取` }
  }
  if (!entry) {
    return { success: false, message: `插件「${pluginName}」在仓库「${marketplaceName}」中未找到` }
  }

  // 判断 source 类型：仅支持本地相对路径（'./xxx'）
  if (typeof entry.source !== 'string' || !entry.source.startsWith('./')) {
    return { success: false, message: `插件「${pluginName}」使用远程 source，当前版本暂不支持远程插件安装` }
  }

  // marketplaceDir：directory/file 取 installLocation（原路径），github/git 取 clone 出来的目录
  const marketplaceDir = mktEntry.source.source === 'directory' ? mktEntry.installLocation
    : mktEntry.source.source === 'file' ? dirname(mktEntry.installLocation)
    : mktEntry.installLocation

  const sourcePath = join(marketplaceDir, entry.source)

  // 读 manifest 获取 version
  const manifestPath = join(sourcePath, '.claude-plugin', 'plugin.json')
  const manifest = await readJson<any>(manifestPath, null)
  if (!manifest) {
    return { success: false, message: `插件 manifest 未找到: ${manifestPath}` }
  }
  const version = manifest.version || entry.version || 'unknown'

  // versioned cache 路径
  const versionedPath = join(PLUGINS_CACHE_DIR, marketplaceName, pluginName, version)

  // 幂等：已安装同版本则跳过
  const installed = await readInstalledPlugins()
  const existing = installed.plugins[pluginId]
  if (existing && existing.some((i: InstalledPlugin) => i.version === version)) {
    return { success: true, message: `插件「${pluginName}」已是最新版本（${version}）` }
  }

  // 拷贝
  await mkdir(versionedPath, { recursive: true })
  await cp(sourcePath, versionedPath, { recursive: true })

  // 写 installed_plugins.json
  if (!installed.plugins[pluginId]) installed.plugins[pluginId] = []
  installed.plugins[pluginId].push({ scope: 'user', installPath: versionedPath, version })
  await writeInstalledPlugins(installed)

  // 写 settings.json enabledPlugins
  await setPluginEnabled(pluginId, true)

  return { success: true, message: `插件「${pluginName}」安装成功（v${version}）` }
}

// 卸载插件：删 cache + 移除 installed_plugins.json + 移除 settings.json enabledPlugins。
export async function uninstallPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
  const installed = await readInstalledPlugins()
  const installations = installed.plugins[pluginId]
  if (!installations || installations.length === 0) {
    throw new Error(`插件「${pluginId}」未安装`)
  }

  // 删除 versioned cache（仅当无其他安装引用该路径）
  for (const inst of installations) {
    const stillUsed = Object.entries(installed.plugins)
      .filter(([id]) => id !== pluginId)
      .some(([, arr]) => arr.some((i: InstalledPlugin) => i.installPath === inst.installPath))
    if (!stillUsed) {
      await rm(inst.installPath, { recursive: true, force: true }).catch(() => {})
    }
  }

  // 从 installed_plugins.json 移除
  delete installed.plugins[pluginId]
  await writeInstalledPlugins(installed)

  // 从 settings.json enabledPlugins 移除（整对象替换确保删除生效）
  const settings = await getSettingsJson()
  const map: Record<string, boolean> = { ...(settings.enabledPlugins ?? {}) }
  delete map[pluginId]
  settings.enabledPlugins = map
  await writeJson(SETTINGS_PATH, settings)

  const [pluginName] = pluginId.split('@')
  return { success: true, message: `插件「${pluginName}」已卸载` }
}
