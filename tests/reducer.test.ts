import { describe, it, expect } from 'vitest'
import { reducer } from '../src/renderer/state/reducer'
import { mockProjects } from '../src/renderer/state/mockData'
import type { AppState } from '../src/renderer/state/reducer'

// helper：构造初始 state，选中第一个项目的第一个会话
function initialState(): AppState {
  return {
    projects: structuredClone(mockProjects),
    activeSessionId: 's1',
    // 每个 session 的 Tab 组，key = sessionId
    tabsBySession: { s1: [] },
    activeTabId: null,
    theme: 'dark-warm'
  }
}

describe('reducer', () => {
  it('DELETE_SESSION 删除指定会话', () => {
    const state = initialState()
    const next = reducer(state, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's2' })
    const p1 = next.projects.find(p => p.id === 'p1')!
    expect(p1.sessions.find(s => s.id === 's2')).toBeUndefined()
  })

  it('DELETE_PROJECT 级联删除其下所有会话', () => {
    const state = initialState()
    const next = reducer(state, { type: 'DELETE_PROJECT', projectId: 'p1' })
    expect(next.projects.find(p => p.id === 'p1')).toBeUndefined()
  })

  it('ADD_SESSION 当无空会话时新增一条 (p2 has only non-empty s3)', () => {
    const state = initialState()
    const before = state.projects.find(p => p.id === 'p2')!.sessions.length
    const next = reducer(state, { type: 'ADD_SESSION', projectId: 'p2' })
    const after = next.projects.find(p => p.id === 'p2')!.sessions.length
    expect(after).toBe(before + 1)
  })

  it('ADD_SESSION 已有空会话时不新建，切换过去 (p1 has empty s2)', () => {
    const state = initialState()
    const before = state.projects.find(p => p.id === 'p1')!.sessions.length
    const next = reducer(state, { type: 'ADD_SESSION', projectId: 'p1' })
    const after = next.projects.find(p => p.id === 'p1')!.sessions.length
    expect(after).toBe(before) // 数量不变
    expect(next.activeSessionId).toBe('s2') // 切到空会话
  })

  it('OPEN_FILE_TAB 同文件重复打开不新开，切到已存在 Tab', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'src/App.tsx', fileName: 'App.tsx' })
    const firstTabId = s1.activeTabId
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'src/App.tsx', fileName: 'App.tsx' })
    const tabs = s2.tabsBySession['s1']
    expect(tabs.length).toBe(1) // 仍然只有一个
    expect(s2.activeTabId).toBe(firstTabId) // 切到已存在的
  })

  it('OPEN_FILE_TAB 不同文件各自开 Tab', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'src/main.tsx', fileName: 'main.tsx' })
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'package.json', fileName: 'package.json' })
    expect(s2.tabsBySession['s1'].length).toBe(2)
  })

  it('CLOSE_TAB 关掉最后一个后 activeTabId 为 null', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const tabId = s1.activeTabId!
    const s2 = reducer(s1, { type: 'CLOSE_TAB', tabId })
    expect(s2.tabsBySession['s1'].length).toBe(0)
    expect(s2.activeTabId).toBeNull()
  })

  it('CLOSE_TAB 关掉非最后一个后激活剩余的最后一个', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const firstId = s1.activeTabId!
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'b.ts', fileName: 'b.ts' })
    const s3 = reducer(s2, { type: 'CLOSE_TAB', tabId: s2.activeTabId! }) // close the active (2nd) tab
    expect(s3.activeTabId).toBe(firstId)
  })

  it('SELECT_SESSION 不影响其他会话的 Tab 组', () => {
    const state = initialState()
    // 在 s1 开一个 tab
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    expect(s1.tabsBySession['s1'].length).toBe(1)
    // 切到 s2，s1 的 tab 仍在
    const s2 = reducer(s1, { type: 'SELECT_SESSION', sessionId: 's2' })
    expect(s2.activeSessionId).toBe('s2')
    expect(s2.tabsBySession['s1'].length).toBe(1) // 保留
    // s2 还没有 tab 组条目
    expect(s2.tabsBySession['s2']).toBeUndefined()
  })

  it('SET_THEME 更新主题', () => {
    const state = initialState()
    const next = reducer(state, { type: 'SET_THEME', theme: 'dark-acid' })
    expect(next.theme).toBe('dark-acid')
  })

  it('reducer 保持不可变性 (返回新对象，不改原 state)', () => {
    const state = initialState()
    const next = reducer(state, { type: 'ADD_SESSION', projectId: 'p2' })
    expect(next).not.toBe(state)
    expect(next.projects).not.toBe(state.projects)
    // 原 state 的 p2 会话数应不变
    expect(state.projects.find(p => p.id === 'p2')!.sessions.length).toBe(1)
  })
})
