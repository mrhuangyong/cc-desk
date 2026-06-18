import type { AppView, AppSettings, ContentBlock, Message, PickedElement, Project, SettingsSection, SystemNotice, Tab, TabType, ThemeId, ToolResult } from '../types'

export type Action =
  | { type: 'ADD_PROJECT'; name: string; path: string }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'DELETE_SESSION'; projectId: string; sessionId: string }
  | { type: 'ADD_SESSION'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'ADD_MESSAGE'; sessionId: string; message: Message }
  | { type: 'OPEN_FILE_TAB'; filePath: string; fileName: string }
  | { type: 'OPEN_TAB'; tabType: TabType; cwd?: string }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'TAB_DIRTY'; tabId: string; dirty: boolean }
  | { type: 'SELECT_TAB'; tabId: string }
  | { type: 'SET_THEME'; theme: ThemeId }
  // 草稿：TipTap doc JSON + 上方 chip 栏附件
  | { type: 'SET_DRAFT_DOC'; doc: import('../editor/types').TipTapDocJSON | null }
  | { type: 'ADD_DRAFT_ATTACHMENT'; attachment: import('../types').DraftAttachment }
  | { type: 'REMOVE_DRAFT_ATTACHMENT'; index: number }
  | { type: 'CLEAR_DRAFT' }
  | { type: 'SEND_MESSAGE' } // 把当前 draft（doc + attachments）序列化后追加到激活会话
  | { type: 'SET_VIEW'; view: AppView }
  | { type: 'SET_SETTINGS_SECTION'; section: SettingsSection }
  // 流式输出：blocks 拼接规约（按会话隔离）
  | { type: 'STREAM_START'; sessionId: string }
  | { type: 'STREAM_DELTA'; sessionId: string; kind: 'text' | 'thinking'; delta: string }
  | { type: 'STREAM_TOOL_USE_START'; sessionId: string; block: Extract<ContentBlock, { type: 'tool_use' }> }
  | { type: 'STREAM_TOOL_RESULT'; sessionId: string; toolUseId: string; result: ToolResult }
  | { type: 'STREAM_ASSISTANT_BLOCKS'; sessionId: string; blocks: ContentBlock[]; uuid: string }
  | { type: 'STREAM_NOTICE'; sessionId: string; notice: SystemNotice }
  | { type: 'STREAM_ERROR'; sessionId: string; error: string }
  | { type: 'STREAM_ABORTED'; sessionId: string }
  | { type: 'STREAM_END'; sessionId: string; costUSD?: number; durationMs?: number; turns?: number; isError?: boolean }
  // 应用设置：AppSettings 的部分更新（apiKey / model / cwd / providers / models）
  | { type: 'SET_SETTINGS'; settings: Partial<AppSettings> }
  // 初始化：从主进程拉取的 projects 列表
  | { type: 'INIT_SESSIONS'; projects: Project[] }
  // 启动时从主进程注入持久化的工作区快照（含 tabs/sessionMap/idCounter）
  | {
      type: 'HYDRATE'
      snapshot: {
        projects: Project[]
        activeSessionId: string
        tabsBySession: Record<string, Tab[]>
        activeTabIdBySession: Record<string, string | null>
        claudeSessionMap: Record<string, string>
        lastSeq: number
      }
    }
  // 捕获 Claude 返回的真实 sessionId，建立 localSessionId → claudeSessionId 映射
  | { type: 'SET_CLAUDE_SESSION_ID'; localSessionId: string; claudeSessionId: string }
  // 自动归档：删除超过阈值无活动且无消息的空会话
  | { type: 'ARCHIVE_STALE'; beforeTs: number }
  // AskUserQuestion 等用户对话：显示/应答
  | { type: 'SHOW_DIALOG'; reqId: string; dialogKind: string; payload: any; toolUseId?: string }
  | { type: 'ANSWER_DIALOG' }
  // 消息排队（queue 模式：AI 流式中发送的消息先排队）
  | { type: 'ENQUEUE_MESSAGE'; sessionId: string; prompt: string; attachments: import('../types').DraftAttachment[] }
  | { type: 'DEQUEUE_MESSAGE'; sessionId: string; queueId: string }
  | { type: 'CLEAR_QUEUE'; sessionId: string }
  // Claude task 状态（悬浮面板）
  | { type: 'UPSERT_TASK'; sessionId: string; task: import('../types').TaskItem }
  | { type: 'CLEAR_TASKS'; sessionId: string }
