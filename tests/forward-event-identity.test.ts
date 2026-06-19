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

  it('assistant 含 ExitPlanMode tool_use → claude:plan', () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'assistant',
      uuid: 'u7', session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '我先分析一下' },
          { type: 'tool_use', id: 'plan-use-1', name: 'ExitPlanMode', input: { plan: '# 重构方案\n\n1. 拆分模块' } },
        ],
      },
    }, wc)

    const plans = calls.filter(c => c.channel === 'claude:plan')
    expect(plans.length).toBe(1)
    expect(plans[0].data.op).toBe('plan_proposed')
    expect(String(plans[0].data.plan)).toContain('重构方案')
  })

  it('ExitPlanMode 不应作为普通 tool_use 卡片渲染（assistant_blocks 过滤）', () => {
    const svc = new ClaudeService()
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'assistant',
      uuid: 'u8', session_id: 's1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'plan-use-2', name: 'ExitPlanMode', input: { plan: 'p' } },
        ],
      },
    }, wc)

    const blocks = calls.filter(c => c.channel === 'claude:blocks' && c.data?.op === 'assistant_blocks')
    expect(blocks.length).toBe(1)
    // 过滤后不再含 ExitPlanMode tool_use
    const toolUses = blocks[0].data.blocks.filter((b: any) => b.type === 'tool_use')
    expect(toolUses.find((b: any) => b.name === 'ExitPlanMode')).toBeUndefined()
  })

  // ===== AskUserQuestion（确认现有链路） =====

  it('assistant 含 AskUserQuestion tool_use → claude:dialog-request（异步）', async () => {
    const svc = new ClaudeService()
    // handleAskUserQuestion 会调 manager.pushMessage，但底层是 void 异步，未 setManager 时早返回
    const { wc, calls } = mockWebContents()
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
    // handleAskUserQuestion 内部 webContents.send('claude:dialog-request') 在微任务中
    await new Promise(r => setTimeout(r, 0))

    const dialogs = calls.filter(c => c.channel === 'claude:dialog-request')
    expect(dialogs.length).toBe(1)
    expect(dialogs[0].data.dialogKind).toBe('ask_user_question')
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
