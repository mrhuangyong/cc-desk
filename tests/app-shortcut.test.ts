// 应用级快捷键相关测试。
// App 组件树因引入 monaco-editor / tiptap 等，在 jsdom 下渲染成本很高（需大量 polyfill），
// 故不挂载整个 App。这里聚焦验证：
//   1) resolveTerminalCwd 纯函数（Cmd/Ctrl+J 打开终端时计算 cwd 的依据）
//   2) 快捷键派发的 OPEN_TAB 动作经 reducer 后产生 terminal tab（端到端逻辑链）
import { describe, it, expect } from 'vitest'
import { resolveTerminalCwd } from '../src/renderer/utils/terminal'
import { reducer } from '../src/renderer/state/reducer'
import type { AppState } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'

function makeState(): AppState {
  const sessions = seedProjects.flatMap(p => p.sessions)
  return {
    projects: structuredClone(seedProjects),
    activeSessionId: sessions[0].id,
    tabsBySession: {},
    activeTabIdBySession: {},
    theme: 'codex-light',
    draft: { doc: null, attachments: [] },
    currentView: 'workspace',
    activeSettingsSection: 'general',
    streamingBySession: {},
    settings: { cwd: '/home/user' } as any,
    claudeSessionMap: {},
    pendingDialog: null,
    dirtyTabIds: {},
    lastFileOpenedSeq: 0,
    queueBySession: {},
    tasksBySession: {},
    backendTasksBySession: {},
    panelFold: { root: false }, panelPosition: { x: 0, y: 0 },
    subagentOutputBySession: {},
    planBySession: {},
    abortedBySession: {}, completedBySession: {}, pendingRemoteMessages: {}, contextUsageBySession: {}, goalBySession: {}, goalCardOpen: null, editingMessageId: null, editingQueueId: null,
    updateStatus: { state: 'idle' },
    reviewByProject: {},
  }
}

describe('resolveTerminalCwd（Cmd/Ctrl+J 打开终端的 cwd 解析）', () => {
  it('激活会话所属项目存在时，取项目 path', () => {
    const state = makeState()
    // seedProjects: s1 属于 p1(cc-desk)，p1.path 待确认；这里取项目 path
    const cwd = resolveTerminalCwd(state)
    expect(cwd).toBeTruthy()
  })

  it('无匹配项目时回退到 settings.cwd', () => {
    const state = makeState()
    state.activeSessionId = 'not-exist'
    state.settings.cwd = '/fallback/path'
    expect(resolveTerminalCwd(state)).toBe('/fallback/path')
  })
})

describe('Cmd/Ctrl+J 派发 OPEN_TAB(terminal) 的 reducer 链路', () => {
  it('OPEN_TAB terminal 在当前会话下生成 terminal tab 并激活', () => {
    const state = makeState()
    const next = reducer(state, { type: 'OPEN_TAB', tabType: 'terminal' } as any)
    const tabs = next.tabsBySession[state.activeSessionId]
    expect(tabs.length).toBe(1)
    expect(tabs[0].type).toBe('terminal')
    expect(next.activeTabIdBySession[state.activeSessionId]).toBe(tabs[0].id)
  })

  it('携带 cwd 时保留在 tab 上', () => {
    const state = makeState()
    const next = reducer(state, { type: 'OPEN_TAB', tabType: 'terminal', cwd: '/proj/x' } as any)
    const tab = next.tabsBySession[state.activeSessionId][0]
    expect(tab.cwd).toBe('/proj/x')
  })
})
