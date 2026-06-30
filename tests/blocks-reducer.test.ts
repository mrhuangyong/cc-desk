import { describe, it, expect, beforeEach } from 'vitest'
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'
import type { AppState } from '../src/renderer/state/reducer'

function initialState(): AppState {
  return {
    projects: structuredClone(seedProjects),
    activeSessionId: 's1',
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

describe('streaming blocks reducer', () => {
  beforeEach(() => setIdCounter(100))

  it('STREAM_DELTA text 追加到末尾 text block', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '你好' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '世界' })
    const blocks = s.streamingBySession['s1'].blocks
    expect(blocks.length).toBe(1)
    expect(blocks[0]).toEqual({ type: 'text', text: '你好世界' })
  })

  it('STREAM_DELTA thinking 与 text 分属不同 block', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'A' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'thinking', delta: 'B' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'C' })
    const blocks = s.streamingBySession['s1'].blocks
    expect(blocks.map(b => b.type)).toEqual(['text', 'thinking', 'text'])
    expect((blocks[0] as any).text).toBe('A')
    expect((blocks[2] as any).text).toBe('C')
  })
})

describe('tool_use 生命周期', () => {
  beforeEach(() => setIdCounter(100))

  it('START 创建 running block；RESULT 回填 result 并置 completed', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, {
      type: 'STREAM_TOOL_USE_START', sessionId: 's1',
      block: { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.txt' }, status: 'running' },
    })
    let blocks = s.streamingBySession['s1'].blocks
    expect(blocks[0]).toMatchObject({ type: 'tool_use', id: 'tu1', status: 'running' })

    s = reducer(s, {
      type: 'STREAM_TOOL_RESULT', sessionId: 's1', toolUseId: 'tu1',
      result: { content: '文件内容', isError: false },
    })
    blocks = s.streamingBySession['s1'].blocks
    expect((blocks[0] as any).status).toBe('completed')
    expect((blocks[0] as any).result).toEqual({ content: '文件内容', isError: false })
  })

  it('RESULT isError=true 置 error', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, {
      type: 'STREAM_TOOL_USE_START', sessionId: 's1',
      block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {}, status: 'running' },
    })
    s = reducer(s, {
      type: 'STREAM_TOOL_RESULT', sessionId: 's1', toolUseId: 'tu1',
      result: { content: '命令失败', isError: true },
    })
    expect((s.streamingBySession['s1'].blocks[0] as any).status).toBe('error')
  })
})

describe('notice / error / end', () => {
  beforeEach(() => setIdCounter(100))

  it('STREAM_NOTICE 累积到 notices', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_NOTICE', sessionId: 's1', notice: { id: 'n1', kind: 'status', text: '运行中', level: 'info' } })
    expect(s.streamingBySession['s1'].notices.length).toBe(1)
  })

  it('STREAM_ERROR 只标记不结束流', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_ERROR', sessionId: 's1', error: 'boom' })
    expect(s.streamingBySession['s1'].error).toBe('boom')
    expect(s.streamingBySession['s1']).toBeDefined()
  })

  it('STREAM_END 固化成 assistant 消息（含 blocks/notices/cost）并清理 streaming', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '回复' })
    s = reducer(s, { type: 'STREAM_NOTICE', sessionId: 's1', notice: { id: 'n1', kind: 'status', text: 'ok', level: 'info' } })
    s = reducer(s, { type: 'STREAM_END', sessionId: 's1', costUSD: 0.01, durationMs: 500 })
    expect(s.streamingBySession['s1']).toBeUndefined()
    const sess = s.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!
    const last = sess.messages[sess.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toEqual([{ type: 'text', text: '回复' }])
    expect(last.notices?.length).toBe(1)
    expect(last.costUSD).toBe(0.01)
  })

  it('STREAM_ASSISTANT_BLOCKS 按 uuid 去重', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1', blocks: [{ type: 'text', text: 'A' }] })
    s = reducer(s, { type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1', blocks: [{ type: 'text', text: 'A2' }] })
    expect(s.streamingBySession['s1'].blocks.length).toBe(1)
  })

  it('流式 text + assistant 完整消息不重复（校正去重）', () => {
    // 回归：流式 text_delta 拼出文本后，assistant 完整消息到达时不能重复 push
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '你好' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '！' })
    // assistant 完整消息含同一段文本
    s = reducer(s, { type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1', blocks: [{ type: 'text', text: '你好！' }] })
    const blocks = s.streamingBySession['s1'].blocks
    const texts = blocks.filter(b => b.type === 'text')
    expect(texts.length).toBe(1)
    expect((texts[0] as any).text).toBe('你好！')
  })

  it('assistant 完整消息不降级已回填的 tool_use 状态', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, {
      type: 'STREAM_TOOL_USE_START', sessionId: 's1',
      block: { type: 'tool_use', id: 'tu1', name: 'Read', input: {}, status: 'running' },
    })
    s = reducer(s, {
      type: 'STREAM_TOOL_RESULT', sessionId: 's1', toolUseId: 'tu1',
      result: { content: '内容', isError: false },
    })
    // 此时 tu1 已 completed + result；assistant 校正到达时（input 权威）不应降级 status
    s = reducer(s, {
      type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1',
      blocks: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a' }, status: 'running' }],
    })
    const tu = s.streamingBySession['s1'].blocks.find(b => b.type === 'tool_use') as any
    expect(tu.status).toBe('completed')
    expect(tu.result).toEqual({ content: '内容', isError: false })
    expect(tu.input).toEqual({ file_path: 'a' })
  })
})

describe('STREAM_ASSISTANT_BLOCKS 空内容回归', () => {
  beforeEach(() => setIdCounter(100))

  it('空 assistant_blocks 不应清空已累积的流式文本', () => {
    // 回归：当本轮 assistant 内容全是被过滤的 tool_use（TodoWrite/AskUserQuestion 等），
    // 主进程发来 blocks: [] 的 assistant_blocks，不应清空主流已显示的文本。
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '我来帮你' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '处理' })
    // 空 blocks 到达（本轮内容全被过滤）
    s = reducer(s, { type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1', blocks: [] })
    const blocks = s.streamingBySession['s1'].blocks
    const texts = blocks.filter(b => b.type === 'text')
    expect(texts.length).toBe(1)
    expect((texts[0] as any).text).toBe('我来帮你处理')
  })
})

describe('ExitPlanMode 计划文档在授权后保留', () => {
  beforeEach(() => setIdCounter(100))

  // 真实场景：ExitPlanMode 的 tool_use 在 stream 阶段 input 为空壳，
  // assistant_blocks 阶段补全完整 input（含 plan + planFilePath）。
  // 用户授权后 SDK 回填的 tool_result 是 is_error 的占位（"Exit plan mode?"），
  // 不含 filePath。验证：input.plan / input.planFilePath 不被 error result 丢失。
  it('assistant_blocks 补全 input 后，error tool_result 不丢失 input.plan', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    // 1) stream 阶段：tool_use_start 时 input 为空壳
    s = reducer(s, {
      type: 'STREAM_TOOL_USE_START', sessionId: 's1',
      block: { type: 'tool_use', id: 'plan1', name: 'ExitPlanMode', input: {}, status: 'running' },
    })
    // 2) assistant_blocks：补全完整 input（含 plan 文本和 planFilePath）
    s = reducer(s, {
      type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1',
      blocks: [
        { type: 'tool_use', id: 'plan1', name: 'ExitPlanMode', input: { plan: '# 计划内容', planFilePath: '/path/to/plan.md' }, status: 'running' },
      ],
    })
    // 3) 用户授权后，SDK 回填 is_error 占位 tool_result（无 planFilePath）
    s = reducer(s, {
      type: 'STREAM_TOOL_RESULT', sessionId: 's1', toolUseId: 'plan1',
      result: { content: 'Exit plan mode?', isError: true },
    })
    const block = s.streamingBySession['s1'].blocks[0] as any
    expect(block.input.plan).toBe('# 计划内容')
    expect(block.input.planFilePath).toBe('/path/to/plan.md')
    // ExitPlanMode 的 is_error 占位 result 不应标记 error——那是 SDK 退出 plan 模式的正常机制
    expect(block.status).toBe('completed')
  })
})
