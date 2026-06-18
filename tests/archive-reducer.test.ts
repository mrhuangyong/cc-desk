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
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, queueMode: 'queue',
      showThinking: false, showTodo: false, showBackendTask: true, autoArchive: true, archiveDays: '7', dataPath: '',
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
    claudeSessionMap: {},
    pendingDialog: null,
    dirtyTabIds: {}, lastFileOpenedSeq: 0, queueBySession: {}, tasksBySession: {}, backendTasksBySession: {}, panelFold: { root: false, taskCard: false, backendTaskCard: false },
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

  it('DELETE_SESSION 真删除（用于已归档会话）', () => {
    const archived = reducer(makeState(), { type: 'ARCHIVE_SESSION', sessionId: 's1' })
    const deleted = reducer(archived, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's1' })
    expect(deleted.projects[0].sessions.find(s => s.id === 's1')).toBeUndefined()
  })
})
