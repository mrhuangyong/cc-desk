import type { TabType, ThemeId } from '../types'

export type Action =
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'DELETE_SESSION'; projectId: string; sessionId: string }
  | { type: 'ADD_SESSION'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'OPEN_FILE_TAB'; filePath: string; fileName: string }
  | { type: 'OPEN_TAB'; tabType: TabType }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SELECT_TAB'; tabId: string }
  | { type: 'SET_THEME'; theme: ThemeId }
