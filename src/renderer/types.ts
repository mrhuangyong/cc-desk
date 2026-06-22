// 拾取的网页元素（从浏览器 Tab 拾取后作为附件）
export interface PickedElement {
  source: string
  tag: string
  text: string
  selector: string
  html: string
}

// ===== 对话内容 block =====
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: any
      status: 'running' | 'completed' | 'error'
      result?: ToolResult
      // ExitPlanMode 专属：plan 文档的磁盘路径（来自 tool_result 的 ExitPlanModeOutput.filePath）。
      // 渲染端据此提供「查看计划」抽屉入口，读取真实文件渲染。
      planFilePath?: string
    }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'image'; source: string }

export interface ToolResult {
  content: string
  isError: boolean
}

// 状态型提示（权限拒绝/API重试/status 等），固化进历史消息
export interface SystemNotice {
  id: string
  kind:
    | 'permission_denied' | 'api_retry' | 'status' | 'hook_progress'
    | 'task' | 'error' | 'info' | 'compact' | 'auth'
  text: string
  level: 'info' | 'warn' | 'error'
}

// 消息：对话流中的一条
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[]
  // 可选：拾取的网页元素附件，发送时带入消息
  attachment?: PickedElement
  attachments?: DraftAttachment[]   // 输入框上方 chip 栏的附件（图片/文件/网页元素）
  notices?: SystemNotice[]
  costUSD?: number
  durationMs?: number
  turns?: number
  isError?: boolean
}

// 输入框草稿：TipTap 文档 JSON + 上方 chip 栏附件
export interface Draft {
  doc: import('./editor/types').TipTapDocJSON | null
  attachments: DraftAttachment[]
}

// 排队消息（queue 模式：AI 流式中发送的消息先排队，完成后自动发送）
export interface QueuedMessage {
  id: string
  prompt: string
  attachments: DraftAttachment[]
}

// Claude task（Task 工具创建的子任务，悬浮面板展示）
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused'
export interface TaskItem {
  id: string                  // SDK 的 task_id
  description: string
  taskType: string
  status: TaskStatus
  // 详情抽屉展示的完整内容（来自 TaskCreate input / TodoWrite todo 项）
  subject?: string            // TaskCreate input.subject
  details?: string            // TaskCreate input.description（详细说明）
  activeForm?: string         // TaskCreate input.activeForm（进行中提示文案）
  createdAt?: number          // 登记时间戳
}

// 计划模式提交（ExitPlanMode）：模型在 plan 模式下产出的计划
export interface PlanProposal {
  toolUseId: string
  plan: string               // Markdown 计划文本
  allowedPrompts?: { tool: string; prompt: string }[]
}

export type BackendTaskKind = 'subagent' | 'workflow' | 'shell' | 'monitor'

export type BackendTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
export interface BackendTask {
  id: string
  localSessionId: string
  command: string
  taskType?: string
  kind: BackendTaskKind
  subagentType?: string
  status: BackendTaskStatus
  startedAt: number
  lastKnownAt: number
  toolUseId?: string              // 触发该任务的 Task tool_use block id(主流隐藏/面板详情锚定)
  // 实时进度(task_progress 事件刷新,~30s 一次)
  progressSummary?: string        // AI 生成的进度摘要
  lastToolName?: string           // 最近调用的工具名
  tokenCount?: number             // 累计 token
  toolUses?: number               // 累计工具调用数
  durationMs?: number             // 累计耗时
  prompt?: string                 // 创建该 subagent 的原始 prompt
}

// 会话：归属于某个项目
export interface Session {
  id: string
  title: string
  messages: Message[]
  archived?: boolean
  archivedAt?: number
  updatedAt?: number    // 最后活动时间戳（ms），用于自动归档判断
  lastUserSentAt?: number   // 用户最后一次发送消息的时间戳（ms），用于会话列表稳定排序（离散事件，不随流式 tick 抖动）
  // 会话级权限/思考（持久化到 projects.json）；undefined 时用默认
  permissionMode?: string          // '变更前确认' | '自动编辑' | '计划模式' | '完全访问'
  thinking?: 'low' | 'medium' | 'high'   // SDK EffortLevel 子集
  extraDirs?: string[]             // /add-dir 追加的可访问目录
  notices?: SystemNotice[]         // 会话级系统提示（cost/status/compact 等固化通知）
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
  // terminal 类型独有：终端工作目录
  cwd?: string
}

// 主题 ID
export type ThemeId = 'codex-light' | 'codex-warm' | 'codex-cool' | 'codex-paper' | 'codex-dark'

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
  | 'general' | 'code-preview' | 'model' | 'memory' | 'skills'
  | 'mcp' | 'plugins' | 'commands' | 'hooks' | 'archived' | 'about'

// 应用更新状态机（全局单例，非按 session 分片）
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

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
  chatWidth: string
  proxy: string
  inheritTerminal: boolean
  terminalFont: string
  taskNotify: boolean
  notifySound: boolean
  notifyOnComplete: boolean
  notifyOnError: boolean
  notifyOnConfirm: boolean
  notifyOnPermission: boolean
  queueMode: string
  showThinking: boolean
  showTodo: boolean
  showBackendTask: boolean
  autoArchive: boolean
  archiveDays: string
  devTools: boolean

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
  headers: string               // http 类型: Headers(KEY: VALUE 每行一个)，可选
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

// ===== 输入框内联 chip / 草稿附件 =====

// 内联 chip（技能或文件），作为 TipTap inline 节点的属性
export interface InlineChipAttrs {
  refId: string   // skill: 带 source 前缀的 id（如 "superpowers:frontend-design"），仅内部标识
                  // file: 文件绝对路径
  label: string   // skill: 技能 name（如 "frontend-design"），展开文本用——Claude 用 SkillTool 按 name 调用
                  // file: 文件名（不含目录），仅显示
}

// 草稿附件（上方 chip 栏），扩展现有 PickedElement
export type DraftAttachment =
  | { type: 'pickedElement'; el: PickedElement }
  | { type: 'image'; name: string; base64: string; mediaType: string }
  | { type: 'file'; name: string; path: string }
