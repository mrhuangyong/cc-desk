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

  it('assistant 含 ExitPlanMode tool_use → claude:dialog-request（plan_proposed，阻塞式）', async () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    // forwardEvent 遇到 ExitPlanMode 现在阻塞（走 dialog 通道），返回未 resolve 的 Promise
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
    await new Promise(r => setTimeout(r, 0))

    // 应发 dialog-request（dialogKind='plan_proposed'），而非旧的 claude:plan
    const dialogs = calls.filter(c => c.channel === 'claude:dialog-request')
    expect(dialogs.length).toBe(1)
    expect(dialogs[0].data.dialogKind).toBe('plan_proposed')
    expect(String(dialogs[0].data.payload?.plan)).toContain('重构方案')

    // 用户选择前 Promise 应保持 pending
    let resolved = false
    fwdPromise.then(() => { resolved = true })
    await new Promise(r => setTimeout(r, 10))
    expect(resolved).toBe(false)

    // 用户批准：dialogResponse 回复
    svc.resolveDialog(dialogs[0].data.reqId, { behavior: 'completed', result: { permissionMode: '自动编辑' } })
    await new Promise(r => setTimeout(r, 10))
    expect(resolved).toBe(true)
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

  // ===== AskUserQuestion（阻塞式交互，确认 BUG 1 修复） =====

  it('assistant 含 AskUserQuestion tool_use → claude:dialog-request', async () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    // forwardEvent 现在是 async, 返回未 resolve 的 Promise（等待用户回答）
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
    // dialog-request 在微任务中发出
    await new Promise(r => setTimeout(r, 0))

    const dialogs = calls.filter(c => c.channel === 'claude:dialog-request')
    expect(dialogs.length).toBe(1)
    expect(dialogs[0].data.dialogKind).toBe('ask_user_question')
  })

  it('forwardEvent 遇到 AskUserQuestion 时阻塞：用户回答前 Promise 不 resolve', async () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    // forwardEvent 返回 Promise; 在用户回答前应保持 pending
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
    await new Promise(r => setTimeout(r, 10))
    // dialog-request 已发出，但 forwardEvent Promise 仍 pending（用户未回答）
    expect(calls.some(c => c.channel === 'claude:dialog-request')).toBe(true)
    let resolved = false
    fwdPromise.then(() => { resolved = true })
    await new Promise(r => setTimeout(r, 10))
    expect(resolved).toBe(false)

    // 模拟用户回答：通过 resolveDialog 结算
    const reqId = calls.find(c => c.channel === 'claude:dialog-request')!.data.reqId
    svc.resolveDialog(reqId, { behavior: 'completed', result: { answers: [{ questionIndex: 0, selected: { index: 0, label: 'A' } }] } })
    await new Promise(r => setTimeout(r, 10))
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
