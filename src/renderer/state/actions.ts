import type { Message, PickedElement, TabType, ThemeId } from '../types'

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
