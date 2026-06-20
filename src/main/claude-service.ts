// src/main/claude-service.ts
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { BackendTaskRegistry, BackendTask } from './backend-task-registry'
import type { SessionQueryManager, PushController, SDKUserMessage } from './session-query-manager'
import type { WebContents } from 'electron'
import { getSettings } from './settings-store'
import { getModelProvidersConfig, resolveActiveProviderModel, buildSdkEnv } from './cc-desk-store'
import { getProjectsSnapshot } from './projects-store'
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId, contentToText, mkNotice } from './claude-normalize'
import { getPermissionMode } from './builtin-commands'
import { getSkills } from './claude-config'

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
  // 每个 session 的 AbortController:创建 query 时传入,interrupt 不生效时 abort() 兜底强制中止。
  private abortControllers = new Map<string, AbortController>()

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
    return this.askUserViaPanel(webContents, request.dialogKind, request.payload, request.toolUseID, signal, this.currentLsid)
  }

  // 当前流绑定的 localSessionId：send 时设置，供 onUserDialog 回调取用（SDK 回调无 lsid 参数）
  private currentLsid: string | null = null

  /**
   * 经渲染端底部面板问用户问题（AskUserQuestion 拦截场景与 SDK dialog 场景共用）。
   * 发 claude:dialog-request，挂起 Promise 直到渲染端经 dialog-response 回答。
   * signal 可选：SDK dialog 场景传 query 的 AbortSignal；本地拦截场景传 undefined（永不 abort）。
   */
  async askUserViaPanel(
    webContents: WebContents,
    dialogKind: string,
    payload: unknown,
    toolUseId: string | undefined,
    signal?: AbortSignal,
    localSessionId?: string | null,
  ): Promise<any> {
    const reqId = `dlg${Date.now()}_${Math.floor(performance.now())}`
    webContents.send('claude:dialog-request', {
      reqId,
      localSessionId: localSessionId ?? undefined,
      dialogKind,
      payload,
      toolUseId,
    })
    return new Promise<any>((resolve) => {
      this.dialogResolvers.set(reqId, resolve)
      if (signal) {
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
      }
    })
  }

  /**
   * 处理拦截到的 AskUserQuestion tool_use：弹底部面板让用户答，
   * 答案格式化成文本 pushMessage 回 SDK，让对话续跑（SDK 自动回填的 dummy tool_result 那轮结束，
   * 新 user turn 触发新一轮 assistant 输出）。
   */
  private async handleAskUserQuestion(
    localSessionId: string,
    toolUse: { id: string; input: any },
    webContents: WebContents,
  ): Promise<void> {
    const input = toolUse.input || {}
    const questions: any[] = Array.isArray(input.questions) ? input.questions : []
    if (questions.length === 0) return
    let result: any
    try {
      result = await this.askUserViaPanel(webContents, 'ask_user_question', input, toolUse.id, undefined, localSessionId)
    } catch {
      result = { behavior: 'cancelled' }
    }
    if (!this.manager) return
    // 取消 / 未完成：仍推一条提示，避免模型卡住
    if (result?.behavior !== 'completed') {
      this.manager.pushMessage(localSessionId, '（用户取消了这次提问）')
      return
    }
    // 把答案格式化成自然语言文本
    const answers: any[] = result?.result?.answers ?? []
    const lines: string[] = []
    questions.forEach((q, qi) => {
      const ans = answers.find((a) => a.questionIndex === qi)
      const label = q.question || `问题 ${qi + 1}`
      if (!ans) { lines.push(`${label}：（未回答）`); return }
      if (ans.other !== undefined) {
        lines.push(`${label}：${ans.other}`)
      } else if (ans.selected) {
        // selected 可能是 {index,label}（单选）或数组（多选）
        const sel = ans.selected
        const text = Array.isArray(sel)
          ? sel.map((s: any) => s?.label ?? s).join('、')
          : (sel?.label ?? String(sel))
        lines.push(`${label}：${text}`)
      }
    })
    this.manager.pushMessage(localSessionId, `用户回答：\n${lines.join('\n')}`)
  }

  /**
   * 处理拦截到的 ExitPlanMode tool_use（计划模式提交计划）。
   * 走与 AskUserQuestion 相同的阻塞式 dialog 通道：
   *   ① 发 claude:dialog-request（dialogKind='plan_proposed'），阻塞等待用户选择授权模式
   *   ② 用户选择后：调 setPermissionMode control request 让 SDK 实时退出 plan 模式，
   *      并把结果 pushMessage 回 SDK 让模型开始执行计划
   *   ③ 用户取消/拒绝计划：pushMessage 告知模型保持 plan 模式修改计划
   */
  private async handleExitPlanMode(
    localSessionId: string,
    toolUse: { id: string; input: any },
    webContents: WebContents,
  ): Promise<void> {
    const input = toolUse.input || {}
    const plan = typeof input.plan === 'string' ? input.plan : ''
    const allowedPrompts = Array.isArray(input.allowedPrompts) ? input.allowedPrompts : undefined
    let result: any
    try {
      result = await this.askUserViaPanel(webContents, 'plan_proposed', { plan, allowedPrompts }, toolUse.id, undefined, localSessionId)
    } catch {
      result = { behavior: 'cancelled' }
    }
    if (!this.manager) return
    if (result?.behavior === 'completed' && result?.result?.permissionMode) {
      // 用户批准计划并选定授权模式：SDK 端实时切换权限（退出 plan 模式）
      const permissionLabel = result.result.permissionMode
      await this.setPermissionMode(localSessionId, permissionLabel)
      this.manager.pushMessage(localSessionId, '（用户已批准计划，开始执行）')
    } else {
      // 用户拒绝/取消：保持 plan 模式，让模型修改计划
      this.manager.pushMessage(localSessionId, '（用户未批准计划，请根据反馈修改计划）')
    }
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
    this.currentLsid = lsid
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
    // 代理环境变量（来自 cc-desk 自有常规设置 ~/.cc-desk/settings.json）。
    // 不再读 ~/.claude/settings.json：CLAUDE_CONFIG_DIR 已隔离到 ~/.cc-desk/claude。
    const proxyEnv: Record<string, string> = settings.proxy
      ? { HTTP_PROXY: settings.proxy, HTTPS_PROXY: settings.proxy, http_proxy: settings.proxy, https_proxy: settings.proxy }
      : {}

    // 启用的技能名（白名单）：从 ~/.cc-desk/claude 的 skills 扫描结果减去黑名单。
    // 传给 SDK query 的 skills option，使禁用的技能真实不加载。
    const enabledSkillNames = (await getSkills()).filter(s => s.enabled).map(s => s.name)

    // toolUseInputs 按 tool_use id 累积，跨轮持久（一轮的 tool_use 可能在下一轮的
    // tool_result 阶段才被读取）。id 全局唯一，故不在此清空；每个 entry 体量很小，
    // 长会话下增长有限，已知可接受。每次 send 复用 manager 的持久 query，故不清。
    const onEvent = (message: any) => this.forwardEvent(message, lsid, webContents)
    const onError = (err: unknown) => {
      webContents.send('claude:error', { localSessionId: lsid, error: String(err) })
    }

    // ensureSession 复用已有持久 query（同 localSessionId），否则用 buildQuery 新建。
    // prompt 作为新的 user turn 通过 pushMessage 注入 controller.iterable。
    // 记录会话是否已存在：复用时 buildQuery 不再执行，permissionMode 只在 buildQuery 里
    // 声明，故必须在复用路径里用 setPermissionMode control request 实时切换，否则下拉框
    // 改权限会被忽略（首个权限被首条消息锁死）。新建会话由 buildQuery 内 permissionMode 直接生效。
    const sessionExisted = this.manager.sessions.has(lsid)
    this.manager.ensureSession({
      localSessionId: lsid,
      resumeId: sessionId,
      webContents,
      onEvent,
      onError,
      buildQuery: (controller: PushController<SDKUserMessage>) => {
        // 创建 AbortController 供 interrupt 不生效时 abort() 兜底强制中止。
        const ac = new AbortController()
        this.abortControllers.set(lsid, ac)
        return query({
        prompt: controller.iterable,
        options: {
          abortController: ac,
          // env REPLACES process.env，故先铺底再覆盖。注入激活供应商的 apiKey/baseUrl
          // 与各角色模型映射（来自 ~/.cc-desk/config.json）。
          env: { ...process.env, ...proxyEnv, ...buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models) },
          model: resolved.model.sdkModelId,
          cwd: cwd || settings.cwd || process.cwd(),
          resume: sessionId,
          permissionMode: getPermissionMode(permission),   // 中文标签 → SDK permissionMode（未知回退 'default'）
          // 允许运行时动态切到 bypassPermissions（「完全访问」/ 计划批准选完全访问时）。
          // SDK 要求 query 创建时显式声明此项，否则 setPermissionMode('bypassPermissions') 会被拒绝。
          allowDangerouslySkipPermissions: true,
          effort: thinking ?? 'medium',                    // SDK EffortLevel，控制思考强度
          thinking: { type: 'adaptive' },                  // 配合 effort 自适应思考
          additionalDirectories: extraDirs?.length ? extraDirs : undefined,
          // 技能白名单：仅加载用户启用的技能（禁用的技能从模型列表隐藏）。
          skills: enabledSkillNames.length ? enabledSkillNames : 'all',
          // 模型输出语言跟随界面国际化设置。
          // 用 preset:'claude_code' 保留 SDK 完整默认系统提示，append 追加语言约束——
          // 对任意模型（含经第三方代理的 GLM）都生效，比 settings.language 可靠
          // （settings.language 对经代理的非 Anthropic 模型常被忽略）。
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: settings.lang === 'en'
              ? 'Always respond in English, regardless of the language of the user message.'
              : '始终用简体中文回复，无论用户消息使用何种语言。',
          },
          settings: {
            language: settings.lang === 'en' ? 'english' : 'chinese',
            // 显式启用 SDK 内置自动压缩：context 接近满时，SDK 会真正摘要并替换内部
            // 历史（产生 compact boundary），从而真实降低后续轮次的 token 消耗。
            // cc-desk 手写的 /compact 仅压缩 UI 展示；SDK 侧的真实 context 压缩由此项负责。
            autoCompactEnabled: true,
          },
          // 轮次上限：授权等待/长对话会消耗 turn 预算，调大避免 error_max_turns
          maxTurns: 200,
          // Required to receive incremental stream_event deltas.
          includePartialMessages: true,
          // Bridge the SDK's blocking `onUserDialog` to a renderer-side dialog UI.
          // 经第三方代理时 AskUserQuestion 不走 SDK dialog（cc-desk 在 forwardEvent 自行拦截）；
          // 此处仅声明 refusal_fallback_prompt（权限拒绝回退）。
          supportedDialogKinds: ['refusal_fallback_prompt'],
          onUserDialog: async (request: any, { signal }: { signal: AbortSignal }) => {
            return this.askUserDialog(webContents, request, signal)
          },
        },
      })
      }
    })

    // 复用会话时，buildQuery 不会重跑，permissionMode 也不会更新。
    // 用 control request 把本次权限实时推给已存在的 query，使下拉框切换即时生效。
    if (sessionExisted && permission) {
      await this.setPermissionMode(lsid, permission)
    }

    this.manager.pushMessage(lsid, prompt)
  }

  // SDK message → IPC 转发。逻辑与原 claude-service 的 for-await case 一致。
  private async forwardEvent(message: any, lsid: string, webContents: WebContents): Promise<void> {
    const mtype: string = message.type
    switch (mtype) {
      case 'system': {
        const sys = message
        const subtype: string = sys.subtype
        if (subtype === 'init') {
          webContents.send('claude:system', { localSessionId: lsid, sessionId: sys.session_id, model: sys.model, tools: sys.tools })
        } else if (subtype === 'permission_denied') {
          webContents.send('claude:notice', { ...mkNotice('permission_denied', `权限拒绝：${sys.tool_name}`, 'warn'), localSessionId: lsid })
        } else if (subtype === 'compact' || (subtype && subtype.startsWith('compact') && sys.compact_result === 'failed')) {
          webContents.send('claude:notice', { ...mkNotice('compact', `上下文压缩失败：${sys.compact_error ?? subtype}`, 'warn'), localSessionId: lsid })
        } else if (subtype === 'task_started') {
          // SDK 的 task_* 事件顶层 type 都是 'system'，靠 subtype 区分。
          // 此前误写成顶层 case，导致普通 Task 子任务卡片与 local_workflow 后台任务均无法识别。
          this.handleTaskStartedEvent(sys, lsid, webContents)
        } else if (subtype === 'task_updated') {
          this.handleTaskUpdatedEvent(sys, lsid, webContents)
        } else if (subtype === 'task_notification') {
          this.handleTaskNotificationEvent(sys, lsid, webContents)
        } else if (subtype === 'task_progress') {
          this.handleTaskProgressEvent(sys, lsid, webContents)
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
          // AskUserQuestion 由底部面板承载（见 assistant 分支拦截），不推 tool_use_start，
          // 否则它会先入 streaming blocks 渲染成卡片（assistant_blocks 的过滤此时已太晚）。
          // ExitPlanMode 同理：由计划卡片承载（见 assistant 分支），不推普通工具卡片。
          // TaskCreate/TaskUpdate 由悬浮面板 Task 卡片承载（见 handleTaskPlanTool），也不推普通卡片
          if (tb.name === 'AskUserQuestion' || tb.name === 'ExitPlanMode' || tb.name === 'TodoWrite'
            || tb.name === 'TaskCreate' || tb.name === 'TaskUpdate') {
            if (tb.name === 'TaskCreate' || tb.name === 'TaskUpdate') {
              this.handleTaskPlanTool(lsid, tb, webContents)
            }
            break
          }
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_use_start', block: { type: 'tool_use', id: tb.id, name: tb.name, input: tb.input, status: 'running' } })
          // 记录所有 tool_use 的 input，供 tool_result 阶段提取 auto-background 信息 / TaskCreate id
          if (tb.name === 'Bash' || tb.name === 'Task' || tb.name === 'TaskCreate') {
            this.toolUseInputs.set(tb.id, { name: tb.name, input: tb.input })
            // Task 工具创建的同步 subagent 不发 task_started 事件，这里主动登记，
            // 让它出现在悬浮面板（用 tool_use_id 作 task_id，幂等去重）。
            if (tb.name === 'Task') {
              this.registerSyncSubagent(lsid, tb, webContents)
            }
          }
        }
        break
      }
      case 'assistant': {
        const aContent = message.message?.content || []
        // subagent 自己产生的消息（SDKAssistantMessage 带 subagent_type）：
        // 不推主流 assistant_blocks，改推 claude:subagent-output，锚回触发它的 Task tool_use。
        if (message.subagent_type) {
          const parentToolUseId = message.parent_tool_use_id
          if (parentToolUseId) {
            webContents.send('claude:subagent-output', {
              localSessionId: lsid,
              toolUseId: parentToolUseId,
              subagentType: message.subagent_type,
              taskDescription: message.task_description,
              block: normalizeBetaBlocks(aContent),
            })
          }
          // subagent 消息不进主流 assistant_blocks（避免对话流重复/混乱），空 blocks 占位
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'assistant_blocks', blocks: [], uuid: message.uuid })
          break
        }
        // 先推送 assistant_blocks（文本/普通工具卡片）和 TodoWrite，
        // 再处理阻塞式交互（AskUserQuestion / ExitPlanMode）。
        // 顺序很重要：阻塞等待用户回答时，本轮的文本内容应已渲染到对话流。
        const todoBlocks = aContent.filter((ab: any) => ab?.type === 'tool_use' && ab.name === 'TodoWrite')
        for (const tb of todoBlocks) {
          const todos = Array.isArray(tb.input?.todos) ? tb.input.todos : []
          webContents.send('claude:task', { localSessionId: lsid, kind: 'todo_sync', todos })
        }
        const blocks = normalizeBetaBlocks(aContent)
          // 过滤掉由专属面板/卡片承载的 tool_use：AskUserQuestion / ExitPlanMode / TodoWrite，
          // 以及 TaskCreate / TaskUpdate（悬浮面板 Task 卡片承载，见 handleTaskPlanTool）
          .filter((b: any) => !(b.type === 'tool_use' && (
            b.name === 'AskUserQuestion' || b.name === 'ExitPlanMode' || b.name === 'TodoWrite'
            || b.name === 'TaskCreate' || b.name === 'TaskUpdate'
          )))
        // assistant 阶段 input 完整：拦截 TaskUpdate 推 claude:task；TaskCreate 仅记录 input
        // （真实 taskId 来自后续 tool_result，见 handleTaskCreateResult）。
        if (Array.isArray(aContent)) {
          for (const ab of aContent) {
            if (ab?.type === 'tool_use' && ab.name === 'TaskCreate') {
              this.toolUseInputs.set(ab.id, { name: ab.name, input: ab.input })
            } else if (ab?.type === 'tool_use' && ab.name === 'TaskUpdate') {
              this.handleTaskPlanTool(lsid, ab, webContents)
            }
          }
        }
        // assistant 消息含完整 tool_use input（stream_event 的 content_block_start 时 input 还是空壳，
        // 这里补全，供 user 阶段提取后台命令文本）
        if (Array.isArray(aContent)) {
          for (const ab of aContent) {
            if (ab?.type === 'tool_use' && (ab.name === 'Bash' || ab.name === 'Task')) {
              this.toolUseInputs.set(ab.id, { name: ab.name, input: ab.input })
              if (ab.name === 'Task') {
                this.registerSyncSubagent(lsid, ab, webContents)
              }
            }
          }
        }
        webContents.send('claude:blocks', { localSessionId: lsid, op: 'assistant_blocks', blocks, uuid: message.uuid })

        // 阻塞式交互：先推完本轮内容，再等待用户决策。
        // forwardEvent 是 async，runIterate 的 for-await 会 await 它，
        // SDK 事件循环在此暂停，不会在用户回答前继续执行后续步骤。
        if (Array.isArray(aContent)) {
          const askBlocks = aContent.filter((ab: any) => ab?.type === 'tool_use' && ab.name === 'AskUserQuestion')
          for (const ab of askBlocks) {
            await this.handleAskUserQuestion(lsid, ab, webContents)
          }
          // ExitPlanMode：计划模式下模型提交计划。阻塞式——必须等用户在计划卡片上
          // 选择授权模式后才继续，否则 SDK 自动回填 dummy tool_result 后会继续往下走（BUG）。
          const planBlocks = aContent.filter((ab: any) => ab?.type === 'tool_use' && ab.name === 'ExitPlanMode')
          for (const pb of planBlocks) {
            await this.handleExitPlanMode(lsid, pb, webContents)
          }
        }
        break
      }
      case 'user': {
        const results = extractToolResults(message.message?.content || [])
        for (const r of results) {
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_result', toolUseId: r.toolUseId, result: { content: r.content, isError: r.isError } })
          // 同步 Task subagent 收尾：tool_result 到达即表示该子代理执行结束。
          // 按 tool_use_id 找到 registry 里登记的记录,标记 completed/failed 并推送更新。
          if (this.registry && this.registry.isManaged(r.toolUseId)) {
            const finalStatus = r.isError ? 'failed' : 'completed'
            const t = this.registry.handleTaskNotification(lsid, { task_id: r.toolUseId, status: finalStatus })
            if (t) webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
          }
          // TaskCreate 的 tool_result：解析 "Task #N" 真实 id，发 started 让悬浮面板显示规划任务
          const tcInput = this.toolUseInputs.get(r.toolUseId)
          if (tcInput?.name === 'TaskCreate') {
            this.handleTaskCreateResult(lsid, r.toolUseId, contentToText(r.content), webContents)
          }
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
            const resultText = (typeof b.content === 'string' || Array.isArray(b.content)) ? contentToText(b.content) : ''
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
        // 用户主动 interrupt 导致的中断:SDK 会发 error_during_execution(result.is_error=true),
        // 但 terminal_reason 为 aborted_streaming/aborted_tools。这种情况不是真正的执行错误,
        // 不显示"任务出错"通知,让 STREAM_END 正常收尾(渲染端已通过 claude:aborted 清状态)。
        const abortedReasons = ['aborted_streaming', 'aborted_tools']
        const isUserAbort = r.is_error && abortedReasons.includes(r.terminal_reason)
        webContents.send('claude:result', {
          localSessionId: lsid,
          sessionId: r.session_id, subtype: r.subtype,
          isError: isUserAbort ? false : !!r.is_error,
          costUSD: r.total_cost_usd, durationMs: r.duration_ms, turns: r.num_turns,
        })
        if (r.is_error && !isUserAbort) {
          webContents.send('claude:notice', { ...mkNotice('error', `任务出错（${r.subtype}）`, 'error'), localSessionId: lsid })
        }
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
      // task_started/updated/notification 的顶层 type 实为 'system'（见 system 分支按 subtype 分发）；
      // 此处不再处理，避免重复与遗漏。
      case 'keep_alive':
      case 'worker_shutting_down':
      case 'commands_changed':
        break
      default:
        webContents.send('claude:notice', { ...mkNotice('info', `未分类事件：${message.type}`, 'info'), localSessionId: lsid })
    }
  }

  /**
   * 拦截 TaskCreate / TaskUpdate 工具调用，转发为 claude:task 事件，让悬浮面板 Task 卡片
   * 显示 Claude 规划的任务列表。
   *
   * 与 Task 工具（spawn 同步 subagent，走 registerSyncSubagent/BackendTask）不同：
   * TaskCreate/TaskUpdate 是模型规划任务的元工具，input 结构（真实 SDK 样本）：
   *   TaskCreate: { subject, description, activeForm }
   *   TaskUpdate: { taskId: string, status: 'in_progress'|'completed'|'failed'|... }
   * 前端 onTask 的 kind:'started'/'updated' 已支持，这里只需映射状态字符串。
   */
  private handleTaskPlanTool(
    lsid: string,
    tb: { id: string; name?: string; input?: any },
    webContents: WebContents,
  ): void {
    const input = tb.input || {}
    if (tb.name === 'TaskCreate') {
      // 不在此发 started：真实 taskId（TaskUpdate 引用的 id）来自 tool_result 文本
      // "Task #N created successfully"，assistant 阶段拿不到。仅记录，tool_result 阶段见 handleTaskCreateResult。
      return
    } else if (tb.name === 'TaskUpdate') {
      const rawStatus = typeof input.status === 'string' ? input.status : ''
      const mapped = rawStatus === 'in_progress' ? 'running'
        : rawStatus === 'completed' ? 'completed'
        : rawStatus === 'failed' ? 'failed'
        : rawStatus === 'pending' ? 'pending'
        : rawStatus
      webContents.send('claude:task', {
        localSessionId: lsid,
        kind: 'updated',
        taskId: String(input.taskId ?? tb.id),
        patch: { status: mapped },
      })
    }
  }

  /**
   * 处理 TaskCreate 的 tool_result：从 "Task #N created successfully: <desc>" 解析出真实 taskId，
   * 发 claude:task kind:started 让悬浮面板 Task 卡片显示该规划任务。
   *
   * TaskUpdate 的 input.taskId 引用的正是这里的 #N（数字 id），故必须用解析出的真实 id，
   * 而非 tool_use_id，否则 TaskUpdate 的状态更新会落空（id 对不上）。
   * 解析失败时用 tool_use_id 兜底，保证任务至少能显示。
   */
  private handleTaskCreateResult(
    lsid: string,
    toolUseId: string,
    resultText: string,
    webContents: WebContents,
  ): void {
    const toolUse = this.toolUseInputs.get(toolUseId)
    if (!toolUse || toolUse.name !== 'TaskCreate') return
    const input = toolUse.input || {}
    const subject = typeof input.subject === 'string' ? input.subject : ''
    const details = typeof input.description === 'string' ? input.description : ''
    const activeForm = typeof input.activeForm === 'string' ? input.activeForm : ''
    const description = subject || details || ''
    // 解析 "Task #N created successfully"（兼容中英文 SDK 输出）
    const m = /Task\s*#(\d+)/i.exec(resultText || '')
    const taskId = m ? m[1] : toolUseId
    webContents.send('claude:task', {
      localSessionId: lsid,
      kind: 'started',
      taskId,
      description,
      taskType: 'task',
      subject,
      details,
      activeForm,
      createdAt: Date.now(),
    })
  }

  /**
   * 登记同步 Task 工具创建的 subagent。
   * Claude 用 Task 工具创建的普通子代理是阻塞调用,SDK 不发 task_started 事件,
   * 这里在主流 Task tool_use 出现时主动登记,让它出现在悬浮面板。
   * 用 tool_use_id 作 task_id（与 task_started 的 task_id 命名空间不冲突,且幂等去重）。
   */
  private registerSyncSubagent(lsid: string, tb: { id: string; input?: any }, webContents: WebContents): void {
    if (!this.registry) return
    const input = tb.input || {}
    const description = typeof input.description === 'string' ? input.description : ''
    const prompt = typeof input.prompt === 'string' ? input.prompt : ''
    const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type
      : typeof input.subagentType === 'string' ? input.subagentType : 'general-purpose'
    const t = this.registry.handleTaskStarted(lsid, {
      task_id: tb.id,            // 用 tool_use_id 作 task_id,幂等且与 subagent-output/tool_result 锚定一致
      description: description || prompt || '(子代理)',
      prompt,
      task_type: 'subagent',
      subagent_type: subagentType,
      tool_use_id: tb.id,
    })
    if (t) {
      webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
    }
  }

  /** system.subtype='task_started'：委托 registry（内部 resolveKind 决定是否创建）。
   *  registry 返回 null（未知 task_type）时事件被丢弃——不回退到 claude:task，
   *  因为 task_started 只对长生命周期任务发出，无对应 kind 的属噪声。 */
  private handleTaskStartedEvent(tm: any, lsid: string, webContents: WebContents): void {
    if (!this.registry) return
    // 创建该 subagent 的原始 prompt：优先用主流 Task tool_use 的 input.prompt
    // (tool_use_id 锚定,最完整);task_started 事件的 prompt 兜底。
    let resolvedPrompt = tm.prompt ?? ''
    if (tm.tool_use_id) {
      const tui = this.toolUseInputs.get(tm.tool_use_id)
      const p = tui?.input?.prompt
      if (typeof p === 'string' && p.trim()) resolvedPrompt = p
    }
    const t = this.registry.handleTaskStarted(lsid, {
      task_id: tm.task_id,
      description: tm.description ?? '',
      prompt: resolvedPrompt,
      task_type: tm.task_type,
      subagent_type: tm.subagent_type,
      tool_use_id: tm.tool_use_id,
    })
    if (t) {
      webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
    }
  }

  /** system.subtype='task_updated'：已注册的后台任务走 registry，否则推普通 task patch。 */
  private handleTaskUpdatedEvent(tm: any, lsid: string, webContents: WebContents): void {
    this.delegateTaskEvent(tm, lsid, webContents,
      () => this.registry?.handleTaskUpdated(lsid, { task_id: tm.task_id, patch: tm.patch ?? {} }),
      { kind: 'updated', taskId: tm.task_id, patch: tm.patch ?? {} },
    )
  }

  /** system.subtype='task_notification'：按是否已注册分发终态。 */
  private handleTaskNotificationEvent(tm: any, lsid: string, webContents: WebContents): void {
    this.delegateTaskEvent(tm, lsid, webContents,
      () => this.registry?.handleTaskNotification(lsid, { task_id: tm.task_id, status: tm.status ?? 'completed' }),
      { kind: 'updated', taskId: tm.task_id, patch: { status: tm.status ?? 'completed' } },
    )
  }

  /** system.subtype='task_progress':已注册任务走 registry 刷新进度,否则丢弃。 */
  private handleTaskProgressEvent(tm: any, lsid: string, webContents: WebContents): void {
    this.delegateTaskEvent(tm, lsid, webContents,
      () => this.registry?.handleTaskProgress(lsid, {
        task_id: tm.task_id,
        description: tm.description ?? '',
        usage: tm.usage ?? { total_tokens: 0, tool_uses: 0, duration_ms: 0 },
        last_tool_name: tm.last_tool_name,
        summary: tm.summary,
      }),
      // task_progress 不回退 claude:task(进度只对已注册任务有意义)
      {},
    )
  }

  /**
   * task_updated / task_notification 的共用分发骨架：
   * 已注册（registry 管理）→ 调 registry handler 推 claude:backend-task(update)；否则推 claude:task。
   * started 因用 task_type 判定 + op:create 不同，不走此路径。
   */
  private delegateTaskEvent(
    tm: any, lsid: string, webContents: WebContents,
    registryHandler: () => BackendTask | null | undefined,
    fallbackPayload: Record<string, unknown>,
  ): void {
    if (this.registry?.isManaged(tm.task_id)) {
      const t = registryHandler()
      if (t) webContents.send('claude:backend-task', { localSessionId: lsid, op: 'update', task: t })
    } else {
      webContents.send('claude:task', { localSessionId: lsid, ...fallbackPayload })
    }
  }

  /**
   * 动态切换权限模式：把中文标签翻译成 SDK permissionMode，
   * 委托 SessionQueryManager 调 query.setPermissionMode（control request，实时生效）。
   * 用于「批准计划」后立即退出 plan 模式，让用户能编辑/新增文件。
   */
  async setPermissionMode(localSessionId: string, permissionLabel: string): Promise<void> {
    if (!this.manager) return
    const mode = getPermissionMode(permissionLabel)
    await this.manager.setPermissionMode(localSessionId, mode)
  }

  /**
   * 中断当前轮次（不杀进程，后台任务存活）。
   * 策略：先 query.interrupt()（优雅中断，发 control request 给 CLI）；
   * 若 2s 后 session 仍在迭代（工具执行中 interrupt 可能不立即生效），
   * 用 abortController.abort() 强制中止，确保停止按钮可靠生效。
   */
  async interrupt(localSessionId: string): Promise<void> {
    if (!this.manager) return
    await this.manager.interrupt(localSessionId)
    // interrupt 是 control request，CLI 可能正在执行工具无法立即响应。
    // 等待 2s 后检查：若仍在迭代，abort 强制中止。
    setTimeout(() => {
      if (this.manager?.isIterating(localSessionId)) {
        const ac = this.abortControllers.get(localSessionId)
        if (ac && !ac.signal.aborted) {
          console.warn('[claude] interrupt timeout, aborting query', localSessionId)
          ac.abort()
        }
      }
    }, 2000)
  }

  /** 关闭会话：关闭 controller + query.return()，删除 session。委托 manager.closeSession。 */
  closeSession(localSessionId: string): Promise<void> {
    this.abortControllers.delete(localSessionId)
    return this.manager?.closeSession(localSessionId) ?? Promise.resolve()
  }

  /** 停止单个后台任务。委托 manager.stopTask。 */
  stopTask(localSessionId: string, taskId: string): Promise<void> {
    return this.manager?.stopTask(localSessionId, taskId) ?? Promise.resolve()
  }

  /** 返回当前正在迭代的 session id 列表。渲染端刷新后据此重建 streaming 状态。 */
  runningSessionIds(): string[] {
    return this.manager?.runningSessionIds() ?? []
  }

  /** 刷新后重新绑定活跃 session 的事件回调到新 webContents。
   *  SDK query 刷新后仍存活,但 onEvent 闭包捕获的是旧(已销毁)webContents。
   *  这里用新 webContents 重建闭包,让续推的事件正确送达新窗口。 */
  reattachRunningSessions(webContents: WebContents): void {
    if (!this.manager) return
    const ids = this.manager.runningSessionIds()
    for (const lsid of ids) {
      const onEvent = (message: any) => this.forwardEvent(message, lsid, webContents)
      const onError = (err: unknown) => {
        webContents.send('claude:error', { localSessionId: lsid, error: String(err) })
      }
      this.manager.updateCallbacks(lsid, onEvent, onError)
    }
  }

  /**
   * /compact：生成历史摘要，压缩渲染端展示的消息（保留最近 N 条）。
   *
   * 重要语义：本方法压缩的是「渲染端展示的消息数组」，**不主动压缩 SDK 侧 context**——
   * SDK streaming-input 持久 query 的内部历史由 query options.settings.autoCompactEnabled
   * 控制（已显式开启）：context 接近满时 SDK 会自动真实摘要并替换内部历史。
   * 故 /compact 的真实价值是：让用户主动整理 UI（用摘要替代早期消息），便于阅读；
   * 真正的 token 压缩由 SDK autoCompact 负责。
   */
  async compactSession(localSessionId: string, webContents: WebContents): Promise<void> {
    const snap = getProjectsSnapshot()
    const session = findSession(snap.projects, localSessionId)
    if (!session) return
    if (session.messages.length <= 6) {
      webContents.send('claude:notice', { ...mkNotice('info', '消息较少，无需压缩', 'info'), localSessionId })
      return
    }
    const toSummarize = session.messages.slice(0, -6)
    const transcript = toSummarize.map((m: any) => `${m.role}: ${m.content.map((b: any) => b.text ?? '').join(' ')}`).join('\n')
    try {
      const summary = await this.runSideQuery(`请用 200 字以内总结以下对话历史的关键信息，用于上下文压缩：\n\n${transcript}`)
      if (!summary || !summary.trim()) {
        webContents.send('claude:notice', { ...mkNotice('error', '压缩失败：摘要为空', 'error'), localSessionId })
        return
      }
      webContents.send('claude:builtin-result', { localSessionId, op: 'compact', summary, keepRecent: 6 })
    } catch (err) {
      webContents.send('claude:notice', { ...mkNotice('error', `压缩失败：${String(err)}`, 'error'), localSessionId })
    }
  }

  /** /init：在 cwd 生成 CLAUDE.md，已存在问覆盖。 */
  async initProject(cwd: string, webContents: WebContents): Promise<void> {
    const target = join(cwd, 'CLAUDE.md')
    if (existsSync(target)) {
      const ok = await showOverwriteDialog(target)
      if (!ok) {
        webContents.send('claude:notice', { ...mkNotice('info', '已取消，未改动', 'info'), localSessionId: '' })
        return
      }
    }
    try {
      const content = await this.runSideQuery('分析当前项目并生成 CLAUDE.md：包含项目概述、技术栈、常用命令、代码结构。直接输出 markdown 内容，不要用代码块包裹。', cwd)
      await writeFile(target, content || '', 'utf-8')
      webContents.send('claude:notice', { ...mkNotice('info', `已生成 ${target}`, 'info'), localSessionId: '' })
    } catch (err) {
      webContents.send('claude:notice', { ...mkNotice('error', `生成失败：${String(err)}`, 'error'), localSessionId: '' })
    }
  }

  /** /export：导出会话为 markdown 文件。 */
  async exportSession(localSessionId: string, webContents: WebContents): Promise<void> {
    try {
      const snap = getProjectsSnapshot()
      const session = findSession(snap.projects, localSessionId)
      if (!session) return
      const md = session.messages.map((m: any) => {
        const role = m.role === 'user' ? '## 🧑 用户' : '## 🤖 助手'
        const body = m.content.map((b: any) => b.text ?? '').join('\n')
        return `${role}\n\n${body}`
      }).join('\n\n---\n\n')
      const path = await showSaveDialog(`session-${localSessionId}.md`, md)
      if (path) webContents.send('claude:notice', { ...mkNotice('info', `已导出至 ${path}`, 'info'), localSessionId })
    } catch (err) {
      webContents.send('claude:notice', { ...mkNotice('error', `导出失败：${String(err)}`, 'error'), localSessionId })
    }
  }

  /** /add-dir：校验目录并通知渲染端记录。 */
  async addDir(localSessionId: string, dir: string, webContents: WebContents): Promise<void> {
    if (!existsSync(dir)) {
      webContents.send('claude:notice', { ...mkNotice('error', `目录不存在：${dir}`, 'error'), localSessionId })
      return
    }
    webContents.send('claude:builtin-result', { localSessionId, op: 'add-dir', dir })
  }

  /** 旁路 query：跑一次性摘要/生成，不复用会话 manager。 */
  private async runSideQuery(prompt: string, cwd?: string): Promise<string> {
    const cfg = getModelProvidersConfig()
    const resolved = resolveActiveProviderModel(cfg)
    if (!resolved) throw new Error('请先在「设置 → 模型设置」中添加并启用供应商与模型')
    const result = query({
      prompt,
      options: {
        env: { ...process.env, ...buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models) },
        model: resolved?.model.sdkModelId,
        cwd,
        maxTurns: cwd ? 8 : 1,
        permissionMode: 'bypassPermissions',
      } as any,
    })
    let text = ''
    for await (const m of result) {
      if (m.type === 'assistant' && Array.isArray((m as any).message?.content)) {
        text = ((m as any).message.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('')
      }
    }
    return text
  }
}

function findSession(projects: any[], localSessionId: string): any | null {
  for (const p of projects) {
    const s = p.sessions.find((x: any) => x.id === localSessionId)
    if (s) return s
  }
  return null
}

async function showOverwriteDialog(target: string): Promise<boolean> {
  const { dialog } = await import('electron')
  const r = await dialog.showMessageBox({ type: 'question', buttons: ['覆盖', '取消'], defaultId: 1, message: `${target} 已存在，是否覆盖？` })
  return r.response === 0
}

async function showSaveDialog(defaultName: string, content: string): Promise<string | null> {
  const { dialog } = await import('electron')
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, content, 'utf-8')
  return r.filePath
}
