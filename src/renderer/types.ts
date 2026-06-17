// 拾取的网页元素（从浏览器 Tab 拾取后作为附件）
export interface PickedElement {
  source: string
  tag: string
  text: string
  selector: string
  html: string
}

// 消息：对话流中的一条
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  // 可选：拾取的网页元素附件，发送时带入消息
  attachment?: PickedElement
}

// 输入框草稿：文本 + 可选的拾取附件
export interface Draft {
  text: string
  attachment?: PickedElement
}

// 会话：归属于某个项目
export interface Session {
  id: string
  title: string
  messages: Message[]
  updatedAt?: number    // 最后活动时间戳（ms），用于自动归档判断
}

// 项目：包含多个会话
export interface Project {
  id: string
  name: string
  path?: string
  sessions: Session[]
}

// Tab 类型
export type TabType = 'file' | 'browser' | 'terminal' | 'review'

// Tab：右栏的一个面板
export interface Tab {
  id: string
  type: TabType
  title: string
  // file 类型独有：标识打开的文件路径，用于去重
  filePath?: string
  // browser 类型独有：当前网址
  url?: string
}

// 主题 ID
export type ThemeId = 'codex-light' | 'codex-warm' | 'codex-cool' | 'codex-paper'

// 文件节点：文件树态用
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

// ===== 设置页 =====

// 设置子页标识
export type SettingsSection =
  | 'general' | 'code-preview' | 'model' | 'skills'
  | 'mcp' | 'plugins' | 'commands' | 'hooks'

// 顶层视图
export type AppView = 'workspace' | 'settings'

// 模型提供商（模型设置 - 左侧列表项）
export interface ModelProvider {
  id: string
  name: string
  apiKey: string     // 供应商独立的 API Key（Anthropic）
  baseUrl: string    // 可选占位；SDK 当前不支持自定义 baseUrl
  enabled: boolean
}

// 模型（模型设置 - 右下列表项）
export interface ModelItem {
  id: string
  providerId: string
  sdkModelId: string       // 模型 ID，传给 SDK query() options.model 的真实模型名，也用作展示名
  contextLength: string    // 上下文窗口 token 数（如 200000）
  enabled: boolean
}

// 模型映射槽位：Claude Agent SDK 认识的三个角色
export type ModelRole = 'opus' | 'sonnet' | 'haiku'

// 代码预览设置（CodePreviewSettings 子页）
export interface CodePreviewSettings {
  lightTheme: string
  darkTheme: string
  showLineNumbers: boolean
  wordWrap: boolean
  fontSize: number
}

// 应用设置：与主进程 src/main/settings-store.ts 的 AppSettings 保持一致
export interface AppSettings {
  apiKey: string
  model: string               // 当前会话模型 —— 指向某个 ModelItem.id
  cwd: string
  providers: ModelProvider[]
  models: ModelItem[]
  // 按供应商分别映射：key = `${providerId}:${role}`，value = ModelItem.id
  // 含义：在该供应商下，Claude 的 opus/sonnet/haiku 角色分别用哪个自定义模型
  modelRoleMap: Record<string, string>

  // ===== 常规设置（GeneralSettings）=====
  theme: string
  lang: string
  zoom: string
  proxy: string
  inheritTerminal: boolean
  terminalFont: string
  taskNotify: boolean
  notifySound: boolean
  queueMode: string
  showThinking: boolean
  showTodo: boolean
  autoArchive: boolean
  archiveDays: string
  dataPath: string

  // ===== 各设置子页 =====
  codePreview: CodePreviewSettings
  skills: SkillItem[]
  mcpServers: McpServer[]
  plugins: Plugin[]
  commands: SettingsEntry[]
  hooks: SettingsEntry[]
}

// 技能（设置子页，带启用状态）
export interface SkillItem {
  id: string
  name: string
  desc: string
  enabled: boolean
  scope: '个人' | '工作区'  // 技能来源层级
}

// MCP 服务器
export interface McpServer {
  id: string
  name: string
  transport: 'stdio' | 'http'  // 传输协议
  command: string               // stdio: 命令本体(如 npx)；http: 完整 URL
  args: string                  // stdio: 参数(空格分隔, 如 -y @playwright/mcp@latest)；http: 空
  env: string                   // 环境变量(KEY=VALUE 每行一个)，可选
  enabled: boolean
  scope: '用户' | '工作区'       // 来源层级
}

// 插件 / 命令 / hook（结构相似：id + name + desc + enabled）
export interface SettingsEntry {
  id: string
  name: string
  desc: string
  enabled: boolean
}

// 插件（含版本/来源/技能命令MCP 统计）
export interface Plugin {
  id: string
  name: string
  version: string
  desc: string
  enabled: boolean
  source: '官方' | '社区'   // 来源
  skills: number             // 技能数
  commands: number           // 命令数
  mcps: number               // MCP 数
}
