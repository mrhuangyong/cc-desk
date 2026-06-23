// reducer 未测 case 补充测试：queue / task / plan / dialog / backend-task。
// reducer 是纯函数，构造最小 state + dispatch action 断言下一状态。
import { describe, it, expect, beforeEach } from 'vitest'
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import type { AppState } from '../src/renderer/state/reducer'

function initialState(): AppState {
  return {
    projects: [], activeSessionId: 's1',
    tabsBySession: {}, activeTabIdBySession: {},
    theme: 'codex-light', draft: { doc: null, attachments: [] },
    currentView: 'workspace', activeSettingsSection: 'general',
    streamingBySession: {},
    settings: {
      apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', chatWidth: 'wide', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true, devTools: false, queueMode: 'queue',
      showThinking: false, showTodo: false, showBackendTask: true, rememberPanelPosition: true, autoArchive: true, archiveDays: '7',
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
    claudeSessionMap: {}, pendingDialog: null,
    dirtyTabIds: {}, lastFileOpenedSeq: 0,
    queueBySession: {}, tasksBySession: {}, backendTasksBySession: {},
    panelFold: { root: false }, panelPosition: { x: 0, y: 0 },
    subagentOutputBySession: {},
    planBySession: {},
    abortedBySession: {},
    editingMessageId: null, editingQueueId: null,
    updateStatus: { state: 'idle' },
  }
}

describe('reducer: queue 模式', () => {
  beforeEach(() => setIdCounter(0))

  it('ENQUEUE_MESSAGE 入队', () => {
    const next = reducer(initialState(), { type: 'ENQUEUE_MESSAGE', sessionId: 's1', prompt: 'hi', attachments: [] })
    expect(next.queueBySession.s1.length).toBe(1)
    expect(next.queueBySession.s1[0].prompt).toBe('hi')
    expect(next.queueBySession.s1[0].id).toBeTruthy()
  })

  it('DEQUEUE_MESSAGE 按队列 id 移除', () => {
    let s = initialState()
    s = reducer(s, { type: 'ENQUEUE_MESSAGE', sessionId: 's1', prompt: 'a', attachments: [] })
    s = reducer(s, { type: 'ENQUEUE_MESSAGE', sessionId: 's1', prompt: 'b', attachments: [] })
    const firstId = s.queueBySession.s1[0].id
    s = reducer(s, { type: 'DEQUEUE_MESSAGE', sessionId: 's1', queueId: firstId })
    expect(s.queueBySession.s1.map(m => m.prompt)).toEqual(['b'])
  })

  it('CLEAR_QUEUE 清空指定会话队列', () => {
    let s = initialState()
    s = reducer(s, { type: 'ENQUEUE_MESSAGE', sessionId: 's1', prompt: 'a', attachments: [] })
    s = reducer(s, { type: 'ENQUEUE_MESSAGE', sessionId: 's2', prompt: 'b', attachments: [] })
    s = reducer(s, { type: 'CLEAR_QUEUE', sessionId: 's1' })
    expect(s.queueBySession.s1).toEqual([])
    expect(s.queueBySession.s2.length).toBe(1)  // 其他会话不受影响
  })
})

describe('reducer: task（普通子任务）', () => {
  it('UPSERT_TASK 新增', () => {
    const next = reducer(initialState(), { type: 'UPSERT_TASK', sessionId: 's1', task: { id: 't1', description: '搜索', taskType: 'agent', status: 'running' } })
    expect(next.tasksBySession.s1.length).toBe(1)
    expect(next.tasksBySession.s1[0].id).toBe('t1')
  })

  it('UPSERT_TASK 更新已有（按 id 合并）', () => {
    let s = initialState()
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: { id: 't1', description: '搜索', taskType: 'agent', status: 'running' } })
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: { id: 't1', description: '搜索', taskType: 'agent', status: 'completed' } })
    expect(next_tasks(s, 's1').length).toBe(1)
    expect(next_tasks(s, 's1')[0].status).toBe('completed')
  })

  it('CLEAR_TASKS 清空', () => {
    let s = initialState()
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: { id: 't1', description: '', taskType: '', status: 'running' } })
    s = reducer(s, { type: 'CLEAR_TASKS', sessionId: 's1' })
    expect(s.tasksBySession.s1).toEqual([])
  })
})

describe('reducer: backend-task', () => {
  it('UPSERT_BACKEND_TASK 新增/更新', () => {
    let s = initialState()
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg1', localSessionId: 's1', command: 'sleep 30', kind: 'workflow', status: 'running', startedAt: 1, lastKnownAt: 1 } })
    expect(s.backendTasksBySession.s1.length).toBe(1)
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg1', localSessionId: 's1', command: 'sleep 30', kind: 'workflow', status: 'completed', startedAt: 1, lastKnownAt: 2 } })
    expect(s.backendTasksBySession.s1.length).toBe(1)
    expect(s.backendTasksBySession.s1[0].status).toBe('completed')
  })

  it('REMOVE_BACKEND_TASK 删除指定', () => {
    let s = initialState()
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg1', localSessionId: 's1', command: 'c', kind: 'workflow', status: 'running', startedAt: 1, lastKnownAt: 1 } })
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg2', localSessionId: 's1', command: 'c', kind: 'workflow', status: 'running', startedAt: 1, lastKnownAt: 1 } })
    s = reducer(s, { type: 'REMOVE_BACKEND_TASK', sessionId: 's1', taskId: 'bg1' })
    expect(s.backendTasksBySession.s1.map(t => t.id)).toEqual(['bg2'])
  })

  it('CLEAR_FINISHED_BACKEND_TASKS 仅保留 running', () => {
    let s = initialState()
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg1', localSessionId: 's1', command: 'c', kind: 'workflow', status: 'running', startedAt: 1, lastKnownAt: 1 } })
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg2', localSessionId: 's1', command: 'c', kind: 'workflow', status: 'completed', startedAt: 1, lastKnownAt: 1 } })
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg3', localSessionId: 's1', command: 'c', kind: 'workflow', status: 'failed', startedAt: 1, lastKnownAt: 1 } })
    s = reducer(s, { type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: 's1' })
    expect(s.backendTasksBySession.s1.map(t => t.id)).toEqual(['bg1'])
  })

  it('CLEAR_BACKEND_TASKS 清空', () => {
    let s = initialState()
    s = reducer(s, { type: 'UPSERT_BACKEND_TASK', sessionId: 's1', task: { id: 'bg1', localSessionId: 's1', command: 'c', kind: 'workflow', status: 'running', startedAt: 1, lastKnownAt: 1 } })
    s = reducer(s, { type: 'CLEAR_BACKEND_TASKS', sessionId: 's1' })
    expect(s.backendTasksBySession.s1).toEqual([])
  })
})

describe('reducer: dialog（AskUserQuestion）', () => {
  it('SHOW_DIALOG 设置 pendingDialog', () => {
    const next = reducer(initialState(), { type: 'SHOW_DIALOG', reqId: 'r1', dialogKind: 'ask_user_question', payload: { questions: [] }, toolUseId: 'tu1' })
    expect(next.pendingDialog).toEqual({ reqId: 'r1', dialogKind: 'ask_user_question', payload: { questions: [] }, toolUseId: 'tu1' })
  })

  it('ANSWER_DIALOG 清空 pendingDialog', () => {
    let s = initialState()
    s = reducer(s, { type: 'SHOW_DIALOG', reqId: 'r1', dialogKind: 'ask_user_question', payload: {}, toolUseId: 'tu1' })
    s = reducer(s, { type: 'ANSWER_DIALOG' })
    expect(s.pendingDialog).toBeNull()
  })
})

describe('reducer: plan（ExitPlanMode）', () => {
  it('SHOW_PLAN 设置 planBySession', () => {
    const next = reducer(initialState(), { type: 'SHOW_PLAN', sessionId: 's1', plan: { toolUseId: 'p1', plan: '# 计划' } })
    expect(next.planBySession.s1).toEqual({ toolUseId: 'p1', plan: '# 计划' })
  })

  it('SHOW_PLAN 覆盖前一条（每次提交覆盖）', () => {
    let s = initialState()
    s = reducer(s, { type: 'SHOW_PLAN', sessionId: 's1', plan: { toolUseId: 'p1', plan: 'old' } })
    s = reducer(s, { type: 'SHOW_PLAN', sessionId: 's1', plan: { toolUseId: 'p2', plan: 'new' } })
    expect((s.planBySession.s1 as any).plan).toBe('new')
  })

  it('DISMISS_PLAN 清空为 null', () => {
    let s = initialState()
    s = reducer(s, { type: 'SHOW_PLAN', sessionId: 's1', plan: { toolUseId: 'p1', plan: 'x' } })
    s = reducer(s, { type: 'DISMISS_PLAN', sessionId: 's1' })
    expect(s.planBySession.s1).toBeNull()
  })
})

// helper
function next_tasks(s: AppState, sid: string) { return s.tasksBySession[sid] ?? [] }


describe('reducer: subagent output & panel fold', () => {
  it('APPEND_SUBAGENT_OUTPUT 按 toolUseId 累积子代理输出', () => {
    let state = reducer(initialState(), {
      type: 'APPEND_SUBAGENT_OUTPUT', sessionId: 's1', toolUseId: 'tu1',
      block: { type: 'text', text: '子代理说了一句话' },
    })
    expect(state.subagentOutputBySession['s1']?.['tu1']).toEqual([{ type: 'text', text: '子代理说了一句话' }])

    state = reducer(state, {
      type: 'APPEND_SUBAGENT_OUTPUT', sessionId: 's1', toolUseId: 'tu1',
      block: { type: 'text', text: '第二句' },
    })
    expect(state.subagentOutputBySession['s1']?.['tu1']).toEqual([
      { type: 'text', text: '子代理说了一句话' },
      { type: 'text', text: '第二句' },
    ])
  })

  it('SET_PANEL_FOLD 设置 root 折叠态', () => {
    const state = reducer(initialState(), {
      type: 'SET_PANEL_FOLD', panel: 'root', folded: true,
    })
    expect(state.panelFold.root).toBe(true)
  })
})
