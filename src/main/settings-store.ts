// src/main/settings-store.ts
import Store from 'electron-store'
import { CC_DESK_DIR } from './paths'

export interface ModelProvider {
  id: string
  name: string
  apiKey: string
  // 可选；@anthropic-ai/claude-agent-sdk 的 query() 目前不支持自定义 baseUrl，
  // 此字段作为代理 / 未来端点占位保留，暂不接入真实调用。
  baseUrl: string
  enabled: boolean
}

export interface ModelItem {
  id: string
  name: string             // 模型名（如 glm-5.2）
  providerId: string       // 归属供应商
  contextLength: string    // 上下文窗口标签（展示用，如 '20万'）
  enabled: boolean
}

// Claude Agent SDK 认识的三个模型角色
export type ModelRole = 'opus' | 'sonnet' | 'haiku'

export interface SkillItem {
  id: string
  name: string
  desc: string
  enabled: boolean
  scope: '个人' | '工作区'
}

export interface McpServer {
  id: string
  name: string
  transport: 'stdio' | 'http'
  command: string
  args: string
  env: string
  headers: string
  enabled: boolean
  scope: '用户' | '工作区'
}

export interface Plugin {
  id: string
  name: string
  version: string
  desc: string
  enabled: boolean
  source: '官方' | '社区'
  skills: number
  commands: number
  mcps: number
}

export interface SettingsEntry {
  id: string
  name: string
  desc: string
  enabled: boolean
}

// 代码预览设置（作为一个子对象整体持久化）
export interface CodePreviewSettings {
  lightTheme: string
  darkTheme: string
  showLineNumbers: boolean
  wordWrap: boolean
  fontSize: number
}

export interface AppSettings {
  // 顶层默认 API Key：作为「无供应商 Key」时的回退（GeneralSettings 仍可填）
  apiKey: string
  // 当前会话使用的模型 —— 指向某个 ModelItem.id
  model: string
  cwd: string
  providers: ModelProvider[]
  models: ModelItem[]
  // 按供应商分别映射：key = `${providerId}:${role}`，value = ModelItem.id
  modelRoleMap: Record<string, string>

  // ===== 常规设置（GeneralSettings）=====
  theme: string             // 界面主题 id（与 ThemeId 对应）
  lang: string              // 界面语言
  zoom: string              // 界面缩放 small | normal | large
  proxy: string             // HTTP 代理
  inheritTerminal: boolean
  terminalFont: string
  taskNotify: boolean
  notifySound: boolean
  queueMode: string         // queue | interrupt
  showThinking: boolean
  showTodo: boolean
  showBackendTask: boolean
  autoArchive: boolean
  archiveDays: string

  // ===== 各设置子页 =====
  codePreview: CodePreviewSettings
  skills: SkillItem[]
  mcpServers: McpServer[]
  plugins: Plugin[]
  commands: SettingsEntry[]
  hooks: SettingsEntry[]
}

// 预置默认供应商 + 内置模型
const defaultProviders: ModelProvider[] = [
  { id: 'anthropic', name: 'Anthropic', apiKey: '', baseUrl: '', enabled: true },
]

const defaultModels: ModelItem[] = [
  { id: 'model-opus', name: 'Opus', providerId: 'anthropic', contextLength: '200K', enabled: true },
  { id: 'model-sonnet', name: 'Sonnet', providerId: 'anthropic', contextLength: '200K', enabled: true },
  { id: 'model-haiku', name: 'Haiku', providerId: 'anthropic', contextLength: '200K', enabled: true },
]

const defaultSkills: SkillItem[] = [
  { id: 'ding', name: 'ding', desc: 'Use for Ding-style (钉内/钉外) workplace reminders rooted in the 置身钉内 corpus.', enabled: true, scope: '个人' },
  { id: 'electron', name: 'electron', desc: 'Automate Electron desktop apps (VS Code, Slack, Discord, Figma...).', enabled: true, scope: '个人' },
  { id: 'frontend-design', name: 'frontend-design', desc: 'Create distinctive, production-grade frontend interfaces.', enabled: true, scope: '个人' },
  { id: 'mama', name: 'mama', desc: '妈妈唠叨模式 — 中国式妈妈提醒风格的生产力 coaching。', enabled: true, scope: '个人' },
  { id: 'p10', name: 'p10', desc: 'P10 CTO mode — define strategic direction, design org topology.', enabled: true, scope: '个人' },
  { id: 'p7', name: 'p7', desc: 'P7 Senior Engineer mode — solution-driven execution under P8.', enabled: true, scope: '个人' },
  { id: 'p9', name: 'p9', desc: 'P9 Tech Lead mode — write Task Prompts, manage P8 agent teams.', enabled: true, scope: '个人' },
  { id: 'pro', name: 'pro', desc: 'PUA Pro extensions: self-evolution notes, compaction continuity.', enabled: true, scope: '个人' },
  { id: 'pua', name: 'pua', desc: 'Use for PUA/try-harder productivity coaching when user expresses frustration.', enabled: true, scope: '个人' },
  { id: 'pua-en', name: 'pua-en', desc: 'Performance-coaching mode for repeated failures (English).', enabled: true, scope: '个人' },
  { id: 'pua-ja', name: 'pua-ja', desc: '日本語の生産性コーチングモード。', enabled: true, scope: '个人' },
  { id: 'pua-loop', name: 'pua-loop', desc: 'PUA Loop — guided iterative development with recurring checks.', enabled: true, scope: '个人' },
  { id: 'shot', name: 'shot', desc: 'PUA Shot — compact all-in-one PUA reference.', enabled: true, scope: '个人' },
  { id: 'yes', name: 'yes', desc: 'SB Leader 夸夸模式 — ENFP 型领导，懂情绪有节奏。', enabled: true, scope: '个人' },
]

const defaultMcpServers: McpServer[] = [
  { id: 'playwright', name: 'Playwright', transport: 'stdio', command: 'npx', args: '-y @playwright/mcp@latest', env: '', headers: '', enabled: true, scope: '用户' },
  { id: 'web-reader', name: 'web-reader', transport: 'http', command: 'https://open.bigmodel.cn/api/mcp/web_reader/mcp', args: '', env: '', headers: '', enabled: true, scope: '用户' },
  { id: 'web-search-prime', name: 'web-search-prime', transport: 'http', command: 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp', args: '', env: '', headers: '', enabled: true, scope: '用户' },
  { id: 'zai-mcp-server', name: 'zai-mcp-server', transport: 'stdio', command: 'npx', args: '-y @z_ai/mcp-server', env: '', headers: '', enabled: true, scope: '用户' },
  { id: 'zread', name: 'zread', transport: 'http', command: 'https://open.bigmodel.cn/api/mcp/zread/mcp', args: '', env: '', headers: '', enabled: true, scope: '用户' },
  { id: 'codegraph', name: 'codegraph', transport: 'stdio', command: 'codegraph', args: 'serve --mcp', env: '', headers: '', enabled: true, scope: '用户' },
]

const defaultPlugins: Plugin[] = [
  { id: 'android-emulator', name: 'android-emulator', version: 'v0.1.0', desc: '为 ZCode 提供 Android 开发工作流和模拟器自动化能力。', enabled: false, source: '官方', skills: 0, commands: 0, mcps: 1 },
  { id: 'document-skills', name: 'document-skills', version: 'v0.1.0', desc: 'ZCode 内置的 DOCX 与 PDF 文档生成技能。', enabled: true, source: '官方', skills: 2, commands: 0, mcps: 0 },
  { id: 'ios-simulator', name: 'ios-simulator', version: 'v0.1.0', desc: '为 ZCode 提供 iOS 开发工作流和模拟器自动化能力。', enabled: false, source: '官方', skills: 0, commands: 0, mcps: 1 },
  { id: 'restore-legacy-sessions', name: 'restore-legacy-sessions', version: 'v0.1.0', desc: '选择并恢复旧版 ACP-era ZCode session 到新 ZCode 任务与会话库。', enabled: false, source: '官方', skills: 0, commands: 0, mcps: 0 },
  { id: 'skill-creator', name: 'skill-creator', version: 'v0.1.0', desc: '创建、编辑并迭代本地 ZCode 技能。', enabled: true, source: '官方', skills: 1, commands: 0, mcps: 0 },
  { id: 'superpowers', name: 'superpowers', version: 'v5.1.0', desc: 'Planning, TDD, debugging, and delivery workflows for coding agents.', enabled: true, source: '官方', skills: 14, commands: 0, mcps: 0 },
]

const defaultCommands: SettingsEntry[] = [
  { id: 'c1', name: '/review', desc: '审查代码', enabled: true },
  { id: 'c2', name: '/test', desc: '生成测试', enabled: true },
  { id: 'c3', name: '/commit', desc: '生成提交', enabled: false },
]

const defaultHooks: SettingsEntry[] = [
  { id: 'h1', name: 'PreToolUse', desc: '工具调用前钩子', enabled: true },
  { id: 'h2', name: 'PostToolUse', desc: '工具调用后钩子', enabled: false },
]

const defaults: AppSettings = {
  apiKey: '',
  model: 'model-sonnet',
  cwd: process.env.HOME || '',
  providers: defaultProviders,
  models: defaultModels,
  modelRoleMap: {
    'anthropic:opus': 'model-opus',
    'anthropic:sonnet': 'model-sonnet',
    'anthropic:haiku': 'model-haiku',
  },

  theme: 'codex-light',
  lang: 'zh-CN',
  zoom: 'normal',
  proxy: '',
  inheritTerminal: true,
  terminalFont: 'MesloLGS NF, monospace',
  taskNotify: true,
  notifySound: true,
  queueMode: 'queue',
  showThinking: true,
  showTodo: true,
  showBackendTask: true,
  autoArchive: true,
  archiveDays: '7',

  codePreview: {
    lightTheme: 'GitHub Light',
    darkTheme: 'GitHub Dark',
    showLineNumbers: true,
    wordWrap: false,
    fontSize: 12,
  },
  skills: defaultSkills,
  mcpServers: defaultMcpServers,
  plugins: defaultPlugins,
  commands: defaultCommands,
  hooks: defaultHooks,
}

// Store 实例：固定写入 ~/.cc-desk/settings.json。
// 所有应用数据统一收敛到 ~/.cc-desk/，不再用 dataPath 机制改写存储位置。
// 独立文件名 settings，与模型供应商配置（config.json）隔离，避免共文件混写。
function createStore(): Store<{ settings: AppSettings }> {
  return new Store<{ settings: AppSettings }>({
    name: 'settings',
    cwd: CC_DESK_DIR,
    defaults: { settings: defaults },
  })
}

const store = createStore()

// 字段级默认值回退：旧版本数据可能缺某些字段，逐项补齐
function withDefaults(raw: Partial<AppSettings>): AppSettings {
  const merged: AppSettings = { ...defaults, ...raw }
  // 数组类：缺失或为空时用默认（首次启动或旧数据）
  merged.providers = raw.providers && raw.providers.length > 0 ? raw.providers : defaultProviders
  merged.models = raw.models && raw.models.length > 0 ? raw.models : defaultModels
  merged.skills = raw.skills ?? defaultSkills
  merged.mcpServers = raw.mcpServers ?? defaultMcpServers
  merged.plugins = raw.plugins ?? defaultPlugins
  merged.commands = raw.commands ?? defaultCommands
  merged.hooks = raw.hooks ?? defaultHooks
  merged.modelRoleMap = raw.modelRoleMap ?? defaults.modelRoleMap
  merged.codePreview = { ...defaults.codePreview, ...(raw.codePreview ?? {}) }
  // 标量类：undefined 时回落默认（用 ?? 兜底，保留 false/0/'' 等合法值）
  ;(['theme', 'lang', 'zoom', 'proxy', 'terminalFont', 'queueMode', 'archiveDays'] as const).forEach(k => {
    ;(merged as any)[k] = (raw as any)[k] ?? (defaults as any)[k]
  })
  ;(['inheritTerminal', 'taskNotify', 'notifySound', 'showThinking', 'showTodo', 'showBackendTask', 'autoArchive'] as const).forEach(k => {
    ;(merged as any)[k] = (raw as any)[k] ?? (defaults as any)[k]
  })
  return merged
}

export function getSettings(): AppSettings {
  const raw = store.get('settings', defaults) as Partial<AppSettings>
  const merged = withDefaults(raw)
  // model 不指向任何已存在模型时，回退到第一个 enabled 模型
  if (!merged.models.some(m => m.id === merged.model)) {
    const fallback = merged.models.find(m => m.enabled) ?? merged.models[0]
    merged.model = fallback?.id ?? 'model-sonnet'
  }
  return merged
}

export function saveSettings(partial: Partial<AppSettings>): void {
  const current = getSettings()
  store.set('settings', { ...current, ...partial })
}
