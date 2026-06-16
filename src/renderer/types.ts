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
}

// 项目：包含多个会话
export interface Project {
  id: string
  name: string
  sessions: Session[]
}

// Tab 类型
export type TabType = 'file' | 'browser' | 'terminal'

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
export type ThemeId = 'dark-warm' | 'dark-cool' | 'light-editorial' | 'dark-acid'

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
  apiKey: string     // 表单字段（mock）
  baseUrl: string    // 表单字段（mock）
}

// 模型（模型设置 - 右下列表项）
export interface ModelItem {
  id: string
  name: string
  providerId: string
}

// 技能（设置子页，带启用状态）
export interface SkillItem {
  id: string
  name: string
  desc: string
  enabled: boolean
}

// MCP 服务器
export interface McpServer {
  id: string
  name: string
  url: string
  enabled: boolean
}

// 插件 / 命令 / hook（结构相似：id + name + desc + enabled）
export interface SettingsEntry {
  id: string
  name: string
  desc: string
  enabled: boolean
}
