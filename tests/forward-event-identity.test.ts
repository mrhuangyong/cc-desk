// 行为测试：验证 ClaudeService.forwardEvent 能否正确「识别」四类能力事件——
// Task（普通子任务）/ BackendTask（local_workflow）/ Plan（ExitPlanMode）/ AskUserQuestion。
//
// 背景：Claude Agent SDK 的 task_started/updated/notification 的顶层 type 都是 'system'，
// 靠 subtype 区分。本测试用真实 SDK 消息结构喂给 forwardEvent，断言其发出正确的 IPC 事件。
// 它同时是 task_* 识别缺陷的证据（修复前红、修复后绿）。
import { describe, it, expect } from 'vitest'
import { ClaudeService } from '../src/main/claude-service'
import { BackendTaskRegistry } from '../src/main/backend-task-registry'

// 捕获 webContents.send 调用的最小 mock
function mockWebContents() {
  const calls: Array<{ channel: string; data: any }> = []
  const wc: any = {
    send: (channel: string, ...args: any[]) => {
      // claude-service 约定：send(channel, data) 单 payload
      calls.push({ channel, data: args[0] })
    },
  }
  return { wc, calls }
}

// 访问 private forwardEvent
function fwd(svc: ClaudeService, msg: any, wc: any, lsid = 'sess1') {
  ;(svc as any).forwardEvent(msg, lsid, wc)
}

describe('forwardEvent 能力识别', () => {
  // ===== Task / BackendTask：task_* 事件 =====

  it('system.subtype=task_started (local_workflow) → claude:backend-task create', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-bg1', task_type: 'local_workflow',
      description: '跑 sleep 30', uuid: 'u1', session_id: 's1',
    }, wc)

    const created = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'create')
    expect(created.length).toBe(1)
    expect(created[0].data.task.id).toBe('t-bg1')
    expect(created[0].data.task.taskType).toBe('local_workflow')
  })

  it('system.subtype=task_started (subagent, task_type=agent) → claude:backend-task create', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-task1', task_type: 'agent', subagent_type: 'general-purpose',
      description: '搜索代码', uuid: 'u2', session_id: 's1',
    }, wc)

    const created = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'create')
    expect(created.length).toBe(1)
    expect(created[0].data.task.kind).toBe('subagent')
  })

  it('system.subtype=task_notification (已注册 subagent) → claude:backend-task update', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    // 先 started 注册 subagent
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-task2', task_type: 'subagent', subagent_type: 'general-purpose',
      description: 'x', uuid: 'u3', session_id: 's1',
    }, wc)
    calls.length = 0
    // 再 notification
    fwd(svc, {
      type: 'system', subtype: 'task_notification',
      task_id: 't-task2', status: 'completed', uuid: 'u4', session_id: 's1',
    }, wc)

    const updated = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'update')
    expect(updated.length).toBe(1)
    expect(updated[0].data.task.status).toBe('completed')
  })

  it('system.subtype=task_updated (local_workflow 已注册) → claude:backend-task update', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-bg2', task_type: 'local_workflow', description: 'y', uuid: 'u5', session_id: 's1',
    }, wc)
    calls.length = 0
    fwd(svc, {
      type: 'system', subtype: 'task_updated',
      task_id: 't-bg2', patch: { status: 'completed' }, uuid: 'u6', session_id: 's1',
    }, wc)

    const updated = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'update')
    expect(updated.length).toBe(1)
    expect(updated[0].data.task.status).toBe('completed')
  })

  // ===== Plan：ExitPlanMode =====

  it('assistant 含 ExitPlanMode tool_use → forwardEvent 不阻塞、不发 dialog-request（阻塞已移至 canUseTool）', async () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    // 新架构：ExitPlanMode 的用户交互由 PreToolUse hook→canUseTool 硬阻塞处理，
    // forwardEvent 不再本地拦截——调用立即返回（不阻塞），不发 dialog-request。
    const fwdPromise = (svc as any).forwardEvent({
      type: 'assistant',
      uuid: 'u7', session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '我先分析一下' },
          { type: 'tool_use', id: 'plan-use-1', name: 'ExitPlanMode', input: { plan: '# 重构方案\n\n1. 拆分模块' } },
        ],
      },
    }, 'sess1', wc)
    await fwdPromise
    await new Promise(r => setTimeout(r, 0))

    // forwardEvent 不应发 dialog-request（阻塞在 canUseTool）
    const dialogs = calls.filter(c => c.channel === 'claude:dialog-request')
    expect(dialogs.length).toBe(0)
  })

  it('ExitPlanMode 保留进 assistant_blocks（用 MetaToolCard 渲染，提供持久入口）', async () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    // ExitPlanMode 既阻塞（handleExitPlanMode 弹 dialog），又保留进对话流，
    // 让 plan 内容可经 MetaToolCard 长期回看（解决 plan 批准后入口丢失）。
    const fwdPromise = (svc as any).forwardEvent({
      type: 'assistant',
      uuid: 'u8', session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'plan-use-2', name: 'ExitPlanMode', input: { plan: 'p' } },
        ],
      },
    }, 'sess1', wc)
    await new Promise(r => setTimeout(r, 0))

    const blocks = calls.filter(c => c.channel === 'claude:blocks' && c.data?.op === 'assistant_blocks')
    expect(blocks.length).toBe(1)
    // ExitPlanMode 现在保留在 assistant_blocks（渲染端用 MetaToolCard 呈现）
    const toolUses = blocks[0].data.blocks.filter((b: any) => b.type === 'tool_use')
    const planUse = toolUses.find((b: any) => b.name === 'ExitPlanMode')
    expect(planUse).toBeDefined()
    expect(planUse?.input?.plan).toBe('p')

    // 清理：取消 dialog 避免 unhandled rejection
    const dialogs = calls.filter(c => c.channel === 'claude:dialog-request')
    if (dialogs.length > 0) svc.resolveDialog(dialogs[0].data.reqId, { behavior: 'cancelled' })
    await new Promise(r => setTimeout(r, 0))
  })

  // ===== AskUserQuestion（阻塞式交互已移至 canUseTool） =====

  it('assistant 含 AskUserQuestion tool_use → forwardEvent 不发 dialog-request（阻塞在 canUseTool）', async () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    // 新架构：AskUserQuestion 由 PreToolUse hook→canUseTool 硬阻塞，
    // forwardEvent 不本地拦截、不发 dialog-request。
    fwd(svc, {
      type: 'assistant',
      uuid: 'u9', session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'ask-1', name: 'AskUserQuestion', input: { questions: [{ question: '选哪个?', header: 'h', options: [{ label: 'A' }, { label: 'B' }] }] } },
        ],
      },
    }, wc)
    await new Promise(r => setTimeout(r, 0))

    const dialogs = calls.filter(c => c.channel === 'claude:dialog-request')
    expect(dialogs.length).toBe(0)
  })

  it('forwardEvent 不再因 AskUserQuestion 阻塞（立即返回，阻塞职责在 canUseTool）', async () => {
    const svc = new ClaudeService()
    const { wc } = mockWebContents()
    // forwardEvent 不再 await 用户作答——调用应立即 resolve
    const fwdPromise = (svc as any).forwardEvent({
      type: 'assistant',
      uuid: 'u-block', session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'ask-block', name: 'AskUserQuestion', input: { questions: [{ question: 'q?', header: 'h', options: [{ label: 'A' }] }] } },
        ],
      },
    }, 'sess1', wc)
    let resolved = false
    fwdPromise.then(() => { resolved = true })
    await new Promise(r => setTimeout(r, 10))
    // 新架构：forwardEvent 不阻塞，立即 resolve
    expect(resolved).toBe(true)
  })
})

  it('system.subtype=task_started (subagent) → claude:backend-task create, kind=subagent', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-sub1', task_type: 'subagent', subagent_type: 'general-purpose',
      description: '审查代码', uuid: 'u10', session_id: 's1',
    }, wc)

    const created = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'create')
    expect(created.length).toBe(1)
    expect(created[0].data.task.kind).toBe('subagent')
    expect(created[0].data.task.subagentType).toBe('general-purpose')
  })

  it('system.subtype=task_progress (已注册 subagent) → claude:backend-task update 含进度', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    // 先 started 注册 subagent
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-prog', task_type: 'subagent', subagent_type: 'general-purpose',
      description: '审查', uuid: 'u20', session_id: 's1',
    }, wc)
    calls.length = 0
    // progress
    fwd(svc, {
      type: 'system', subtype: 'task_progress',
      task_id: 't-prog', description: '分析中', summary: '已读 3 文件',
      last_tool_name: 'Read',
      usage: { total_tokens: 1234, tool_uses: 3, duration_ms: 5000 },
      uuid: 'u21', session_id: 's1',
    }, wc)

    const updated = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'update')
    expect(updated.length).toBe(1)
    expect(updated[0].data.task.progressSummary).toBe('已读 3 文件')
    expect(updated[0].data.task.lastToolName).toBe('Read')
    expect(updated[0].data.task.tokenCount).toBe(1234)
  })

// ===== 同步 Task subagent:主流 Task tool_use 触发登记(不发 task_started) =====

it('assistant 含 Task tool_use → claude:backend-task create (同步 subagent 登记)', () => {
  const svc = new ClaudeService()
  svc.setRegistry(new BackendTaskRegistry())
  const { wc, calls } = mockWebContents()
  fwd(svc, {
    type: 'assistant',
    uuid: 'u-sync1', session_id: 's1',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: '我派个子代理去查' },
        { type: 'tool_use', id: 'toolu_sync1', name: 'Task', input: { description: '查找用法', prompt: '请在 src 下搜索 foo 的所有用法', subagent_type: 'general-purpose' } },
      ],
    },
  }, wc)

  const created = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'create')
  expect(created.length).toBe(1)
  expect(created[0].data.task.kind).toBe('subagent')
  expect(created[0].data.task.id).toBe('toolu_sync1')
  expect(created[0].data.task.toolUseId).toBe('toolu_sync1')
  expect(created[0].data.task.prompt).toContain('搜索 foo')
  expect(created[0].data.task.status).toBe('running')
})

it('user tool_result (Task 同步 subagent) → claude:backend-task update completed', () => {
  const svc = new ClaudeService()
  svc.setRegistry(new BackendTaskRegistry())
  const { wc, calls } = mockWebContents()
  // 先登记
  fwd(svc, {
    type: 'assistant',
    uuid: 'u-sync2', session_id: 's1',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_sync2', name: 'Task', input: { description: '查', prompt: '查 bar' } },
    ] },
  }, wc)
  calls.length = 0
  // tool_result 到达 → 收尾
  fwd(svc, {
    type: 'user',
    uuid: 'u-sync3', session_id: 's1',
    message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_sync2', content: '找到 5 处', is_error: false },
    ] },
  }, wc)

  const updated = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'update')
  expect(updated.length).toBe(1)
  expect(updated[0].data.task.id).toBe('toolu_sync2')
  expect(updated[0].data.task.status).toBe('completed')
})

it('user tool_result (Task 同步 subagent 出错) → status failed', () => {
  const svc = new ClaudeService()
  svc.setRegistry(new BackendTaskRegistry())
  const { wc, calls } = mockWebContents()
  fwd(svc, {
    type: 'assistant',
    uuid: 'u-sync4', session_id: 's1',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_sync3', name: 'Task', input: { description: '查', prompt: '查 baz' } },
    ] },
  }, wc)
  calls.length = 0
  fwd(svc, {
    type: 'user',
    uuid: 'u-sync5', session_id: 's1',
    message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_sync3', content: '超时', is_error: true },
    ] },
  }, wc)

  const updated = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'update')
  expect(updated.length).toBe(1)
  expect(updated[0].data.task.status).toBe('failed')
})

it('重复 Task tool_use(同 id) → registry 幂等,不重复 create', () => {
  const svc = new ClaudeService()
  svc.setRegistry(new BackendTaskRegistry())
  const { wc, calls } = mockWebContents()
  fwd(svc, {
    type: 'assistant',
    uuid: 'u-a', session_id: 's1',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_d1', name: 'Task', input: { description: 'd', prompt: 'p' } },
    ] },
  }, wc)
  // 同 id 再来(模拟 content_block_start + assistant 两次登记)
  fwd(svc, {
    type: 'assistant',
    uuid: 'u-b', session_id: 's1',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_d1', name: 'Task', input: { description: 'd', prompt: 'p' } },
    ] },
  }, wc)

  const created = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'create' && c.data.task.id === 'toolu_d1')
  // registry 去重:第二次返回已有记录,但仍会 send create op(幂等 upsert,渲染端覆盖同 id)
  expect(created.length).toBe(2)
  // 渲染端 upsertBySession 按 id 覆盖,最终只有一条
})

describe('forwardEvent user 文本提取(修复移动端消息不持久化)', () => {
  // 根因:SDK 的 user 消息事件含用户输入的真实文本 prompt,但 case 'user' 只处理 tool_result,
  // 完全忽略纯文本。导致远程(移动端)发的 user 消息从不被提取/持久化(只靠脆弱的
  // REMOTE_USER_MESSAGE 补丁)。修复:user 消息含纯文本时,发 claude:user-message 通道,
  // 让 user 消息与 assistant 消息走同一条可靠的 claude:* 事件 → renderer 累积 → 落盘路径。
  it('user 消息含纯文本 prompt → 发 claude:user-message(含 localSessionId + text)', () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'user', uuid: 'u-user1', session_id: 's1',
      message: { role: 'user', content: [{ type: 'text', text: '从手机发的问题' }] },
    }, wc)
    const userMsg = calls.find(c => c.channel === 'claude:user-message')
    expect(userMsg).toBeTruthy()
    expect(userMsg!.data.localSessionId).toBe('sess1')
    expect(userMsg!.data.text).toBe('从手机发的问题')
  })

  it('user 消息只含 tool_result(无纯文本) → 不发 claude:user-message', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'user', uuid: 'u-user2', session_id: 's1',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x1', content: '结果', is_error: false }] },
    }, wc)
    // 纯 tool_result 的 user 消息不该触发 user-message(它不是用户输入的文本)
    expect(calls.some(c => c.channel === 'claude:user-message')).toBe(false)
  })

  it('user 消息同时含文本和 tool_result → 只提取文本发 claude:user-message,tool_result 仍正常处理', () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'user', uuid: 'u-user3', session_id: 's1',
      message: { role: 'user', content: [
        { type: 'text', text: '继续' },
        { type: 'tool_result', tool_use_id: 'toolu_x2', content: 'ok', is_error: false },
      ] },
    }, wc)
    const userMsg = calls.find(c => c.channel === 'claude:user-message')
    expect(userMsg!.data.text).toBe('继续')
    // tool_result 仍走 claude:blocks
    expect(calls.some(c => c.channel === 'claude:blocks' && c.data?.op === 'tool_result')).toBe(true)
  })

  // 守护测试：子代理（Task 工具）的 user turn 不得触发 claude:user-message。
  // SDKUserMessage 带 subagent_type 表示这是子代理内部对话流的消息，其 text 块是 Task 工具的
  // input.prompt。若不跳过，子代理 prompt 会被当作顶层用户消息渲染到对话流右侧（回归 bug）。
  // 修复前：forwardEvent 对 case 'user' 无差别提取 text，子代理 prompt 漏进 claude:user-message。
  it('子代理 user turn（subagent_type）→ 不发 claude:user-message，避免子代理 prompt 漏入对话流', () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'user', uuid: 'u-sub1', session_id: 's1',
      subagent_type: 'general-purpose',
      task_description: '审查代码',
      parent_tool_use_id: 'toolu_task1',
      message: { role: 'user', content: [
        { type: 'text', text: '请仔细审查 src/main 下的所有文件并报告问题' },
      ] },
    }, wc)
    expect(calls.some(c => c.channel === 'claude:user-message')).toBe(false)
  })
})
