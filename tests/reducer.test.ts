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
    activeTabIdBySession: { s1: null },
    theme: 'codex-light',
    draft: { text: '' },
    currentView: 'workspace',
    activeSettingsSection: 'general',
    streamingBySession: {},
    settings: { apiKey: '', model: 'sonnet', cwd: '' },
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

  it('DELETE_SESSION 删掉当前激活会话后，activeSessionId 自动切到存活会话', () => {
    const state = initialState() // activeSessionId = 's1', p1 has s1+s2, p2 has s3
    const next = reducer(state, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's1' })
    // s1 被删，应自动切到另一个存活会话（s2 或 s3 之一，且必须真实存在）
    const allSurvivingSessions = next.projects.flatMap(p => p.sessions.map(s => s.id))
    expect(allSurvivingSessions).toContain(next.activeSessionId)
    expect(next.activeSessionId).not.toBe('s1')
  })

  it('DELETE_PROJECT 删掉含激活会话的项目后，activeSessionId 切到存活会话', () => {
    const state = initialState() // active = s1 (in p1)
    const next = reducer(state, { type: 'DELETE_PROJECT', projectId: 'p1' })
    // p1 整个没了，s1 不存在了，应切到 p2 的 s3
    expect(next.activeSessionId).toBe('s3')
  })

  it('删除非激活会话不影响 activeSessionId', () => {
    const state = initialState() // active = s1
    const next = reducer(state, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's2' })
    expect(next.activeSessionId).toBe('s1') // 不变
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
    const firstTabId = s1.activeTabIdBySession['s1']
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'src/App.tsx', fileName: 'App.tsx' })
    const tabs = s2.tabsBySession['s1']
    expect(tabs.length).toBe(1) // 仍然只有一个
    expect(s2.activeTabIdBySession['s1']).toBe(firstTabId) // 切到已存在的
  })

  it('OPEN_FILE_TAB 不同文件各自开 Tab', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'src/main.tsx', fileName: 'main.tsx' })
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'package.json', fileName: 'package.json' })
    expect(s2.tabsBySession['s1'].length).toBe(2)
  })

  it('OPEN_TAB 开启 browser 类型 Tab', () => {
    const state = initialState()
    const next = reducer(state, { type: 'OPEN_TAB', tabType: 'browser' })
    expect(next.tabsBySession['s1'].length).toBe(1)
    expect(next.tabsBySession['s1'][0].type).toBe('browser')
    expect(next.activeTabIdBySession['s1']).toBe(next.tabsBySession['s1'][0].id)
  })

  it('OPEN_TAB 同类型可开多个 (browser x2 不去重)', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_TAB', tabType: 'browser' })
    const s2 = reducer(s1, { type: 'OPEN_TAB', tabType: 'browser' })
    expect(s2.tabsBySession['s1'].length).toBe(2) // browser 不去重，可多开
  })

  it('CLOSE_TAB 关掉最后一个后 activeTabId 为 null', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const tabId = s1.activeTabIdBySession['s1']!
    const s2 = reducer(s1, { type: 'CLOSE_TAB', tabId })
    expect(s2.tabsBySession['s1'].length).toBe(0)
    expect(s2.activeTabIdBySession['s1']).toBeNull()
  })

  it('CLOSE_TAB 关掉非最后一个后激活剩余的最后一个', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const firstId = s1.activeTabIdBySession['s1']!
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'b.ts', fileName: 'b.ts' })
    const s3 = reducer(s2, { type: 'CLOSE_TAB', tabId: s2.activeTabIdBySession['s1']! }) // close the active (2nd) tab
    expect(s3.activeTabIdBySession['s1']).toBe(firstId)
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

  it('SELECT_SESSION 后 activeTabId 切到目标会话的活跃 Tab (修复前的 bug)', () => {
    const state = initialState()
    // 在 s1 开两个 file tab，激活第二个
    const a = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const b = reducer(a, { type: 'OPEN_FILE_TAB', filePath: 'b.ts', fileName: 'b.ts' })
    const bTabId = b.activeTabIdBySession['s1']!  // s1 激活 b
    expect(bTabId).toBeDefined()
    // 切到 s2 再切回 s1，s1 的活跃 Tab 应仍是 b（隔离正确）
    const toS2 = reducer(b, { type: 'SELECT_SESSION', sessionId: 's2' })
    expect(toS2.activeTabIdBySession['s1']).toBe(bTabId) // s1 的值保留
    expect(toS2.activeTabIdBySession['s2']).toBeNull()   // s2 自己是 null
    const backToS1 = reducer(toS2, { type: 'SELECT_SESSION', sessionId: 's1' })
    expect(backToS1.activeSessionId).toBe('s1')
    expect(backToS1.activeTabIdBySession['s1']).toBe(bTabId) // 回到 s1 仍是 b
  })

  it('SET_THEME 更新主题', () => {
    const state = initialState()
    const next = reducer(state, { type: 'SET_THEME', theme: 'codex-cool' })
    expect(next.theme).toBe('codex-cool')
  })

  it('ADD_MESSAGE 把消息追加到指定会话', () => {
    const state = initialState() // s1 有 2 条消息
    const before = state.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!.messages.length
    const next = reducer(state, {
      type: 'ADD_MESSAGE',
      sessionId: 's1',
      message: { id: 'pick1', role: 'user', content: '[拾取的网页元素] ...' }
    })
    const after = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!.messages.length
    expect(after).toBe(before + 1)
  })

  it('ADD_MESSAGE 不影响其他会话的消息', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'ADD_MESSAGE',
      sessionId: 's1',
      message: { id: 'pick1', role: 'user', content: 'x' }
    })
    const s2msgs = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's2')!.messages.length
    expect(s2msgs).toBe(0) // s2 仍空
  })

  it('ADD_MESSAGE 对不存在的会话：现有会话消息数不变，不崩', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'ADD_MESSAGE',
      sessionId: 'nope',
      message: { id: 'x', role: 'user', content: 'x' }
    })
    // 逐会话比对消息数——不存在的 sessionId 不应改变任何真实会话
    state.projects.forEach(p => {
      p.sessions.forEach(s => {
        const after = next.projects.find(pp => pp.id === p.id)!.sessions.find(ss => ss.id === s.id)!.messages.length
        expect(after).toBe(s.messages.length)
      })
    })
  })

  it('reducer 保持不可变性 (返回新对象，不改原 state)', () => {
    const state = initialState()
    const next = reducer(state, { type: 'ADD_SESSION', projectId: 'p2' })
    expect(next).not.toBe(state)
    expect(next.projects).not.toBe(state.projects)
    // 原 state 的 p2 会话数应不变
    expect(state.projects.find(p => p.id === 'p2')!.sessions.length).toBe(1)
  })

  it('SET_DRAFT_ATTACHMENT / CLEAR_DRAFT_ATTACHMENT 管理草稿附件', () => {
    const state = initialState()
    const att = { source: 'https://x.com', tag: 'div', text: 'hi', selector: 'div', html: '<div/>' }
    const s1 = reducer(state, { type: 'SET_DRAFT_ATTACHMENT', attachment: att })
    expect(s1.draft.attachment).toEqual(att)
    expect(s1.draft.text).toBe('') // 文本不丢
    const s2 = reducer(s1, { type: 'SET_DRAFT_TEXT', text: '看看这个' })
    expect(s2.draft.text).toBe('看看这个')
    expect(s2.draft.attachment).toEqual(att) // 附件还在
    const s3 = reducer(s2, { type: 'CLEAR_DRAFT_ATTACHMENT' })
    expect(s3.draft.attachment).toBeUndefined()
    expect(s3.draft.text).toBe('看看这个') // 文本保留
  })

  it('SEND_MESSAGE 把文本+附件合成消息追加，发送后草稿清空', () => {
    const state = initialState() // 激活 s1
    const att = { source: 'https://x.com', tag: 'a', text: '链接', selector: 'a', html: '<a/>' }
    const s1 = reducer(state, { type: 'SET_DRAFT_TEXT', text: '分析下' })
    const s2 = reducer(s1, { type: 'SET_DRAFT_ATTACHMENT', attachment: att })
    const before = state.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!.messages.length
    const sent = reducer(s2, { type: 'SEND_MESSAGE' })
    const session = sent.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    expect(session.messages.length).toBe(before + 1)
    const last = session.messages[session.messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toBe('分析下')
    expect(last.attachment).toEqual(att)
    // 草稿清空
    expect(sent.draft.text).toBe('')
    expect(sent.draft.attachment).toBeUndefined()
  })

  it('SEND_MESSAGE 文本和附件都为空时不发送', () => {
    const state = initialState()
    const sent = reducer(state, { type: 'SEND_MESSAGE' })
    // 无变化（消息数不变、草稿不变）
    expect(sent).toEqual(state)
  })

  it('SEND_MESSAGE 只有附件无文本也能发送', () => {
    const state = initialState()
    const att = { source: 'u', tag: 'img', text: '', selector: 'img', html: '<img/>' }
    const s1 = reducer(state, { type: 'SET_DRAFT_ATTACHMENT', attachment: att })
    const sent = reducer(s1, { type: 'SEND_MESSAGE' })
    const session = sent.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    const last = session.messages[session.messages.length - 1]
    expect(last.attachment).toEqual(att)
    expect(last.content).toBe('')
  })

  it('SET_VIEW 切换顶层视图', () => {
    const state = initialState()
    expect(state.currentView).toBe('workspace')
    const next = reducer(state, { type: 'SET_VIEW', view: 'settings' })
    expect(next.currentView).toBe('settings')
  })

  it('SET_SETTINGS_SECTION 切换子页并同时进入设置视图', () => {
    const state = initialState()
    const next = reducer(state, { type: 'SET_SETTINGS_SECTION', section: 'skills' })
    expect(next.currentView).toBe('settings')
    expect(next.activeSettingsSection).toBe('skills')
  })

  it('STREAM_START 标记会话进入流式状态', () => {
    const state = initialState()
    const next = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    expect(next.streamingBySession['s1']).toEqual({ isStreaming: true, currentText: '' })
  })

  it('STREAM_DELTA 增量拼接文本', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const s2 = reducer(s1, { type: 'STREAM_DELTA', sessionId: 's1', delta: 'Hello' })
    const s3 = reducer(s2, { type: 'STREAM_DELTA', sessionId: 's1', delta: ', World' })
    expect(s3.streamingBySession['s1'].currentText).toBe('Hello, World')
    expect(s3.streamingBySession['s1'].isStreaming).toBe(true)
  })

  it('STREAM_END 把文本块合并为 assistant 消息并清理流式状态', () => {
    const state = initialState() // s1 有 2 条消息
    const before = state.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!.messages.length
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const s2 = reducer(s1, { type: 'STREAM_DELTA', sessionId: 's1', delta: '部分文本' })
    const next = reducer(s2, {
      type: 'STREAM_END',
      sessionId: 's1',
      content: [{ type: 'text', text: '最终回复' }, { type: 'tool_use', name: 'bash' }],
      costUSD: 0.01,
      durationMs: 1234,
    })
    const session = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    expect(session.messages.length).toBe(before + 1)
    const last = session.messages[session.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('最终回复') // 只保留 text 块
    // 流式状态清理
    expect(next.streamingBySession['s1']).toBeUndefined()
  })

  it('STREAM_ERROR 记录错误并结束流式', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const next = reducer(s1, { type: 'STREAM_ERROR', sessionId: 's1', error: 'boom' })
    expect(next.streamingBySession['s1']).toEqual({ isStreaming: false, currentText: '', error: 'boom' })
  })

  it('STREAM_ABORTED 清理流式状态', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const next = reducer(s1, { type: 'STREAM_ABORTED', sessionId: 's1' })
    expect(next.streamingBySession['s1']).toBeUndefined()
  })

  it('SET_SETTINGS 部分更新设置', () => {
    const state = initialState()
    const next = reducer(state, { type: 'SET_SETTINGS', settings: { apiKey: 'sk-xxx', cwd: '/tmp' } })
    expect(next.settings.apiKey).toBe('sk-xxx')
    expect(next.settings.cwd).toBe('/tmp')
    expect(next.settings.model).toBe('sonnet') // 未传字段保留
  })

  it('INIT_SESSIONS 用新 projects 列表替换', () => {
    const state = initialState()
    const newProjects = structuredClone(mockProjects).slice(0, 1)
    const next = reducer(state, { type: 'INIT_SESSIONS', projects: newProjects })
    expect(next.projects).toBe(newProjects)
  })
})
