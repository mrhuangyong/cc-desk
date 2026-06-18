// src/main/claude-service.ts
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { BackendTaskRegistry } from './backend-task-registry'
import type { SessionQueryManager, PushController, SDKUserMessage } from './session-query-manager'
import type { WebContents } from 'electron'
import { getSettings } from './settings-store'
import { getModelProvidersConfig, resolveActiveProviderModel, buildSdkEnv } from './cc-desk-store'
import { getGeneralConfig } from './claude-config'
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId, mkNotice } from './claude-normalize'
import { getPermissionMode } from './builtin-commands'

/**
 * ClaudeService：渲染端 ↔ SessionQueryManager 的桥。
 * send() 委托 manager.ensureSession + pushMessage。事件转发逻辑注入 buildQuery。
 * 不再直接 query()——持久 query 由 SessionQueryManager 管理（streaming-input 长连接），
 * 中断走 query.interrupt() 而非杀进程，使后台任务能跨多轮存活。
 */
export class ClaudeService {
  private manager: SessionQueryManager | null = null
  private registry: BackendTaskRegistry | null = null
  // 记录 Bash/Task 工具的 tool_use block，供 tool_result 阶段提取 auto-background 命令
  private toolUseInputs = new Map<string, { name: string; input: any }>()
  // Pending onUserDialog resolvers keyed by reqId。渲染端经 claude:dialog-response 回答。
  private dialogResolvers = new Map<string, (r: any) => void>()

  setManager(m: SessionQueryManager): void { this.manager = m }
  setRegistry(r: BackendTaskRegistry): void { this.registry = r }

  /** 渲染端回答后经 claude:dialog-response IPC 调用，结算挂起的 dialog。 */
  resolveDialog(reqId: string, result: any): void {
    const fn = this.dialogResolvers.get(reqId)
    if (fn) {
      this.dialogResolvers.delete(reqId)
      fn(result)
    }
  }

  /**
   * 把 SDK 阻塞式 onUserDialog 桥接为渲染端 dialog：发 claude:dialog-request，
   * 挂起 Promise 直到渲染端经 dialog-response 回答，或 query 的 AbortSignal 触发（cancelled）。
   */
  async askUserDialog(
    webContents: WebContents,
    request: { dialogKind: string; payload: unknown; toolUseID?: string },
    signal: AbortSignal,
  ): Promise<any> {
    const reqId = `dlg${Date.now()}_${Math.floor(performance.now())}`
    webContents.send('claude:dialog-request', {
      reqId,
      dialogKind: request.dialogKind,
      payload: request.payload,
      toolUseId: request.toolUseID,
    })
    return new Promise<any>((resolve) => {
      this.dialogResolvers.set(reqId, resolve)
      signal.addEventListener(
        'abort',
        () => {
          if (this.dialogResolvers.has(reqId)) {
            this.dialogResolvers.delete(reqId)
            resolve({ behavior: 'cancelled' })
          }
        },
        { once: true },
      )
    })
  }

  async send(opts: {
    prompt: string
    sessionId?: string
    localSessionId?: string
    cwd?: string
    permission?: string        // 中文标签，主进程翻译
    thinking?: 'low' | 'medium' | 'high'
    extraDirs?: string[]
    webContents: WebContents
  }): Promise<void> {
    const { prompt, sessionId, localSessionId, cwd, permission, thinking, extraDirs, webContents } = opts
    // 本次流绑定的渲染端会话 id。所有事件载荷带上它，渲染端据此路由到正确会话，
    // 避免「在 A 发送后切到 B，A 的流式输出串到 B」。
    const lsid = localSessionId ?? ''
    if (!this.manager) {
      webContents.send('claude:error', { localSessionId: lsid, error: 'SessionQueryManager 未初始化' })
      return
    }

    const settings = getSettings()
    // 从 cc-desk 自有配置（~/.cc-desk/config.json）取激活的供应商+模型。
    const cfg = getModelProvidersConfig()
    const resolved = resolveActiveProviderModel(cfg)
    if (!resolved) {
      webContents.send('claude:error', { localSessionId: lsid, error: '请先在「设置 → 模型设置」中添加并启用供应商与模型' })
      return
    }
    const general = await getGeneralConfig()

    // 代理环境变量（来自常规设置 proxy）
    const proxyEnv: Record<string, string> = general.proxy
      ? { HTTP_PROXY: general.proxy, HTTPS_PROXY: general.proxy, http_proxy: general.proxy, https_proxy: general.proxy }
      : {}

    // toolUseInputs 按 tool_use id 累积，跨轮持久（一轮的 tool_use 可能在下一轮的
    // tool_result 阶段才被读取）。id 全局唯一，故不在此清空；每个 entry 体量很小，
    // 长会话下增长有限，已知可接受。每次 send 复用 manager 的持久 query，故不清。
    const onEvent = (message: any) => this.forwardEvent(message, lsid, webContents)
    const onError = (err: unknown) => {
      webContents.send('claude:error', { localSessionId: lsid, error: String(err) })
    }

    // ensureSession 复用已有持久 query（同 localSessionId），否则用 buildQuery 新建。
    // prompt 作为新的 user turn 通过 pushMessage 注入 controller.iterable。
    this.manager.ensureSession({
      localSessionId: lsid,
      resumeId: sessionId,
      webContents,
      onEvent,
      onError,
      buildQuery: (controller: PushController<SDKUserMessage>) => query({
        prompt: controller.iterable,
        options: {
          // env REPLACES process.env，故先铺底再覆盖。注入激活供应商的 apiKey/baseUrl
          // 与各角色模型映射（来自 ~/.cc-desk/config.json）。
          env: { ...process.env, ...proxyEnv, ...buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models) },
          model: resolved.model.sdkModelId,
          cwd: cwd || settings.cwd || process.cwd(),
          resume: sessionId,
          permissionMode: getPermissionMode(permission),   // 中文标签 → SDK permissionMode（未知回退 'default'）
          effort: thinking ?? 'medium',                    // SDK EffortLevel，控制思考强度
          thinking: { type: 'adaptive' },                  // 配合 effort 自适应思考
          additionalDirectories: extraDirs?.length ? extraDirs : undefined,
          maxTurns: 20,
          // Required to receive incremental stream_event deltas.
          includePartialMessages: true,
          // Bridge the SDK's blocking `onUserDialog` to a renderer-side dialog UI.
          supportedDialogKinds: ['refusal_fallback_prompt'],
          onUserDialog: async (request: any, { signal }: { signal: AbortSignal }) => {
            return this.askUserDialog(webContents, request, signal)
          },
        },
      }),
    })

    this.manager.pushMessage(lsid, prompt)
  }

  // SDK message → IPC 转发。逻辑与原 claude-service 的 for-await case 一致。
  private forwardEvent(message: any, lsid: string, webContents: WebContents): void {
    const mtype: string = message.type
    switch (mtype) {
      case 'system': {
        const sys = message
        if (sys.subtype === 'init') {
          webContents.send('claude:system', { localSessionId: lsid, sessionId: sys.session_id, model: sys.model, tools: sys.tools })
        } else if (sys.subtype === 'permission_denied') {
          webContents.send('claude:notice', { ...mkNotice('permission_denied', `权限拒绝：${sys.tool_name}`, 'warn'), localSessionId: lsid })
        } else if (sys.subtype === 'compact' || (sys.subtype && String(sys.subtype).startsWith('compact') && sys.compact_result === 'failed')) {
          webContents.send('claude:notice', { ...mkNotice('compact', `上下文压缩失败：${sys.compact_error ?? sys.subtype}`, 'warn'), localSessionId: lsid })
        }
        // 其余 system 子类型（status 瞬态、hook 协议进度等）属内部噪声，不打扰用户。
        break
      }
      case 'stream_event': {
        const evt = message.event
        if (evt?.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'text', delta: evt.delta.text })
          else if (evt.delta?.type === 'thinking_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'thinking', delta: evt.delta.thinking })
        } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          const tb = evt.content_block
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_use_start', block: { type: 'tool_use', id: tb.id, name: tb.name, input: tb.input, status: 'running' } })
          // 记录所有 tool_use 的 input，供 tool_result 阶段提取 auto-background 信息
          if (tb.name === 'Bash' || tb.name === 'Task') {
            this.toolUseInputs.set(tb.id, { name: tb.name, input: tb.input })
          }
        }
        break
      }
      case 'assistant': {
        const blocks = normalizeBetaBlocks(message.message?.content || [])
        // assistant 消息含完整 tool_use input（stream_event 的 content_block_start 时 input 还是空壳，
        // 这里补全，供 user 阶段提取后台命令文本）
        const aContent = message.message?.content || []
        if (Array.isArray(aContent)) {
          for (const ab of aContent) {
            if (ab?.type === 'tool_use' && (ab.name === 'Bash' || ab.name === 'Task')) {
              this.toolUseInputs.set(ab.id, { name: ab.name, input: ab.input })
            }
          }
        }
        webContents.send('claude:blocks', { localSessionId: lsid, op: 'assistant_blocks', blocks, uuid: message.uuid })
        break
      }
      case 'user': {
        const results = extractToolResults(message.message?.content || [])
        for (const r of results) {
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_result', toolUseId: r.toolUseId, result: { content: r.content, isError: r.isError } })
        }
        // 检测 auto-background 命令：Bash tool_result 带 backgroundTaskId → 建 backend task
        const rawContent = message.message?.content || []
        if (Array.isArray(rawContent)) {
          for (const b of rawContent) {
            if (b?.type !== 'tool_result') continue
            const bgId = extractBackgroundTaskId(b)
            if (!bgId || !this.registry) continue
            const toolUse = this.toolUseInputs.get(b.tool_use_id)
            // tool_result content 文本（用于兜底提取命令）
            let resultText = ''
            const bc = b.content
            if (typeof bc === 'string') resultText = bc
            else if (Array.isArray(bc)) resultText = bc.map((x: any) => x?.text ?? '').join('')
            // 命令优先级：toolUse.input.command → toolUse.input.prompt → 结果文本头部 → 占位
            let cmd = toolUse?.input?.command || toolUse?.input?.prompt || ''
            if (!cmd) {
              cmd = resultText.split('\n')[0].slice(0, 60) || '(后台命令)'
            }
            const t = this.registry.handleTaskStarted(lsid, {
              task_id: bgId,
              description: cmd,
              prompt: cmd,
              task_type: 'local_workflow',
            })
            if (t) {
              webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
            }
          }
        }
        break
      }
      case 'result': {
        const r = message
        webContents.send('claude:result', {
          localSessionId: lsid,
          sessionId: r.session_id, subtype: r.subtype, isError: !!r.is_error,
          costUSD: r.total_cost_usd, durationMs: r.duration_ms, turns: r.num_turns,
        })
        if (r.is_error) webContents.send('claude:notice', { ...mkNotice('error', `任务出错（${r.subtype}）`, 'error'), localSessionId: lsid })
        break
      }
      case 'api_retry':
        webContents.send('claude:notice', { ...mkNotice('api_retry', 'API 重试中', 'warn'), localSessionId: lsid }); break
      case 'auth_status': {
        const am = message
        const text = am.error ? `认证错误：${am.error}` : ((Array.isArray(am.output) ? am.output.join(' ') : '') || (am.isAuthenticating ? '认证中…' : '认证就绪'))
        webContents.send('claude:notice', { ...mkNotice('auth', text, am.error ? 'warn' : 'info'), localSessionId: lsid })
        break
      }
      case 'task_started': {
        const tm = message
        if (tm.task_type === 'local_workflow' && this.registry) {
          const t = this.registry.handleTaskStarted(lsid, {
            task_id: tm.task_id,
            description: tm.description ?? '',
            prompt: tm.prompt ?? '',
            task_type: tm.task_type,
            subagent_type: tm.subagent_type,
          })
          if (t) {
            webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
          }
        } else {
          webContents.send('claude:task', {
            localSessionId: lsid, kind: 'started',
            taskId: tm.task_id, description: tm.description ?? '', taskType: tm.task_type ?? '',
          })
        }
        break
      }
      case 'task_updated': {
        const tm = message
        if (this.registry?.isManaged(tm.task_id)) {
          const t = this.registry.handleTaskUpdated(lsid, {
            task_id: tm.task_id,
            patch: tm.patch ?? {},
          })
          if (t) {
            webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
          }
        } else {
          webContents.send('claude:task', {
            localSessionId: lsid, kind: 'updated',
            taskId: tm.task_id, patch: tm.patch ?? {},
          })
        }
        break
      }
      case 'task_progress':
        webContents.send('claude:notice', { ...mkNotice('task', `任务事件：${message.type}`, 'info'), localSessionId: lsid }); break
      case 'task_notification': {
        const tm = message
        if (this.registry?.isManaged(tm.task_id)) {
          const t = this.registry.handleTaskNotification(lsid, {
            task_id: tm.task_id,
            status: tm.status ?? 'completed',
          })
          if (t) {
            webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
          }
        } else {
          webContents.send('claude:task', {
            localSessionId: lsid, kind: 'updated',
            taskId: tm.task_id,
            patch: { status: tm.status ?? 'completed' },
          })
        }
        break
      }
      case 'keep_alive':
      case 'worker_shutting_down':
      case 'commands_changed':
        break
      default:
        webContents.send('claude:notice', { ...mkNotice('info', `未分类事件：${message.type}`, 'info'), localSessionId: lsid })
    }
  }

  /** 中断当前轮次（不杀进程，后台任务存活）。委托 manager.interrupt。 */
  interrupt(localSessionId: string): Promise<void> {
    return this.manager?.interrupt(localSessionId) ?? Promise.resolve()
  }

  /** 关闭会话：关闭 controller + query.return()，删除 session。委托 manager.closeSession。 */
  closeSession(localSessionId: string): Promise<void> {
    return this.manager?.closeSession(localSessionId) ?? Promise.resolve()
  }

  /** 停止单个后台任务。委托 manager.stopTask。 */
  stopTask(localSessionId: string, taskId: string): Promise<void> {
    return this.manager?.stopTask(localSessionId, taskId) ?? Promise.resolve()
  }
}
