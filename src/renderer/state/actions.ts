import type { AppView, Message, PickedElement, Project, SettingsSection, TabType, ThemeId } from '../types'

export type Action =
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
  | { type: 'STREAM_END'; sessionId: string; content: any[]; costUSD: number; durationMs: number }
  | { type: 'STREAM_ERROR'; sessionId: string; error: string }
  | { type: 'STREAM_ABORTED'; sessionId: string }
  // 应用设置：apiKey / model / cwd 的部分更新
  | { type: 'SET_SETTINGS'; settings: Partial<{ apiKey: string; model: string; cwd: string }> }
  // 初始化：从主进程拉取的 projects 列表
  | { type: 'INIT_SESSIONS'; projects: Project[] }
