import type { AppView, AppSettings, Message, PickedElement, Project, SettingsSection, Tab, TabType, ThemeId } from '../types'

export type Action =
  | { type: 'ADD_PROJECT'; name: string; path: string }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'DELETE_SESSION'; projectId: string; sessionId: string }
  | { type: 'ADD_SESSION'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'ADD_MESSAGE'; sessionId: string; message: Message }
  | { type: 'OPEN_FILE_TAB'; filePath: string; fileName: string }
  | { type: 'OPEN_TAB'; tabType: TabType }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SELECT_TAB'; tabId: string }
  | { type: 'SET_THEME'; theme: ThemeId }
  // 草稿：输入框文本 + 拾取附件分离管理
  | { type: 'SET_DRAFT_TEXT'; text: string }
  | { type: 'SET_DRAFT_ATTACHMENT'; attachment: PickedElement }
  | { type: 'CLEAR_DRAFT_ATTACHMENT' }
  | { type: 'SEND_MESSAGE' } // 把当前 draft（text + attachment）合成消息追加到激活会话
  | { type: 'SET_VIEW'; view: AppView }
  | { type: 'SET_SETTINGS_SECTION'; section: SettingsSection }
  // 流式输出：Claude 流式响应的状态机
  | { type: 'STREAM_START'; sessionId: string }
  | { type: 'STREAM_DELTA'; sessionId: string; delta: string }
  | { type: 'STREAM_THINKING'; sessionId: string; delta: string }
  | { type: 'STREAM_TOOL_USE'; sessionId: string; tool: { id: string; name: string } }
  | { type: 'STREAM_END'; sessionId: string; content: any[]; costUSD: number; durationMs: number }
  | { type: 'STREAM_ERROR'; sessionId: string; error: string }
  | { type: 'STREAM_ABORTED'; sessionId: string }
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
