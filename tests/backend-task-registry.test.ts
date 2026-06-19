import { describe, it, expect } from 'vitest'
import { BackendTaskRegistry } from '../src/main/backend-task-registry'
import type { BackendTask } from '../src/main/backend-task-registry'

describe('BackendTaskRegistry', () => {
  // ---- 1. CREATE: task_started(task_type=local_workflow) ----
  it('task_started(task_type=local_workflow) 创建后台任务', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'tid1',
      description: '跑 pnpm dev',
      task_type: 'local_workflow',
    })

    expect(task).not.toBeNull()
    expect(task!.id).toBe('tid1')
    expect(task!.localSessionId).toBe('session1')
    expect(task!.command).toBe('跑 pnpm dev')
    expect(task!.taskType).toBe('local_workflow')
    expect(task!.status).toBe('running')
    expect(typeof task!.startedAt).toBe('number')
    expect(typeof task!.lastKnownAt).toBe('number')
  })

  // ---- 2. CREATE: command 回退到 prompt 字段 ----
  it('command 回退到 prompt 字段', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'tid2',
      prompt: 'sleep 30',
      task_type: 'local_workflow',
      // 无 description
    })

    expect(task).not.toBeNull()
    expect(task!.command).toBe('sleep 30')
  })

  it('command 回退到默认文本', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'tid3',
      task_type: 'local_workflow',
      // 无 description 也无 prompt
    })

    expect(task).not.toBeNull()
    expect(task!.command).toBe('(后台任务)')
  })

  // ---- 3. SKIP: 非 local_workflow 不创建 ----
  it('task_started 无 task_type（普通 todo）不创建后端任务', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'todo1',
      description: '普通用户请求',
      // 无 task_type
    })

    expect(task).toBeNull()
    expect(reg.listBySession('session1')).toHaveLength(0)
  })

  it('task_started 非 local_workflow 的 task_type 不创建', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'wt1',
      description: 'write 调用',
      task_type: 'tool',
    })

    expect(task).toBeNull()
    expect(reg.listBySession('session1')).toHaveLength(0)
  })

  // ---- 4. task_notification(completed) ----
  it('task_notification(completed) 标记 completed', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('session1', {
      task_id: 't1',
      description: '构建任务',
      task_type: 'local_workflow',
    })

    const updated = reg.handleTaskNotification('session1', {
      task_id: 't1',
      status: 'completed',
    })

    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('completed')
    expect(updated!.lastKnownAt).toBeGreaterThanOrEqual(updated!.startedAt)

    // 验证 registry 中的任务状态也已更新
    expect(reg.isManaged('t1')).toBe(true)
    const tasks = reg.listBySession('session1')
    expect(tasks[0].status).toBe('completed')
  })

  // ---- 5. task_notification(failed/stopped) ----
  it('task_notification(failed) 标记 failed', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('session1', {
      task_id: 't2',
      description: '可能失败的任务',
      task_type: 'local_workflow',
    })

    const updated = reg.handleTaskNotification('session1', {
      task_id: 't2',
      status: 'failed',
    })

    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('failed')
  })

  it('task_notification(stopped) 标记 stopped', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('session1', {
      task_id: 't3',
      description: '被停止的任务',
      task_type: 'local_workflow',
    })

    const updated = reg.handleTaskNotification('session1', {
      task_id: 't3',
      status: 'stopped',
    })

    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('stopped')
  })

  // ---- 6. task_notification 未知任务 ----
  it('task_notification 未知任务不抛错，不创建', () => {
    const reg = new BackendTaskRegistry()
    // 对一个不存在的 task_id 调用不应抛异常
    expect(() => {
      const result = reg.handleTaskNotification('session1', {
        task_id: 'unknown_task',
        status: 'completed',
      })
      expect(result).toBeNull()
    }).not.toThrow()

    // 确认没有新任务被创建
    expect(reg.listBySession('session1')).toHaveLength(0)
    expect(reg.isManaged('unknown_task')).toBe(false)
  })

  // ---- 7. 会话隔离 ----
  it('不同 localSessionId 互不干扰', () => {
    const reg = new BackendTaskRegistry()

    reg.handleTaskStarted('session_a', {
      task_id: 'ta1',
      description: '会话A的任务',
      task_type: 'local_workflow',
    })
    reg.handleTaskStarted('session_b', {
      task_id: 'tb1',
      description: '会话B的任务',
      task_type: 'local_workflow',
    })

    // 每个会话只看到自己的任务
    const listA = reg.listBySession('session_a')
    const listB = reg.listBySession('session_b')
    expect(listA).toHaveLength(1)
    expect(listA[0].id).toBe('ta1')
    expect(listB).toHaveLength(1)
    expect(listB[0].id).toBe('tb1')

    // task_notification 跨会话不生效
    const crossUpdate = reg.handleTaskNotification('session_a', {
      task_id: 'tb1',
      status: 'completed',
    })
    expect(crossUpdate).toBeNull()
    // session_b 的任务状态应保持不变
    expect(reg.listBySession('session_b')[0].status).toBe('running')
  })

  // ---- 8. isManaged ----
  it('isManaged 正确判断 task_id 是否在 registry 中', () => {
    const reg = new BackendTaskRegistry()
    expect(reg.isManaged('nonexistent')).toBe(false)

    reg.handleTaskStarted('session1', {
      task_id: 'mid1',
      description: '受管任务',
      task_type: 'local_workflow',
    })

    expect(reg.isManaged('mid1')).toBe(true)
    expect(reg.isManaged('nonexistent')).toBe(false)
  })

  // ---- 9. handleTaskUpdated: patch status 更新 ----
  it('handleTaskUpdated patch status 更新', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('session1', {
      task_id: 'u1',
      description: '更新测试',
      task_type: 'local_workflow',
    })

    // completed 映射
    const updated = reg.handleTaskUpdated('session1', {
      task_id: 'u1',
      patch: { status: 'completed' },
    })
    expect(updated!.status).toBe('completed')

    // failed 映射
    reg.handleTaskUpdated('session1', {
      task_id: 'u1',
      patch: { status: 'failed' },
    })
    expect(reg.isManaged('u1') && reg.listBySession('session1')[0].status).toBe('failed')

    // killed → failed 映射
    reg.handleTaskUpdated('session1', {
      task_id: 'u1',
      patch: { status: 'killed' },
    })
    expect(reg.listBySession('session1')[0].status).toBe('failed')

    // stopped 映射
    reg.handleTaskUpdated('session1', {
      task_id: 'u1',
      patch: { status: 'stopped' },
    })
    expect(reg.listBySession('session1')[0].status).toBe('stopped')

    // 未知状态 → running
    reg.handleTaskUpdated('session1', {
      task_id: 'u1',
      patch: { status: 'unknown_state' },
    })
    expect(reg.listBySession('session1')[0].status).toBe('running')
  })

  it('handleTaskUpdated 不存在的任务返回 null', () => {
    const reg = new BackendTaskRegistry()
    const result = reg.handleTaskUpdated('session1', {
      task_id: 'nonexistent',
      patch: { status: 'completed' },
    })
    expect(result).toBeNull()
  })

  it('handleTaskUpdated 跨 session 不生效，不修改任务', () => {
    const reg = new BackendTaskRegistry()
    // 在 session 's1' 中创建任务
    reg.handleTaskStarted('s1', {
      task_id: 'cross1',
      description: 's1 的任务',
      task_type: 'local_workflow',
    })

    // 通过 session 's2' 调用 handleTaskUpdated 不应生效
    const result = reg.handleTaskUpdated('s2', {
      task_id: 'cross1',
      patch: { status: 'completed' },
    })
    expect(result).toBeNull()

    // 任务状态应保持不变（仍是 running）
    const tasks = reg.listBySession('s1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].status).toBe('running')
  })

  // ---- 重复 task_id 不覆盖 ----
  it('重复 task_id 不覆盖已有记录', () => {
    const reg = new BackendTaskRegistry()
    const first = reg.handleTaskStarted('session1', {
      task_id: 'dup1',
      description: '第一次',
      task_type: 'local_workflow',
    })
    const second = reg.handleTaskStarted('session1', {
      task_id: 'dup1',
      description: '第二次（应被忽略）',
      task_type: 'local_workflow',
    })

    // 第二次返回同一个对象
    expect(second).toBe(first)
    expect(second!.command).toBe('第一次')
  })
})

describe('BackendTaskRegistry 清理（防内存泄漏）', () => {
  it('clearBySession 移除指定会话的所有任务，返回移除数', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', { task_id: 'a', task_type: 'local_workflow', description: 'x' })
    reg.handleTaskStarted('s1', { task_id: 'b', task_type: 'local_workflow', description: 'y' })
    reg.handleTaskStarted('s2', { task_id: 'c', task_type: 'local_workflow', description: 'z' })
    const removed = reg.clearBySession('s1')
    expect(removed).toBe(2)
    expect(reg.listBySession('s1')).toEqual([])
    // 其他会话不受影响
    expect(reg.listBySession('s2').length).toBe(1)
    expect(reg.isManaged('c')).toBe(true)
  })

  it('clearBySession 不存在的会话 → 返回 0，不报错', () => {
    const reg = new BackendTaskRegistry()
    expect(reg.clearBySession('none')).toBe(0)
  })

  it('clearAll 清空全部', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', { task_id: 'a', task_type: 'local_workflow', description: 'x' })
    reg.handleTaskStarted('s2', { task_id: 'b', task_type: 'local_workflow', description: 'y' })
    reg.clearAll()
    expect(reg.listBySession('s1')).toEqual([])
    expect(reg.listBySession('s2')).toEqual([])
    expect(reg.isManaged('a')).toBe(false)
  })

  it('清理后同 task_id 可重新注册（无残留）', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('s1', { task_id: 'reuse', task_type: 'local_workflow', description: 'old' })
    reg.clearBySession('s1')
    const t = reg.handleTaskStarted('s1', { task_id: 'reuse', task_type: 'local_workflow', description: 'new' })
    expect(t).not.toBeNull()
    expect(t!.command).toBe('new')
  })
})

  // ===== resolveKind: subagent 识别 =====
  it('task_started 带 subagent_type → 创建 kind=subagent 任务', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'sub1',
      task_type: 'subagent',
      subagent_type: 'general-purpose',
      description: '审查 src 目录',
    })

    expect(task).not.toBeNull()
    expect(task!.kind).toBe('subagent')
    expect(task!.subagentType).toBe('general-purpose')
    expect(task!.command).toBe('审查 src 目录')
  })

  it('task_started subagent_type 非空但 task_type 为 agent → 仍归 subagent', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'sub2',
      task_type: 'agent',
      subagent_type: 'code-reviewer',
      description: '代码评审',
    })

    expect(task).not.toBeNull()
    expect(task!.kind).toBe('subagent')
  })

  it('local_workflow 事件 kind=workflow', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'wf1', task_type: 'local_workflow', description: '跑脚本',
    })

    expect(task).not.toBeNull()
    expect(task!.kind).toBe('workflow')
  })

  it('无 task_type 且无 subagent_type → 不创建(兼容旧 todo 行为)', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'unknown1', description: '神秘任务',
    })

    expect(task).toBeNull()
  })

  // ===== task_progress: 实时进度更新 =====
  it('handleTaskProgress 更新已注册任务的进度字段', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('session1', {
      task_id: 'sub-p1', task_type: 'subagent', subagent_type: 'general-purpose',
      description: '审查代码',
    })
    const updated = reg.handleTaskProgress('session1', {
      task_id: 'sub-p1',
      description: '正在分析 src 目录',
      usage: { total_tokens: 1234, tool_uses: 3, duration_ms: 5000 },
      last_tool_name: 'Read',
      summary: '已读取 3 个文件',
    })

    expect(updated).not.toBeNull()
    expect(updated!.progressSummary).toBe('已读取 3 个文件')
    expect(updated!.lastToolName).toBe('Read')
    expect(updated!.tokenCount).toBe(1234)
    expect(updated!.toolUses).toBe(3)
    expect(updated!.durationMs).toBe(5000)
  })

  it('handleTaskProgress 未注册任务 → 返回 null', () => {
    const reg = new BackendTaskRegistry()
    const updated = reg.handleTaskProgress('session1', {
      task_id: 'nope',
      description: 'x',
      usage: { total_tokens: 1, tool_uses: 0, duration_ms: 0 },
    })
    expect(updated).toBeNull()
  })

  it('handleTaskProgress 同步刷新 lastKnownAt', () => {
    const reg = new BackendTaskRegistry()
    reg.handleTaskStarted('session1', {
      task_id: 'sub-p2', task_type: 'subagent', subagent_type: 'general-purpose',
      description: 'x',
    })
    const before = reg.listBySession('session1')[0].lastKnownAt
    // 确保时间推进
    const updated = reg.handleTaskProgress('session1', {
      task_id: 'sub-p2', description: 'x',
      usage: { total_tokens: 1, tool_uses: 0, duration_ms: 0 },
    })
    expect(updated!.lastKnownAt).toBeGreaterThanOrEqual(before)
  })
