// src/main/backend-task-registry.ts
// 后台任务注册表：记录 Claude Agent SDK spawn 的子任务（local_workflow 类型）。
// 纯逻辑模块，无 Electron 依赖，便于单元测试。
//
// 输入事件来自 SDK stream 中的 task_started / task_updated / task_notification。
// 输出由 claude-service.ts 注入 IPC 推送到渲染进程的任务面板。

export type BackendTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
export type BackendTaskKind = 'subagent' | 'workflow' | 'shell' | 'monitor'

export interface BackendTask {
  id: string              // SDK task_id
  localSessionId: string
  command: string         // task_started 的 description || prompt
  taskType?: string       // SDK 原始 task_type
  kind: BackendTaskKind   // 归一化类型,驱动 UI 分区/图标
  subagentType?: string   // subagent 专属(如 general-purpose)
  status: BackendTaskStatus
  startedAt: number
  lastKnownAt: number
}

interface TaskStartedEvent {
  task_id: string
  description?: string
  prompt?: string
  task_type?: string
  subagent_type?: string
}

interface TaskUpdatedEvent {
  task_id: string
  patch: {
    status?: string
    description?: string
  }
}

interface TaskNotificationEvent {
  task_id: string
  status: 'completed' | 'failed' | 'stopped'
}

export class BackendTaskRegistry {
  /** task_id → BackendTask */
  private tasks = new Map<string, BackendTask>()

  /**
   * 归一化 task_type/subagent_type → BackendTaskKind。
   * 优先级:subagent_type 非空 > task_type 字面值。
   * 无法明确归类（均无）时返回 null，registry 不创建。
   *
   * task_type 值域（见 SDK BackgroundTaskSummary.type）：
   * 'shell' | 'subagent' | 'monitor' | 'local_workflow'。
   * 历史版本也曾发过 'agent'，按 subagent 兜底。
   */
  private resolveKind(event: TaskStartedEvent): BackendTaskKind | null {
    if (event.subagent_type) return 'subagent'
    switch (event.task_type) {
      case 'subagent':
      case 'agent':          return 'subagent'   // 'agent' 历史值兜底
      case 'local_workflow': return 'workflow'
      case 'shell':          return 'shell'
      case 'monitor':        return 'monitor'
      default:               return null          // 未知不创建
    }
  }

  /**
   * 处理 task_started 事件。
   * 由 resolveKind 决定是否创建（subagent/workflow/shell/monitor 四类才创建）。
   * 重复 task_id 不会覆盖已存在的记录。
   * 返回创建的 BackendTask，或 null（无法归类时）。
   */
  handleTaskStarted(localSessionId: string, event: TaskStartedEvent): BackendTask | null {
    const kind = this.resolveKind(event)
    if (!kind) return null

    // 重复 task_id → 返回已存在的记录，不覆盖
    const existing = this.tasks.get(event.task_id)
    if (existing) return existing

    const now = Date.now()
    const task: BackendTask = {
      id: event.task_id,
      localSessionId,
      command: event.description || event.prompt || '(后台任务)',
      taskType: event.task_type,
      kind,
      subagentType: event.subagent_type,
      status: 'running',
      startedAt: now,
      lastKnownAt: now,
    }
    this.tasks.set(task.id, task)
    return task
  }

  /**
   * 处理 task_updated 事件。
   * 从 event.patch.status 映射并更新任务状态。
   * 返回更新后的 BackendTask，或 null（任务不存在时）。
   *
   * 状态映射：'completed'→completed, 'failed'/'killed'→failed, 'stopped'→stopped, 其余→running
   */
  handleTaskUpdated(localSessionId: string, event: TaskUpdatedEvent): BackendTask | null {
    const task = this.tasks.get(event.task_id)
    if (!task) return null
    if (task.localSessionId !== localSessionId) return null

    if (event.patch.status !== undefined) {
      task.status = this.mapStatus(event.patch.status)
    }
    task.lastKnownAt = Date.now()
    return task
  }

  /**
   * 处理 task_notification 事件。
   * 仅在任务存在且 localSessionId 匹配时更新状态。
   * 参数中的 status 直接使用，无需映射（已为最终状态字符串）。
   * 返回更新后的 BackendTask，或 null（任务不存在或会话不匹配时）。
   */
  handleTaskNotification(localSessionId: string, event: TaskNotificationEvent): BackendTask | null {
    const task = this.tasks.get(event.task_id)
    if (!task) return null
    if (task.localSessionId !== localSessionId) return null

    task.status = event.status
    task.lastKnownAt = Date.now()
    return task
  }

  /**
   * 查询指定会话的所有后台任务。
   */
  listBySession(localSessionId: string): BackendTask[] {
    const result: BackendTask[] = []
    for (const task of this.tasks.values()) {
      if (task.localSessionId === localSessionId) {
        result.push(task)
      }
    }
    return result
  }

  /**
   * 判断 task_id 是否已被注册表管理。
   */
  isManaged(taskId: string): boolean {
    return this.tasks.has(taskId)
  }

  /**
   * 清理指定会话的所有后台任务记录（归档/关闭会话时调用，避免 Map 无限增长）。
   * 返回被移除的任务数。
   */
  clearBySession(localSessionId: string): number {
    let removed = 0
    for (const [id, task] of this.tasks) {
      if (task.localSessionId === localSessionId) {
        this.tasks.delete(id)
        removed++
      }
    }
    return removed
  }

  /**
   * 清空所有后台任务记录（应用退出前调用）。
   */
  clearAll(): void {
    this.tasks.clear()
  }

  /** 内部：将 SDK patch.status 字符串映射到 BackendTaskStatus */
  private mapStatus(s: string): BackendTaskStatus {
    switch (s) {
      case 'completed': return 'completed'
      case 'failed':
      case 'killed':    return 'failed'
      case 'stopped':   return 'stopped'
      default:          return 'running'
    }
  }
}
