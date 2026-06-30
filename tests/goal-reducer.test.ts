import { describe, it, expect, beforeEach } from 'vitest'
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'
import type { AppState } from '../src/renderer/state/reducer'

function initialState(): AppState {
  return {
    projects: structuredClone(seedProjects), activeSessionId: 's1',
    tabsBySession: { s1: [] }, activeTabIdBySession: { s1: null },
    theme: 'codex-light', draft: { doc: null, attachments: [] },
    currentView: 'workspace', activeSettingsSection: 'general', streamingBySession: {},
    settings: { apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {}, theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', chatWidth: 'wide', proxy: '', inheritTerminal: true, terminalFont: 'x', taskNotify: true, notifySound: true, notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true, queueMode: 'queue', showThinking: true, showTodo: true, showBackendTask: true, rememberPanelPosition: true, autoArchive: true, archiveDays: '7', devTools: false, codePreview: { lightTheme: '', darkTheme: '', showLineNumbers: true, wordWrap: false, fontSize: 12 }, skills: [], mcpServers: [], plugins: [], commands: [], hooks: [] },
    claudeSessionMap: {}, pendingDialog: null, dirtyTabIds: {}, lastFileOpenedSeq: 0,
    queueBySession: {}, tasksBySession: {}, backendTasksBySession: {}, panelFold: { root: false }, panelPosition: { x: 0, y: 0 }, subagentOutputBySession: {}, planBySession: {}, abortedBySession: {}, contextUsageBySession: {}, goalBySession: {}, goalCardOpen: null,
    editingMessageId: null, editingQueueId: null, updateStatus: { state: 'idle' }, reviewByProject: {},
  }
}

describe('goal reducer', () => {
  beforeEach(() => setIdCounter(100))

  it('SET_GOAL 设置 active goal,重置计数器', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'all tests pass' })
    const g = s.goalBySession['s1']
    expect(g).toBeDefined()
    expect(g.status).toBe('active')
    expect(g.condition).toBe('all tests pass')
    expect(g.turns).toBe(0)
    expect(g.startedAt).toBeGreaterThan(0)
  })

  it('SET_GOAL 替换已有 goal', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'A' })
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'B' })
    expect(s.goalBySession['s1'].condition).toBe('B')
    expect(s.goalBySession['s1'].turns).toBe(0)  // 计数器重置
  })

  it('GOAL_EVALUATED 累加 turns + 更新 reason', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'X' })
    s = reducer(s, { type: 'GOAL_EVALUATED', sessionId: 's1', reason: '还差 2 个', turns: 1 })
    expect(s.goalBySession['s1'].turns).toBe(1)
    expect(s.goalBySession['s1'].lastReason).toBe('还差 2 个')
  })

  it('GOAL_ACHIEVED 置 achieved(保留条件/耗时作记录)', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'X' })
    s = reducer(s, { type: 'GOAL_ACHIEVED', sessionId: 's1' })
    expect(s.goalBySession['s1'].status).toBe('achieved')
    expect(s.goalBySession['s1'].condition).toBe('X')  // 保留
  })

  it('CLEAR_GOAL 移除 goal', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'X' })
    s = reducer(s, { type: 'CLEAR_GOAL', sessionId: 's1' })
    expect(s.goalBySession['s1']).toBeUndefined()
  })

  it('SHOW_GOAL_STATUS 置 goalCardOpen,HIDE_GOAL_CARD 清空', () => {
    let s = initialState()
    expect(s.goalCardOpen).toBeNull()
    s = reducer(s, { type: 'SHOW_GOAL_STATUS', sessionId: 's1' })
    expect(s.goalCardOpen).toBe('s1')
    s = reducer(s, { type: 'HIDE_GOAL_CARD' })
    expect(s.goalCardOpen).toBeNull()
  })
})
