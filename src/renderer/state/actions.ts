import type { AppView, AppSettings, ContentBlock, Message, PickedElement, Project, SettingsSection, SystemNotice, Tab, TabType, ThemeId, ToolResult, GitFileStatus, DiffScope, ReviewState } from '../types'

export type Action =
  | { type: 'ADD_PROJECT'; name: string; path: string }
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'DELETE_SESSION'; projectId: string; sessionId: string }
  | { type: 'ADD_SESSION'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'ADD_MESSAGE'; sessionId: string; message: Message }
  | { type: 'OPEN_FILE_TAB'; filePath: string; fileName: string }
  | { type: 'OPEN_TAB'; tabType: TabType; cwd?: string; url?: string }
  | { type: 'UPDATE_TAB_URL'; tabId: string; url: string }
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
  | { type: 'STREAM_TOOL_RESULT'; sessionId: string; toolUseId: string; result: ToolResult; planFilePath?: string }
  | { type: 'STREAM_ASSISTANT_BLOCKS'; sessionId: string; blocks: ContentBlock[]; uuid: string }
  | { type: 'STREAM_NOTICE'; sessionId: string; notice: SystemNotice }
  | { type: 'STREAM_ERROR'; sessionId: string; error: string }
  | { type: 'STREAM_ABORTED'; sessionId: string }
  | { type: 'STREAM_END'; sessionId: string; costUSD?: number; durationMs?: number; turns?: number; isError?: boolean }
  // 刷新后恢复:对仍在跑的 session,把其最后一条 assistant message 重建为 streaming 状态,
  // 让续推的新 delta 正确追加到同一 draft(不重复、不丢失)。
  | { type: 'RESTORE_STREAMING'; sessionId: string; draftMessageId: string; blocks: ContentBlock[]; notices: SystemNotice[] }
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
  | { type: 'SHOW_DIALOG'; reqId: string; dialogKind: string; payload: any; toolUseId?: string; sessionId?: string }
  | { type: 'ANSWER_DIALOG' }
  // 消息排队（queue 模式：AI 流式中发送的消息先排队）
  | { type: 'ENQUEUE_MESSAGE'; sessionId: string; prompt: string; attachments: import('../types').DraftAttachment[] }
  | { type: 'DEQUEUE_MESSAGE'; sessionId: string; queueId: string }
  | { type: 'CLEAR_QUEUE'; sessionId: string }
  // 编辑重发：截断指定消息及其之后的所有消息，并用新文本替换该用户消息
  | { type: 'EDIT_RESEND'; sessionId: string; messageId: string; newPrompt: string }
  // 就地编辑态控制
  | { type: 'SET_EDITING_MESSAGE'; messageId: string | null }
  // 队列消息编辑态控制 + 更新排队消息文本
  | { type: 'SET_EDITING_QUEUE'; queueId: string | null }
  | { type: 'UPDATE_QUEUED_MESSAGE'; sessionId: string; queueId: string; prompt: string }
  // Claude task 状态（悬浮面板）
  | { type: 'UPSERT_TASK'; sessionId: string; task: import('../types').TaskItem }
  | { type: 'SET_TASKS'; sessionId: string; tasks: import('../types').TaskItem[] }
  | { type: 'CLEAR_TASKS'; sessionId: string }
  // 用户主动停止时，把该会话所有未结束（pending/running）的 TaskItem 置为 killed，让其停转
  | { type: 'KILL_RUNNING_TASKS'; sessionId: string }
  // 后台任务（悬浮面板）
  | { type: 'UPSERT_BACKEND_TASK'; sessionId: string; task: import('../types').BackendTask }
  | { type: 'CLEAR_BACKEND_TASKS'; sessionId: string }
  | { type: 'REMOVE_BACKEND_TASK'; sessionId: string; taskId: string }
  | { type: 'CLEAR_FINISHED_BACKEND_TASKS'; sessionId: string }
  | { type: 'ARCHIVE_SESSION'; sessionId: string }
  | { type: 'RESTORE_SESSION'; sessionId: string }
  // 移动会话到另一个项目（修改空会话的关联项目）
  | { type: 'MOVE_SESSION'; sessionId: string; toProjectId: string }
  // 悬浮任务面板：root 折叠态 + 拖动位置
  | { type: 'SET_PANEL_FOLD'; panel: 'root'; folded: boolean }
  | { type: 'SET_PANEL_POSITION'; position: { x: number; y: number } }
  | { type: 'APPEND_SUBAGENT_OUTPUT'; sessionId: string; toolUseId: string; block: import('../types').ContentBlock }
  // 计划模式（ExitPlanMode 提交的计划）
  | { type: 'SHOW_PLAN'; sessionId: string; plan: import('../types').PlanProposal }
  | { type: 'DISMISS_PLAN'; sessionId: string }
  // 内置命令相关
  | { type: 'CLEAR_SESSION_MESSAGES'; sessionId: string }
  | { type: 'SET_SESSION_PERMISSION'; sessionId: string; permissionMode: string }
  | { type: 'SET_SESSION_THINKING'; sessionId: string; thinking: 'low' | 'medium' | 'high' }
  | { type: 'ADD_SESSION_DIR'; sessionId: string; dir: string }
  | { type: 'SHOW_COST'; sessionId: string; text: string }
  | { type: 'COMPACT_DONE'; sessionId: string; summary: string; keepRecent: number }
  | { type: 'UPDATE_STATUS'; status: import('../types').UpdateStatus }
  // 审查 tab：按项目分片的 git 状态（git 状态只跟仓库有关，不按会话）
  | { type: 'REVIEW_SET_STATUS'; projectId: string; status: GitFileStatus[] }
  | { type: 'REVIEW_SELECT_FILE'; projectId: string; path: string | null }
  | { type: 'REVIEW_SET_DIFF'; projectId: string; path: string; diff: string }
  | { type: 'REVIEW_SET_DIFF_SCOPE'; projectId: string; scope: DiffScope }
  | { type: 'REVIEW_SET_LOADING'; projectId: string; loading: Partial<Pick<ReviewState, 'loadingStatus' | 'loadingDiffPath' | 'commitBusy'>> }
  | { type: 'REVIEW_SET_ERROR'; projectId: string; error: ReviewState['error'] }
  | { type: 'REVIEW_SET_COMMIT_MESSAGE'; projectId: string; message: string }
  | { type: 'REVIEW_SET_NOTICE'; projectId: string; notice: { kind: 'success' | 'error'; text: string } | null }
  | { type: 'REVIEW_CLEAR_DIFF_CACHE'; projectId: string }
  | { type: 'REVIEW_CLEAR'; projectId: string }
  // 上下文用量（SDK getContextUsage）：更新指定会话的进度环数据
  | { type: 'SET_CONTEXT_USAGE'; sessionId: string; usage: import('./reducer').ContextUsageInfo | null }
