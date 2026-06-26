import { describe, it, expect, beforeEach } from 'vitest'
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'
import type { AppState } from '../src/renderer/state/reducer'

function makeState(): AppState {
  return {
    projects: structuredClone(seedProjects),
    activeSessionId: 's1',
    tabsBySession: { s1: [], s2: [] },
    activeTabIdBySession: { s1: null, s2: null },
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
    dirtyTabIds: {}, lastFileOpenedSeq: 0, queueBySession: {}, tasksBySession: {}, backendTasksBySession: {}, panelFold: { root: false }, panelPosition: { x: 0, y: 0 }, subagentOutputBySession: {}, planBySession: {}, abortedBySession: {}, contextUsageBySession: {},
    editingMessageId: null, editingQueueId: null,
    updateStatus: { state: 'idle' },
    reviewByProject: {},
  }
}

describe('会话归档 reducer', () => {
  beforeEach(() => {
    setIdCounter(0)
  })

  it('ARCHIVE_SESSION 标记 archived + archivedAt', () => {
    const next = reducer(makeState(), { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    const sess = next.projects[0].sessions.find(s => s.id === 's1')!
    expect(sess.archived).toBe(true)
    expect(typeof sess.archivedAt).toBe('number')
  })

  it('ARCHIVE_SESSION 后激活会话切走', () => {
    const next = reducer(makeState(), { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    // s1 被归档，activeSessionId 应切到 s2（p1 内的另一个非归档会话）
    expect(next.activeSessionId).toBe('s2')
  })

  it('RESTORE_SESSION 清除 archived', () => {
    const archived = reducer(makeState(), { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    const restored = reducer(archived, { type: 'RESTORE_SESSION', sessionId: 's1' })
    const sess = restored.projects[0].sessions.find(s => s.id === 's1')!
    expect(sess.archived).toBeFalsy()
    expect(sess.archivedAt).toBeUndefined()
  })

  it('ARCHIVE_SESSION 当所有其他会话都已归档时，激活会话保持不变', () => {
    // s1 active, pre-archive all other sessions (s2..s8, s3)
    const s = makeState()
    const allOtherIds = ['s2', 's3', 's4', 's5', 's6', 's7', 's8']
    let st = s
    for (const sid of allOtherIds) {
      st = reducer(st, { type: 'ARCHIVE_SESSION', sessionId: sid })
    }
    // now archive s1 (active) — all others are archived, no non-archived survivor
    const next = reducer(st, { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    expect(next.activeSessionId).toBe('s1')
  })

  it('DELETE_SESSION 真删除（用于已归档会话）', () => {
    const archived = reducer(makeState(), { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    const deleted = reducer(archived, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's1' })
    expect(deleted.projects[0].sessions.find(s => s.id === 's1')).toBeUndefined()
  })
})
