import { describe, it, expect } from 'vitest'
import { reducer } from '../src/renderer/state/reducer'

// 最小可用 AppState，含 backendTasksBySession
function makeState(tasks: any[]) {
  return {
    projects: [], activeSessionId: 's1',
    tabsBySession: {}, activeTabIdBySession: {}, theme: 'codex-light',
    draft: { doc: null, attachments: [] }, currentView: 'workspace',
    activeSettingsSection: 'general', streamingBySession: {}, settings: {} as any,
    claudeSessionMap: {}, pendingDialog: null, dirtyTabIds: {}, lastFileOpenedSeq: 0,
    queueBySession: {}, tasksBySession: {},
    backendTasksBySession: { s1: tasks },
    panelFold: { root: false, taskCard: false, backendTaskCard: false },
  } as any
}

describe('backend task 清除 reducer', () => {
  it('REMOVE_BACKEND_TASK 删除指定任务', () => {
    const s = makeState([
      { id: 'b1', status: 'running' },
      { id: 'b2', status: 'completed' },
    ])
    const next = reducer(s, { type: 'REMOVE_BACKEND_TASK', sessionId: 's1', taskId: 'b2' })
    expect(next.backendTasksBySession.s1.map((t: any) => t.id)).toEqual(['b1'])
  })

  it('REMOVE_BACKEND_TASK 不存在的 id 不报错', () => {
    const s = makeState([{ id: 'b1', status: 'running' }])
    const next = reducer(s, { type: 'REMOVE_BACKEND_TASK', sessionId: 's1', taskId: 'nope' })
    expect(next.backendTasksBySession.s1.map((t: any) => t.id)).toEqual(['b1'])
  })

  it('CLEAR_FINISHED_BACKEND_TASKS 只清非 running，保留 running', () => {
    const s = makeState([
      { id: 'b1', status: 'running' },
      { id: 'b2', status: 'completed' },
      { id: 'b3', status: 'failed' },
      { id: 'b4', status: 'stopped' },
    ])
    const next = reducer(s, { type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: 's1' })
    expect(next.backendTasksBySession.s1.map((t: any) => t.id)).toEqual(['b1'])
  })

  it('CLEAR_FINISHED_BACKEND_TASKS 全是 running 时不变', () => {
    const s = makeState([{ id: 'b1', status: 'running' }, { id: 'b2', status: 'running' }])
    const next = reducer(s, { type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: 's1' })
    expect(next.backendTasksBySession.s1.length).toBe(2)
  })
})
