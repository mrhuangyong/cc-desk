import { describe, it, expect, beforeEach } from 'vitest'
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'
import type { AppState } from '../src/renderer/state/reducer'

// helper：构造初始 state，选中第一个项目的第一个会话
function initialState(): AppState {
  return {
    projects: structuredClone(seedProjects),
    activeSessionId: 's1',
    // 每个 session 的 Tab 组，key = sessionId
    tabsBySession: { s1: [] },
    activeTabIdBySession: { s1: null },
    theme: 'codex-light',
    draft: { doc: null, attachments: [] },
    currentView: 'workspace',
    activeSettingsSection: 'general',
    streamingBySession: {},
    settings: {
      apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', chatWidth: 'wide', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true,
      notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true,
      queueMode: 'queue',
      showThinking: false, showTodo: false, showBackendTask: true, rememberPanelPosition: true, autoArchive: true, archiveDays: '7',
      devTools: false,
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
    claudeSessionMap: {},
    pendingDialog: null,
    dirtyTabIds: {}, lastFileOpenedSeq: 0, queueBySession: {}, tasksBySession: {}, backendTasksBySession: {}, panelFold: { root: false }, panelPosition: { x: 0, y: 0 }, subagentOutputBySession: {}, planBySession: {}, abortedBySession: {}, contextUsageBySession: {}, goalBySession: {}, goalCardOpen: null,
    editingMessageId: null, editingQueueId: null,
    updateStatus: { state: 'idle' },
    reviewByProject: {},
  }
}

describe('reducer', () => {
  it('UPDATE_STATUS 更新全局更新状态', () => {
    const state = initialState()
    const next = reducer(state, { type: 'UPDATE_STATUS', status: { state: 'ready', version: '1.2.0' } })
    expect(next.updateStatus).toEqual({ state: 'ready', version: '1.2.0' })
  })

  it('REMOTE_USER_MESSAGE 把手机发的 user 文本加入指定会话（修复桌面看不到）', () => {
    const state = initialState()
    const next = reducer(state, { type: 'REMOTE_USER_MESSAGE', sessionId: 's1', text: '从手机发的问题' })
    const s1 = next.projects.flatMap(p => p.sessions).find(s => s.id === 's1')!
    const last = s1.messages[s1.messages.length - 1]
    expect(last.role).toBe('user')
    expect(JSON.stringify(last.content)).toContain('从手机发的问题')
  })

  it('REMOTE_USER_MESSAGE 目标会话不存在时不抛错（静默，等 HYDRATE）', () => {
    const state = initialState()
    expect(() => reducer(state, { type: 'REMOTE_USER_MESSAGE', sessionId: 'not-exist', text: 'x' })).not.toThrow()
  })

  it('REMOTE_USER_MESSAGE 末条已是相同 user 文本时去重（多源触发不重复）', () => {
    // 三个来源(remote 补丁 / claude:user-message SDK / 本地 SEND_MESSAGE)可能对同一条
    // 用户输入重复触发,按「末条相同文本 user」去重。
    const state = initialState()
    const after1 = reducer(state, { type: 'REMOTE_USER_MESSAGE', sessionId: 's1', text: '问题' })
    const s1After1 = after1.projects.flatMap(p => p.sessions).find(s => s.id === 's1')!
    const userCount1 = s1After1.messages.filter(m => m.role === 'user').length
    // 再来一次相同文本(模拟 SDK 回放)
    const after2 = reducer(after1, { type: 'REMOTE_USER_MESSAGE', sessionId: 's1', text: '问题' })
    const s1After2 = after2.projects.flatMap(p => p.sessions).find(s => s.id === 's1')!
    const userCount2 = s1After2.messages.filter(m => m.role === 'user').length
    expect(userCount2).toBe(userCount1) // 去重:user 数不增加
  })

  it('REMOTE_USER_MESSAGE 不同文本不去重（连续两条不同问题）', () => {
    const state = initialState()
    // s1 在 seedProjects 里已有 1 条 user(m1),用 s2(空会话)避免初始消息干扰
    const after1 = reducer(state, { type: 'REMOTE_USER_MESSAGE', sessionId: 's2', text: '问题A' })
    const after2 = reducer(after1, { type: 'REMOTE_USER_MESSAGE', sessionId: 's2', text: '问题B' })
    const s2 = after2.projects.flatMap(p => p.sessions).find(s => s.id === 's2')!
    expect(s2.messages.filter(m => m.role === 'user').length).toBe(2)
  })

  it('REMOTE_USER_MESSAGE 加的 user 消息，不应被随后不含该消息的 HYDRATE 覆盖丢失（竞态根因）', () => {
    // 复现：移动端发消息 → REMOTE_USER_MESSAGE 加入 user 文本 → 紧接着远程操作触发
    // workspace:changed → HYDRATE 用「尚未 save 该 user 消息的磁盘快照」整体替换 projects → user 消息丢失。
    // 期望：HYDRATE 应保留内存里比快照更新的 user 消息（按 sessionId 合并 messages，而非整体替换）。
    const state = initialState()
    // 1) 移动端发消息，user 文本进入 s1
    const afterRemote = reducer(state, { type: 'REMOTE_USER_MESSAGE', sessionId: 's1', text: '手机的问题' })
    const s1After = afterRemote.projects.flatMap(p => p.sessions).find(s => s.id === 's1')!
    expect(s1After.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('手机的问题'))).toBe(true)

    // 2) 磁盘快照（模拟 save 尚未落盘）：s1 还是旧 messages（无 user 文本）
    const staleSnapshot = {
      projects: structuredClone(seedProjects),
      activeSessionId: 's1',
      tabsBySession: { s1: [] },
      activeTabIdBySession: { s1: null },
      claudeSessionMap: {},
      lastSeq: 100,
    }
    const afterHydrate = reducer(afterRemote, { type: 'HYDRATE', snapshot: staleSnapshot as any })

    // 3) 期望：HYDRATE 后 user 消息仍在（不被旧快照覆盖）
    const s1Final = afterHydrate.projects.flatMap(p => p.sessions).find(s => s.id === 's1')!
    const stillThere = s1Final.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('手机的问题'))
    expect(stillThere).toBe(true)
  })

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

  it('OPEN_FILE_TAB 递增 lastFileOpenedSeq（新开与去重切换都计数）', () => {
    const state = initialState()
    expect(state.lastFileOpenedSeq).toBe(0)
    // 新开
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    expect(s1.lastFileOpenedSeq).toBe(1)
    // 同文件再次点击（去重切换）也要计数——用户点击意图即应展开右栏
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    expect(s2.lastFileOpenedSeq).toBe(2)
    expect(s2.tabsBySession['s1'].length).toBe(1) // 仍只有一个 tab
  })

  it('切换/关闭 Tab 不递增 lastFileOpenedSeq', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const openedAt = s1.lastFileOpenedSeq
    const tabId = s1.activeTabIdBySession['s1']!
    // 开第二个，切回第一个——SELECT_TAB 不递增
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'b.ts', fileName: 'b.ts' })
    const s3 = reducer(s2, { type: 'SELECT_TAB', tabId })
    expect(s3.lastFileOpenedSeq).toBe(s2.lastFileOpenedSeq) // SELECT_TAB 不动计数
    // CLOSE_TAB 不递增
    const s4 = reducer(s3, { type: 'CLOSE_TAB', tabId })
    expect(s4.lastFileOpenedSeq).toBe(s2.lastFileOpenedSeq)
    expect(openedAt).toBe(1)
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

  it('UPDATE_TAB_URL 持久保存浏览器当前网址，切换会话后仍保留', () => {
    const state = initialState()
    const opened = reducer(state, { type: 'OPEN_TAB', tabType: 'browser' })
    const tabId = opened.activeTabIdBySession['s1']!
    const navigated = reducer(opened, { type: 'UPDATE_TAB_URL', tabId, url: 'https://example.com/docs' })

    const toS2 = reducer(navigated, { type: 'SELECT_SESSION', sessionId: 's2' })
    const backToS1 = reducer(toS2, { type: 'SELECT_SESSION', sessionId: 's1' })

    expect(backToS1.tabsBySession['s1'].find(t => t.id === tabId)?.url).toBe('https://example.com/docs')
    expect(backToS1.tabsBySession['s1'].find(t => t.id === tabId)?.title).toBe('https://example.com/docs')
  })

  it('OPEN_TAB terminal 类型携带 cwd 写入 Tab', () => {
    const state = initialState()
    const next = reducer(state, { type: 'OPEN_TAB', tabType: 'terminal', cwd: '/proj' })
    const tab = next.tabsBySession['s1'][0]
    expect(tab.type).toBe('terminal')
    expect(tab.cwd).toBe('/proj')
  })

  it('OPEN_TAB 未传 cwd 时 Tab.cwd 为 undefined', () => {
    const state = initialState()
    const next = reducer(state, { type: 'OPEN_TAB', tabType: 'browser' })
    expect(next.tabsBySession['s1'][0].cwd).toBeUndefined()
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
      message: { id: 'pick1', role: 'user', content: [{ type: 'text', text: '[拾取的网页元素] ...' }] }
    })
    const after = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!.messages.length
    expect(after).toBe(before + 1)
  })

  it('ADD_MESSAGE 不影响其他会话的消息', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'ADD_MESSAGE',
      sessionId: 's1',
      message: { id: 'pick1', role: 'user', content: [{ type: 'text', text: 'x' }] }
    })
    const s2msgs = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's2')!.messages.length
    expect(s2msgs).toBe(0) // s2 仍空
  })

  it('ADD_MESSAGE 对不存在的会话：现有会话消息数不变，不崩', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'ADD_MESSAGE',
      sessionId: 'nope',
      message: { id: 'x', role: 'user', content: [{ type: 'text', text: 'x' }] }
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

  it('SET_DRAFT_DOC / ADD_DRAFT_ATTACHMENT / REMOVE_DRAFT_ATTACHMENT / CLEAR_DRAFT 管理草稿', () => {
    const state = initialState()
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    const s1 = reducer(state, { type: 'SET_DRAFT_DOC', doc })
    expect(s1.draft.doc).toEqual(doc)
    const att = { type: 'file' as const, name: 'a.ts', path: '/a.ts' }
    const s2 = reducer(s1, { type: 'ADD_DRAFT_ATTACHMENT', attachment: att })
    expect(s2.draft.attachments).toEqual([att])
    expect(s2.draft.doc).toEqual(doc) // doc 不丢
    const s3 = reducer(s2, { type: 'REMOVE_DRAFT_ATTACHMENT', index: 0 })
    expect(s3.draft.attachments).toEqual([])
    const s4 = reducer(s3, { type: 'CLEAR_DRAFT' })
    expect(s4.draft).toEqual({ doc: null, attachments: [] })
  })

  it('SEND_MESSAGE 用 serializeForPrompt 从 doc 序列化消息，发送后草稿清空', () => {
    const state = initialState() // 激活 s1
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: '分析下' }] }] }
    const att = { type: 'pickedElement' as const, el: { source: 'https://x.com', tag: 'a', text: '链接', selector: 'a', html: '<a/>' } }
    const s1 = reducer(state, { type: 'SET_DRAFT_DOC', doc })
    const s2 = reducer(s1, { type: 'ADD_DRAFT_ATTACHMENT', attachment: att })
    const before = state.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!.messages.length
    const sent = reducer(s2, { type: 'SEND_MESSAGE' })
    const session = sent.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    expect(session.messages.length).toBe(before + 1)
    const last = session.messages[session.messages.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toEqual([{ type: 'text', text: '分析下' }])
    expect(last.attachments).toEqual([att])
    // 草稿清空
    expect(sent.draft).toEqual({ doc: null, attachments: [] })
  })

  it('SEND_MESSAGE 文本和附件都为空时不发送', () => {
    const state = initialState()
    const sent = reducer(state, { type: 'SEND_MESSAGE' })
    // 无变化（消息数不变、草稿不变）
    expect(sent).toBe(state)
  })

  it('SEND_MESSAGE 只有附件无文本也能发送', () => {
    const state = initialState()
    const att = { type: 'file' as const, name: 'b.ts', path: '/b.ts' }
    const s1 = reducer(state, { type: 'ADD_DRAFT_ATTACHMENT', attachment: att })
    const sent = reducer(s1, { type: 'SEND_MESSAGE' })
    const session = sent.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    const last = session.messages[session.messages.length - 1]
    expect(last.attachments).toEqual([att])
    expect(last.content).toEqual([{ type: 'text', text: '' }])
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

  it('STREAM_START 初始化空 blocks/notices 并创建 draft message（实时持久化锚点）', () => {
    const state = initialState()
    const next = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const st = next.streamingBySession['s1']
    expect(st.blocks).toEqual([])
    expect(st.notices).toEqual([])
    expect(st.draftMessageId).toBeTruthy()
    // draft message 已插入 projects.messages
    const session = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    expect(session.messages.some(m => m.id === st.draftMessageId)).toBe(true)
  })

  it('STREAM_DELTA 增量拼接文本 (新 kind 签名)', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const s2 = reducer(s1, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'Hello' })
    const s3 = reducer(s2, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: ', World' })
    expect(s3.streamingBySession['s1'].blocks[0]).toEqual({ type: 'text', text: 'Hello, World' })
  })

  it('STREAM_END 时该 session 有未答 pendingDialog → 保留 streaming（授权等待期间防误清）', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const s2 = reducer(s1, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '部分输出' })
    // 弹出授权 dialog（带 sessionId）
    const s3 = reducer(s2, { type: 'SHOW_DIALOG', reqId: 'dlg1', sessionId: 's1', dialogKind: 'tool_use', payload: {} })
    // SDK 授权等待期间提前结束：STREAM_END 应保留 streaming，不清理
    const next = reducer(s3, { type: 'STREAM_END', sessionId: 's1', costUSD: 0.01, durationMs: 100 })
    expect(next.streamingBySession['s1']).toBeDefined()
    // 但消息已固化
    const session = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    expect(session.messages.length).toBeGreaterThan(0)
    // streaming blocks 被重置为空，等续跑追加
    expect(next.streamingBySession['s1'].blocks).toEqual([])
  })

  it('STREAM_END 时该 session 无 pendingDialog → 正常清理 streaming', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const next = reducer(s1, { type: 'STREAM_END', sessionId: 's1' })
    expect(next.streamingBySession['s1']).toBeUndefined()
  })

  it('STREAM_END finalize draft message（同一 id，不再新建）并清理 streaming', () => {
    const state = initialState() // s1 有 2 条消息
    const before = state.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!.messages.length
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const draftId = s1.streamingBySession['s1'].draftMessageId!
    const s2 = reducer(s1, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '最终回复' })
    const next = reducer(s2, {
      type: 'STREAM_END',
      sessionId: 's1',
      costUSD: 0.01,
      durationMs: 1234,
    })
    const session = next.projects.find(p => p.id === 'p1')!.sessions.find(s => s.id === 's1')!
    // STREAM_START 创建 draft(+1),END finalize 同一个(不再 +1)
    expect(session.messages.length).toBe(before + 1)
    const last = session.messages[session.messages.length - 1]
    expect(last.id).toBe(draftId) // 同一 id,未新建
    expect(last.role).toBe('assistant')
    expect(last.content).toEqual([{ type: 'text', text: '最终回复' }])
    expect(last.costUSD).toBe(0.01)
    expect(last.durationMs).toBe(1234)
    // 流式状态清理
    expect(next.streamingBySession['s1']).toBeUndefined()
  })

  it('STREAM_ERROR 标记 error 不结束流', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'STREAM_START', sessionId: 's1' })
    const next = reducer(s1, { type: 'STREAM_ERROR', sessionId: 's1', error: 'boom' })
    expect(next.streamingBySession['s1'].error).toBe('boom')
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
    expect(next.settings.model).toBe('model-sonnet') // 未传字段保留
  })

  it('INIT_SESSIONS 用新 projects 列表替换', () => {
    const state = initialState()
    const newProjects = structuredClone(seedProjects).slice(0, 1)
    const next = reducer(state, { type: 'INIT_SESSIONS', projects: newProjects })
    expect(next.projects).toBe(newProjects)
  })

  it('TAB_DIRTY 标记与清除 dirtyTabIds', () => {
    const state = initialState()
    const a = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const tabId = a.activeTabIdBySession['s1']!
    const dirty = reducer(a, { type: 'TAB_DIRTY', tabId, dirty: true })
    expect(dirty.dirtyTabIds[tabId]).toBe(true)
    const clean = reducer(dirty, { type: 'TAB_DIRTY', tabId, dirty: false })
    expect(clean.dirtyTabIds[tabId]).toBeFalsy()
  })

  it('CLOSE_TAB 清理对应 dirty 记录', () => {
    const state = initialState()
    const a = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const tabId = a.activeTabIdBySession['s1']!
    const dirty = reducer(a, { type: 'TAB_DIRTY', tabId, dirty: true })
    const closed = reducer(dirty, { type: 'CLOSE_TAB', tabId })
    expect(closed.dirtyTabIds[tabId]).toBeUndefined()
  })

  it('SET_CLAUDE_SESSION_ID 建立 local→claude sessionId 映射', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'SET_CLAUDE_SESSION_ID',
      localSessionId: 's1',
      claudeSessionId: 'abc-123',
    })
    expect(next.claudeSessionMap.s1).toBe('abc-123')
    // 不可变：原 state 未变
    expect(state.claudeSessionMap.s1).toBeUndefined()
  })

  it('KILL_RUNNING_TASKS 把 pending/running 的 TaskItem 置为 killed，终态任务不变', () => {
    const state: AppState = {
      ...initialState(),
      tasksBySession: {
        s1: [
          { id: 't1', description: 'a', taskType: 'task', status: 'pending' },
          { id: 't2', description: 'b', taskType: 'task', status: 'running' },
          { id: 't3', description: 'c', taskType: 'task', status: 'completed' },
          { id: 't4', description: 'd', taskType: 'task', status: 'failed' },
        ],
      },
    }
    const next = reducer(state, { type: 'KILL_RUNNING_TASKS', sessionId: 's1' })
    expect(next.tasksBySession.s1.map(t => t.status)).toEqual(['killed', 'killed', 'completed', 'failed'])
    // 不影响其它会话
    expect(next.tasksBySession.s2).toBeUndefined()
  })
})

describe('builtin-cmd reducer actions', () => {
  it('CLEAR_SESSION_MESSAGES 清空消息保留 session', () => {
    const s = initialState()
    const withMsg = reducer(s, { type: 'ADD_MESSAGE', sessionId: 's1', message: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } })
    const cleared = reducer(withMsg, { type: 'CLEAR_SESSION_MESSAGES', sessionId: 's1' })
    const sess = cleared.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!
    expect(sess.messages).toHaveLength(0)
    expect(sess.id).toBe('s1')
  })

  it('SET_SESSION_PERMISSION 写会话 permissionMode', () => {
    const s = initialState()
    const r = reducer(s, { type: 'SET_SESSION_PERMISSION', sessionId: 's1', permissionMode: '计划模式' })
    expect(r.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!.permissionMode).toBe('计划模式')
  })

  it('SET_SESSION_THINKING 写会话 thinking', () => {
    const s = initialState()
    const r = reducer(s, { type: 'SET_SESSION_THINKING', sessionId: 's1', thinking: 'high' })
    expect(r.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!.thinking).toBe('high')
  })

  it('ADD_SESSION_DIR 追加目录到 extraDirs', () => {
    const s = initialState()
    const r = reducer(s, { type: 'ADD_SESSION_DIR', sessionId: 's1', dir: '/tmp/x' })
    const r2 = reducer(r, { type: 'ADD_SESSION_DIR', sessionId: 's1', dir: '/tmp/y' })
    expect(r2.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!.extraDirs).toEqual(['/tmp/x', '/tmp/y'])
  })

  it('SHOW_COST text 非空时直接插入 notice（附着到最近助手消息）', () => {
    const s = initialState()
    const r = reducer(s, { type: 'SHOW_COST', sessionId: 's1', text: '总费用 $0.5' })
    const sess = r.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!
    const lastAssistant = [...sess.messages].reverse().find(m => m.role === 'assistant')!
    expect(lastAssistant.notices?.some(n => n.kind === 'status' && n.text.includes('0.5'))).toBe(true)
  })

  it('SHOW_COST text 空时聚合会话 costUSD', () => {
    const s = initialState()
    // 先塞一条带 costUSD 的助手消息（注意 costUSD 在 Message 上）
    const withMsg = reducer(s, {
      type: 'ADD_MESSAGE', sessionId: 's1',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], costUSD: 0.1234, turns: 5 },
    })
    const r = reducer(withMsg, { type: 'SHOW_COST', sessionId: 's1', text: '' })
    const sess = r.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!
    const lastAssistant = [...sess.messages].reverse().find(m => m.role === 'assistant')!
    expect(lastAssistant.notices?.some(n => n.kind === 'status' && n.text.includes('0.1234'))).toBe(true)
  })

  it('SHOW_COST 无费用数据时显示暂无统计', () => {
    const s = initialState()
    const r = reducer(s, { type: 'SHOW_COST', sessionId: 's1', text: '' })
    const sess = r.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!
    const lastAssistant = [...sess.messages].reverse().find(m => m.role === 'assistant')!
    expect(lastAssistant.notices?.some(n => n.text.includes('暂无费用统计'))).toBe(true)
  })

  it('COMPACT_DONE 用摘要替换历史保留最近 N 条，摘要 notice 附着到最近助手消息', () => {
    const s = initialState()
    let cur = s
    for (let i = 0; i < 10; i++) {
      cur = reducer(cur, { type: 'ADD_MESSAGE', sessionId: 's1', message: { id: `m${i}`, role: 'user', content: [{ type: 'text', text: `msg${i}` }] } })
    }
    // 加一条助手消息，COMPACT_DONE 的摘要 notice 应附着到它（/compact 摘要走 message notices 通道）
    cur = reducer(cur, { type: 'ADD_MESSAGE', sessionId: 's1', message: { id: 'ma', role: 'assistant', content: [{ type: 'text', text: '回复' }] } })
    const r = reducer(cur, { type: 'COMPACT_DONE', sessionId: 's1', summary: '已压缩', keepRecent: 6 })
    const sess = r.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!
    expect(sess.messages.length).toBeLessThanOrEqual(6)
    const lastAssistant = [...sess.messages].reverse().find(m => m.role === 'assistant')
    expect(lastAssistant?.notices?.some(n => n.kind === 'compact')).toBe(true)
  })
})

// HYDRATE：启动时从主进程注入持久化快照。单独 describe，因 setIdCounter 改模块级状态，
// 用例前后重置以隔离对其他测试的影响。
describe('reducer HYDRATE 持久化恢复', () => {
  beforeEach(() => {
    // HYDRATE 会改模块级 idCounter；每个用例开始时重置以隔离影响
    setIdCounter(0)
  })

  it('HYDRATE 注入 projects/activeSessionId/tabs/sessionMap，且保留 theme/draft/streaming', () => {
    const base = initialState()
    // 先制造一些临时态，验证 HYDRATE 不覆盖它们
    const withDoc = reducer(base, { type: 'SET_DRAFT_DOC', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '草稿保留?' }] }] } })
    const withStream = reducer(withDoc, { type: 'STREAM_START', sessionId: 's1' })

    const next = reducer(withStream, {
      type: 'HYDRATE',
      snapshot: {
        projects: structuredClone(seedProjects),
        activeSessionId: 's3',
        tabsBySession: { s3: [{ id: 't1', type: 'file', title: 'a.ts', filePath: 'a.ts' }] },
        activeTabIdBySession: { s3: 't1' },
        claudeSessionMap: { s3: 'claude-xyz' },
        lastSeq: 10,
      },
    })
    expect(next.activeSessionId).toBe('s3')
    expect(next.tabsBySession['s3'].length).toBe(1)
    expect(next.activeTabIdBySession['s3']).toBe('t1')
    expect(next.claudeSessionMap.s3).toBe('claude-xyz')
    // 临时态保留
    expect(next.draft.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '草稿保留?' }] }] })
    expect(next.streamingBySession['s1']).toBeDefined()
    // settings/theme 保留
    expect(next.theme).toBe('codex-light')
  })

  it('HYDRATE 重置 idCounter，后续新增 ID 不与已恢复数据冲突', () => {
    const state = initialState()
    const hydrated = reducer(state, {
      type: 'HYDRATE',
      snapshot: {
        projects: structuredClone(seedProjects), // 含 p1/p2（序号最大 2）
        activeSessionId: 's1',
        tabsBySession: {},
        activeTabIdBySession: {},
        claudeSessionMap: {},
        lastSeq: 5,
      },
    })
    // lastSeq=5 后，ADD_PROJECT 应生成 p6（而非 p1）
    const next = reducer(hydrated, { type: 'ADD_PROJECT', name: '新项目', path: '/new' })
    const added = next.projects.find(p => p.path === '/new')!
    expect(added).toBeDefined()
    expect(added.id).toBe('p6')
    expect(next.projects.filter(p => p.id === 'p1').length).toBe(1) // 原 p1 仍在，无重复
  })

  it('HYDRATE 的 activeSessionId 指向已删 session 时回退到首个存活会话', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'HYDRATE',
      snapshot: {
        projects: structuredClone(seedProjects), // 首个会话 s1
        activeSessionId: 'gone', // 不存在
        tabsBySession: {},
        activeTabIdBySession: {},
        claudeSessionMap: {},
        lastSeq: 0,
      },
    })
    expect(next.activeSessionId).toBe('s1')
  })

  it('HYDRATE 清理指向已不存在 session 的孤儿 tab 条目', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'HYDRATE',
      snapshot: {
        projects: structuredClone(seedProjects), // 含 s1/s2/s3
        activeSessionId: 's1',
        // 含一个孤儿 key（ghost 不在任何 project 中）
        tabsBySession: { s1: [], ghost: [{ id: 't1', type: 'file', title: 'x' }] },
        activeTabIdBySession: { s1: null, ghost: 't1' },
        claudeSessionMap: {},
        lastSeq: 0,
      },
    })
    expect(Object.keys(next.tabsBySession)).toEqual(['s1'])
    expect(Object.keys(next.activeTabIdBySession)).toEqual(['s1'])
  })
})

// 归档/删除全局最后一个存活会话、启动无会话时，应补建一个空会话进入「新会话」状态，
// 而非残留已归档会话旧内容或显示「无选中会话」空占位。
describe('reducer 无存活会话时补建新会话', () => {
  // 全局只剩一个存活会话的场景
  function singleAliveState(): AppState {
    return {
      ...initialState(),
      projects: [{
        id: 'p1', name: 'p', path: '/p',
        sessions: [
          { id: 'only', title: '唯一的会话', messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'hi' }] }], updatedAt: 1000 },
        ],
      }],
      activeSessionId: 'only',
      tabsBySession: { only: [] },
      activeTabIdBySession: { only: null },
    }
  }

  it('ARCHIVE_SESSION 归档全局最后一个会话后，补建空会话并设为 active', () => {
    const state = singleAliveState()
    const next = reducer(state, { type: 'ARCHIVE_SESSION', sessionId: 'only' })
    // 新 active 不是被归档的 only，且指向一个真实存在的空会话
    expect(next.activeSessionId).not.toBe('only')
    const activeSession = next.projects.flatMap(p => p.sessions).find(s => s.id === next.activeSessionId)!
    expect(activeSession).toBeDefined()
    expect(activeSession.archived).toBeFalsy()
    expect(activeSession.messages.length).toBe(0)
    // 新会话补在原 project 下
    expect(next.projects[0].sessions.some(s => s.id === next.activeSessionId)).toBe(true)
    // 新会话有对应 tab 分片
    expect(next.tabsBySession[next.activeSessionId]).toEqual([])
  })

  it('ARCHIVE_SESSION 归档非最后一个会话时，active 切到存活会话（不补建）', () => {
    const state = initialState() // p1 有 s1..s8，p2 有 s3
    const next = reducer(state, { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    // 切到另一个存活会话，不新建
    expect(next.activeSessionId).not.toBe('s1')
    // 总会话数不变（归档不删数据，也未补建新会话）
    const totalCountBefore = state.projects.flatMap(p => p.sessions).length
    const totalCountAfter = next.projects.flatMap(p => p.sessions).length
    expect(totalCountAfter).toBe(totalCountBefore)
    // s1 被标记归档
    const s1 = next.projects.flatMap(p => p.sessions).find(s => s.id === 's1')!
    expect(s1.archived).toBe(true)
  })

  it('DELETE_SESSION 删除全局最后一个会话后，补建空会话并设为 active', () => {
    const state = singleAliveState()
    const next = reducer(state, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 'only' })
    expect(next.activeSessionId).not.toBe('only')
    const activeSession = next.projects.flatMap(p => p.sessions).find(s => s.id === next.activeSessionId)!
    expect(activeSession).toBeDefined()
    expect(activeSession.messages.length).toBe(0)
    expect(next.projects[0].sessions.some(s => s.id === next.activeSessionId)).toBe(true)
  })

  it('HYDRATE 快照无存活会话时，补建空会话并设为 active（非空字符串）', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'HYDRATE',
      snapshot: {
        projects: [{ id: 'p1', name: 'p', path: '/p', sessions: [] }],
        activeSessionId: '',
        tabsBySession: {},
        activeTabIdBySession: {},
        claudeSessionMap: {},
        lastSeq: 0,
      },
    })
    expect(next.activeSessionId).not.toBe('')
    const activeSession = next.projects.flatMap(p => p.sessions).find(s => s.id === next.activeSessionId)!
    expect(activeSession).toBeDefined()
    expect(activeSession.messages.length).toBe(0)
  })

  it('HYDRATE 快照会话全部已归档时，补建空会话（active 不落在归档会话上）', () => {
    const state = initialState()
    const next = reducer(state, {
      type: 'HYDRATE',
      snapshot: {
        projects: [{
          id: 'p1', name: 'p', path: '/p',
          sessions: [{ id: 'arch', title: '已归档', archived: true, messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'x' }] }], updatedAt: 1000 }],
        }],
        activeSessionId: 'arch', // 指向已归档会话
        tabsBySession: {},
        activeTabIdBySession: {},
        claudeSessionMap: {},
        lastSeq: 0,
      },
    })
    // active 不能落在归档会话上
    expect(next.activeSessionId).not.toBe('arch')
    const activeSession = next.projects.flatMap(p => p.sessions).find(s => s.id === next.activeSessionId)!
    expect(activeSession.archived).toBeFalsy()
    expect(activeSession.messages.length).toBe(0)
  })
})

// 自动归档：验证 ARCHIVE_STALE 清理陈旧空会话，保留有消息/当前激活的
describe('reducer ARCHIVE_STALE 自动归档', () => {
  it('删除陈旧空会话，保留有消息和当前激活的', () => {
    const base: AppState = {
      ...initialState(),
      projects: [{
        id: 'p1', name: 'p', path: '/p',
        sessions: [
          { id: 'old-empty', title: '旧空会话', messages: [], updatedAt: 1000 },           // 古早空 → 归档
          { id: 'old-msg', title: '旧有消息', messages: [{ id: 'm', role: 'user', content: [{ type: 'text', text: 'hi' }] }], updatedAt: 1000 }, // 有消息 → 保留
          { id: 'new-empty', title: '新空会话', messages: [], updatedAt: Date.now() },       // 新空 → 保留
        ],
      }],
      activeSessionId: 'new-empty',
    }
    const now = Date.now()
    const next = reducer(base, { type: 'ARCHIVE_STALE', beforeTs: now - 7 * 86400000 })
    const ids = next.projects[0].sessions.map(s => s.id)
    expect(ids).toContain('old-msg')
    expect(ids).toContain('new-empty')
    expect(ids).not.toContain('old-empty')
  })

  it('EDIT_RESEND 截断指定消息及后续消息并替换文本', () => {
    const state = initialState()
    // s1 的 messages 从 fixtures 来，取第一条用户消息 id
    const firstMsg = state.projects[0].sessions[0].messages[0]
    const before = state.projects[0].sessions[0].messages.length
    const next = reducer(state, {
      type: 'EDIT_RESEND',
      sessionId: 's1',
      messageId: firstMsg.id,
      newPrompt: '编辑后的文本',
    })
    const msgs = next.projects[0].sessions[0].messages
    expect(msgs.length).toBeLessThanOrEqual(before)
    expect(msgs[msgs.length - 1].content[0]).toMatchObject({ type: 'text', text: '编辑后的文本' })
    expect(next.editingMessageId).toBeNull()
  })

  it('UPDATE_QUEUED_MESSAGE 更新排队消息文本', () => {
    const state = initialState()
    const enq = reducer(state, { type: 'ENQUEUE_MESSAGE', sessionId: 's1', prompt: '原始', attachments: [] })
    const qid = enq.queueBySession['s1'][0].id
    const next = reducer(enq, { type: 'UPDATE_QUEUED_MESSAGE', sessionId: 's1', queueId: qid, prompt: '修改后' })
    expect(next.queueBySession['s1'][0].prompt).toBe('修改后')
  })

  it('SET_EDITING_MESSAGE 设置编辑态', () => {
    const state = initialState()
    const next = reducer(state, { type: 'SET_EDITING_MESSAGE', messageId: 'm1' })
    expect(next.editingMessageId).toBe('m1')
  })
})

describe('reviewByProject 分片', () => {
  it('initialState 含 reviewByProject: {}', () => {
    const s = initialState()
    expect(s.reviewByProject).toEqual({})
  })

  it('REVIEW_SET_STATUS upsert 指定项目', () => {
    const s0 = initialState()
    const status = [{ path: 'a.ts', indexStatus: 'modified' as const, workdirStatus: null }]
    const s1 = reducer(s0, { type: 'REVIEW_SET_STATUS', projectId: 'p1', status })
    expect(s1.reviewByProject.p1.status).toEqual(status)
  })

  it('REVIEW_SET_DIFF 设置指定文件 diff 缓存', () => {
    const s0 = reducer(initialState(), { type: 'REVIEW_SET_STATUS', projectId: 'p1', status: [] })
    const s1 = reducer(s0, { type: 'REVIEW_SET_DIFF', projectId: 'p1', path: 'a.ts', diff: '@@ -1 +1 @@' })
    expect(s1.reviewByProject.p1.diffCache['a.ts']).toBe('@@ -1 +1 @@')
  })

  it('不同 projectId 互不干扰', () => {
    let s = reducer(initialState(), { type: 'REVIEW_SET_STATUS', projectId: 'p1', status: [] })
    s = reducer(s, { type: 'REVIEW_SET_COMMIT_MESSAGE', projectId: 'p2', message: 'hi' })
    expect(s.reviewByProject.p1.commitMessage).toBe('')
    expect(s.reviewByProject.p2.commitMessage).toBe('hi')
  })

  it('REVIEW_CLEAR 清空指定项目', () => {
    let s = reducer(initialState(), { type: 'REVIEW_SET_STATUS', projectId: 'p1', status: [{ path: 'x', indexStatus: null, workdirStatus: 'modified' }] })
    s = reducer(s, { type: 'REVIEW_CLEAR', projectId: 'p1' })
    expect(s.reviewByProject.p1).toBeUndefined()
  })

  it('CLEAR_FINISHED_TASKS 清除已结束任务，保留 running/pending', () => {
    let s = initialState()
    const mk = (id: string, status: any) => ({ id, status, description: id, taskType: 'todo' as const })
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: mk('t1', 'completed') })
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: mk('t2', 'running') })
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: mk('t3', 'failed') })
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: mk('t4', 'pending') })
    s = reducer(s, { type: 'UPSERT_TASK', sessionId: 's1', task: mk('t5', 'killed') })
    const next = reducer(s, { type: 'CLEAR_FINISHED_TASKS', sessionId: 's1' })
    const ids = next.tasksBySession.s1.map(t => t.id)
    // 保留 running/pending，清除 completed/failed/killed
    expect(ids).toEqual(['t2', 't4'])
  })
})
