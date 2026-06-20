// 守护测试：ClaudeService.forwardEvent 必须拦截 TaskCreate / TaskUpdate tool_use，
// 发出 claude:task 事件让悬浮面板 TaskCard 显示 Claude 规划的任务列表。
//
// 根因：forwardEvent 的 stream_event(assistant tool_use) 分支只过滤了
// AskUserQuestion/ExitPlanMode/TodoWrite，把 TaskCreate/TaskUpdate 当普通工具卡片渲染，
// 从不发 claude:task 事件，导致前端 tasksBySession 永远空，悬浮面板 Task 卡片不显示。
//
// 真实 SDK 样本（~/.claude jsonl）：
//   TaskCreate input: { subject, description, activeForm }
//   TaskUpdate input: { taskId: "1", status: "in_progress|completed|failed" }
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// forwardEvent 是纯事件转发方法，无需真实 SDK / 配置文件。
// mock 掉 SDK 及所有读真实配置的依赖，避免 import ClaudeService 时触发 ~/.claude 读取
// （否则与依赖真实 HOME 的 claude-config.test.ts 并行时会互相污染环境）。
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => (async function* () {})(),
}))
vi.mock('../src/main/cc-desk-store', () => ({
  getModelProvidersConfig: () => ({ providers: [], models: [], modelRoleMap: {}, activeModelId: '' }),
  resolveActiveProviderModel: () => null,
  buildSdkEnv: () => ({}),
}))
vi.mock('../src/main/settings-store', () => ({ getSettings: () => ({}) }))
vi.mock('../src/main/projects-store', () => ({ getProjectsSnapshot: () => [] }))
vi.mock('../src/main/claude-config', () => ({
  getMcpServers: async () => [], getPlugins: async () => [], getSkills: async () => [],
  getCommands: async () => [], getHooks: async () => [], getModelConfig: async () => ({}),
  getGeneralConfig: async () => ({}),
}))

describe('ClaudeService.forwardEvent → TaskCreate/TaskUpdate 拦截', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  // 捕获 webContents.send 所有调用
  function mkWc() {
    const sent: { channel: string; data: any }[] = []
    const wc: any = { send: (channel: string, data: any) => { sent.push({ channel, data }) } }
    return { wc, sent }
  }

  it('TaskCreate: assistant tool_use 不立即发 started；tool_result 含 "Task #N" 后发 started(taskId=N)', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()

    // 1) assistant 阶段：TaskCreate tool_use，不应发 started（等 tool_result 拿真实 id）
    await (svc as any).forwardEvent({
      type: 'assistant', uuid: 'u1',
      message: { role: 'assistant', content: [
        { type: 'text', text: '我来创建任务列表' },
        { type: 'tool_use', id: 'call_tc1', name: 'TaskCreate',
          input: { subject: '探索项目上下文', description: '复盘现有机制确认改动点', activeForm: '探索项目上下文' } },
      ] },
    }, 's1', wc)

    expect(sent.filter(s => s.channel === 'claude:task' && s.data?.kind === 'started')).toHaveLength(0)

    // 2) user 阶段：tool_result 文本 "Task #1 created successfully: 探索项目上下文"
    await (svc as any).forwardEvent({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'call_tc1', content: 'Task #1 created successfully: 探索项目上下文', is_error: false },
      ] },
    }, 's1', wc)

    const started = sent.find(s => s.channel === 'claude:task' && s.data?.kind === 'started')
    expect(started).toBeTruthy()
    expect(started!.data.localSessionId).toBe('s1')
    expect(started!.data.taskId).toBe('1')   // 真实数字 id，TaskUpdate 会引用它
    expect(started!.data.description).toContain('探索项目上下文')
    expect(started!.data.taskType).toBe('task')
  })

  it('TaskCreate tool_result 解析失败时用 tool_use_id 兜底（仍显示任务）', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()

    await (svc as any).forwardEvent({
      type: 'assistant', uuid: 'u9',
      message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'call_tcX', name: 'TaskCreate', input: { subject: '兜底任务' } },
      ] },
    }, 's1', wc)
    // tool_result 文本不含 "Task #N"
    await (svc as any).forwardEvent({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'call_tcX', content: '未知格式结果', is_error: false },
      ] },
    }, 's1', wc)

    const started = sent.find(s => s.channel === 'claude:task' && s.data?.kind === 'started')
    expect(started).toBeTruthy()
    expect(started!.data.taskId).toBe('call_tcX')  // 兜底用 tool_use_id
  })

  it('assistant 消息含 TaskUpdate tool_use → 发 claude:task kind:updated 含 status', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()

    const assistantMsg = {
      type: 'assistant',
      uuid: 'u2',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_tu1',
            name: 'TaskUpdate',
            input: { taskId: '1', status: 'completed' },
          },
        ],
      },
    }

    await (svc as any).forwardEvent(assistantMsg, 's1', wc)

    const updated = sent.find(s => s.channel === 'claude:task' && s.data?.kind === 'updated')
    expect(updated).toBeTruthy()
    expect(updated!.data.taskId).toBe('1')
    expect(updated!.data.patch).toMatchObject({ status: 'completed' })
  })

  it('TaskUpdate 的 in_progress / failed 状态正确映射', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()

    // in_progress
    {
      const { wc, sent } = mkWc()
      await (svc as any).forwardEvent({
        type: 'assistant', uuid: 'u3',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'TaskUpdate', input: { taskId: '2', status: 'in_progress' } }] },
      }, 's1', wc)
      const ev = sent.find(s => s.channel === 'claude:task' && s.data?.kind === 'updated')
      expect(ev!.data.patch.status).toBe('running')
    }
    // failed
    {
      const { wc, sent } = mkWc()
      await (svc as any).forwardEvent({
        type: 'assistant', uuid: 'u4',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 't4', name: 'TaskUpdate', input: { taskId: '3', status: 'failed' } }] },
      }, 's1', wc)
      const ev = sent.find(s => s.channel === 'claude:task' && s.data?.kind === 'updated')
      expect(ev!.data.patch.status).toBe('failed')
    }
  })

  it('TaskCreate 推 tool_use_start 进对话流（用 MetaToolCard 渲染），仍触发 handleTaskPlanTool', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()

    // stream_event 分支：content_block_start 含 TaskCreate
    await (svc as any).forwardEvent({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'toolu_tc2', name: 'TaskCreate', input: { subject: 'X', description: 'Y', activeForm: 'X' } },
      },
    }, 's1', wc)

    // TaskCreate 现在保留进对话流（tool_use_start），让 MetaToolCard 渲染
    const toolStarts = sent.filter(s => s.channel === 'claude:blocks' && s.data?.op === 'tool_use_start')
    const tcToolStart = toolStarts.find(s => s.data?.block?.name === 'TaskCreate')
    expect(tcToolStart).toBeDefined()
    expect(tcToolStart?.data?.block?.input?.subject).toBe('X')
  })
})

describe('ClaudeService.forwardEvent → ExitPlanMode filePath 提取', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  function mkWc() {
    const sent: { channel: string; data: any }[] = []
    const wc: any = { send: (channel: string, data: any) => { sent.push({ channel, data }) } }
    return { wc, sent }
  }

  it('ExitPlanMode 的 tool_result 提取 filePath，附带在 claude:blocks op=tool_result 推送里', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()
    const planPath = '/Users/x/.claude/plans/test-plan.md'

    // 1) content_block_start 阶段记录 ExitPlanMode 的 tool_use_id
    await (svc as any).forwardEvent({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'plan-u1', name: 'ExitPlanMode', input: { plan: 'p' } } },
    }, 's1', wc)

    // 2) user 阶段：tool_result 带 structuredContent.filePath
    await (svc as any).forwardEvent({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'plan-u1', is_error: false,
          content: 'plan saved',
          structuredContent: { plan: 'p', filePath: planPath, isAgent: false } },
      ] },
    }, 's1', wc)

    // tool_result 推送应携带 planFilePath
    const tr = sent.find(s => s.channel === 'claude:blocks' && s.data?.op === 'tool_result' && s.data?.toolUseId === 'plan-u1')
    expect(tr).toBeDefined()
    expect(tr!.data.planFilePath).toBe(planPath)
  })

  it('非 ExitPlanMode 工具的 tool_result 不携带 planFilePath', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()

    await (svc as any).forwardEvent({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'bash-1', is_error: false, content: 'done' },
      ] },
    }, 's1', wc)

    const tr = sent.find(s => s.channel === 'claude:blocks' && s.data?.op === 'tool_result' && s.data?.toolUseId === 'bash-1')
    expect(tr).toBeDefined()
    expect(tr!.data.planFilePath).toBeUndefined()
  })
})

describe('ClaudeService.forwardEvent → TaskList 查询同步（非清空）', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.restoreAllMocks() })

  function mkWc() {
    const sent: { channel: string; data: any }[] = []
    const wc: any = { send: (channel: string, data: any) => { sent.push({ channel, data }) } }
    return { wc, sent }
  }

  it('TaskList 的 tool_result 解析 tasks 列表，发 todo_sync 同步给悬浮面板', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()

    // assistant 阶段：TaskList tool_use
    await (svc as any).forwardEvent({
      type: 'assistant', uuid: 'ul1',
      message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'call_tl1', name: 'TaskList', input: {} },
      ] },
    }, 's1', wc)

    // assistant 阶段不应发 todo_sync（旧 bug 会错误清空）
    expect(sent.filter(s => s.channel === 'claude:task' && s.data?.kind === 'todo_sync')).toHaveLength(0)

    // user 阶段：tool_result 返回 tasks 列表（structuredContent 形式）
    await (svc as any).forwardEvent({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'call_tl1', is_error: false,
          content: '查询到 2 个任务',
          structuredContent: { tasks: [
            { id: '1', subject: '任务A', status: 'completed' },
            { id: '2', subject: '任务B', status: 'in_progress' },
          ] } },
      ] },
    }, 's1', wc)

    const sync = sent.find(s => s.channel === 'claude:task' && s.data?.kind === 'todo_sync')
    expect(sync).toBeTruthy()
    expect(sync!.data.todos).toHaveLength(2)
    expect(sync!.data.todos[0]).toMatchObject({ content: '任务A', status: 'completed' })
    expect(sync!.data.todos[1]).toMatchObject({ content: '任务B', status: 'in_progress' })
  })

  it('TaskList tool_result 从 toolUseResult.tasks 提取（真实 SDK 主路径）', async () => {
    const { ClaudeService } = await import('../src/main/claude-service')
    const svc = new ClaudeService()
    const { wc, sent } = mkWc()

    await (svc as any).forwardEvent({
      type: 'assistant', uuid: 'ul2',
      message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'call_tl2', name: 'TaskList', input: {} },
      ] },
    }, 's1', wc)

    await (svc as any).forwardEvent({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'call_tl2', is_error: false,
          content: 'ok',
          toolUseResult: { tasks: [
            { id: '5', subject: '真实任务', status: 'pending' },
          ] } },
      ] },
    }, 's1', wc)

    const sync = sent.find(s => s.channel === 'claude:task' && s.data?.kind === 'todo_sync')
    expect(sync).toBeTruthy()
    expect(sync!.data.todos[0]).toMatchObject({ content: '真实任务', status: 'pending' })
  })
})
