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
import { normalizeBetaBlocks, extractToolResults, extractBackgroundTaskId, extractPlanFilePath, contentToText, mkNotice } from './claude-normalize'
import { getPermissionMode } from './builtin-commands'
import { getSkills } from './claude-config'
import { resolveClaudeCodeExecutable } from './claude-sdk-executable'

// 「写/执行类」工具：default（变更前确认）权限模式下，这些工具调用需弹授权窗让用户批准。
// 只读工具（Read/Glob/Grep/LS/WebSearch/TodoWrite 等）直接放行，不打扰用户。
const CONFIRM_TOOLS = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Bash', 'Task', 'Skill',
])

// 裁剪 diff 给 LLM：保留每个文件的 diff --git 头 + hunk 头 + 前若干行，
// 超过 maxChars 则截断并标注。纯函数，单测覆盖（tests/commit-message.test.ts）。
export function trimDiffForPrompt(diff: string, maxChars: number): string {
  if (!diff.trim()) return ''
  if (diff.length <= maxChars) return diff
  // 按 diff --git 切文件块，尽量保留每个文件的开头
  const files = diff.split(/(?=^diff --git )/m)
  const kept: string[] = []
  let used = 0
  const reserve = 80   // 给截断标注留余量
  for (const f of files) {
    if (used + f.length <= maxChars - reserve) {
      kept.push(f)
      used += f.length
      continue
    }
    // 当前文件放不下：塞头部若干行
    const headLines = f.slice(0, Math.max(0, maxChars - reserve - used)).split('\n')
    kept.push(headLines.join('\n'))
    break
  }
  const fileCount = files.filter(Boolean).length
  return kept.join('').trimEnd() + `\n\n(diff 已截断，共 ${fileCount} 个文件)`
}

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
  // subagent 内部 tool_use_id → 触发它的 Task tool_use_id（parent）。
  // subagent 的 tool_use 在 claude:subagent-output 发出（不进主流），但其 tool_result 在
  // user 消息里（无 subagent_type）。靠此映射把工具结果回填进 subagent 抽屉（问题3）。
  private subagentToolUseParent = new Map<string, string>()
  // Pending onUserDialog resolvers keyed by reqId。渲染端经 claude:dialog-response 回答。
  private dialogResolvers = new Map<string, (r: any) => void>()
  // 每个 session 的 dialog 串行链：保证同一 session 一次只弹一个 dialog（AskUserQuestion /
  // 权限授权等）。pendingDialog 是渲染端单值，并发 dialog-request 会互相覆盖。askUserViaPanel
  // 入口 await 前一个 dialog 完成再发新的，FIFO 串行。key 为 localSessionId。
  private dialogChain = new Map<string, Promise<unknown>>()
  // 每个 session 的 AbortController:创建 query 时传入,interrupt 不生效时 abort() 兜底强制中止。
  private abortControllers = new Map<string, AbortController>()
  // 每个 session 已处理过的「阻塞式 tool_use」id 集合（AskUserQuestion / ExitPlanMode）。
  // SDK 在 includePartialMessages / resume 场景会重放同一 assistant 消息，若不按 tool_use.id
  // 去重，同一个问题会被弹多次、pushMessage 多条答案回 SDK。id 全局唯一故可安全去重。
  // 不主动清理：localSessionId 为 uuid 不会复用，单会话内阻塞式提问数量极少，
  // 集合体量可忽略，强清理反而要在会话销毁链路（manager.closeSession）穿针引线、收益不抵风险。
  private handledBlockingToolUse = new Map<string, Set<string>>()

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

  /** 该 lsid 的某个阻塞式 tool_use 是否已处理过（防 SDK 重放导致重复弹窗）。 */
  private isBlockingHandled(lsid: string, toolUseId: string): boolean {
    return this.handledBlockingToolUse.get(lsid)?.has(toolUseId) ?? false
  }

  /** 标记该 lsid 的某个阻塞式 tool_use 已处理。 */
  private markBlockingHandled(lsid: string, toolUseId: string): void {
    let set = this.handledBlockingToolUse.get(lsid)
    if (!set) {
      set = new Set<string>()
      this.handledBlockingToolUse.set(lsid, set)
    }
    set.add(toolUseId)
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
    // 串行锁：同一 session 的 dialog FIFO 排队，避免并发 dialog-request 互相覆盖
    // （渲染端 pendingDialog 是单值）。等前一个 dialog 完成再发新的。
    const chainKey = localSessionId ?? ''
    const prev = this.dialogChain.get(chainKey) ?? Promise.resolve()
    let releaseChain!: () => void
    const myTurn = prev.then(() => new Promise<void>(r => { releaseChain = r }))
    this.dialogChain.set(chainKey, myTurn)
    await prev

    const reqId = `dlg${Date.now()}_${Math.floor(performance.now())}`
    webContents.send('claude:dialog-request', {
      reqId,
      localSessionId: localSessionId ?? undefined,
      dialogKind,
      payload,
      toolUseId,
    })
    try {
      return await new Promise<any>((resolve) => {
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
    } finally {
      // 释放串行锁，让下一个排队 dialog 开始
      releaseChain()
    }
  }

  /**
   * canUseTool 回调的授权弹窗逻辑：default（变更前确认）模式下，对写/执行类工具
   * 弹底部面板让用户批准/拒绝；其余情况直接 allow。
   * 经第三方代理时 SDK 不发 control_request/permission_denied，但会调用 canUseTool
   * （进程内 JS 回调），故这是 default 模式下唯一可靠的逐次授权途径。
   * 返回 SDK 的 PermissionResult：allow / deny。
   */
  private async handlePermissionRequest(
    localSessionId: string,
    permissionLabel: string,
    toolName: string,
    input: Record<string, unknown>,
    opts: { signal?: AbortSignal; toolUseID?: string; displayName?: string; description?: string; decisionReason?: string; title?: string; suggestions?: any[] },
    webContents: WebContents,
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: any[]; toolUseID?: string } | { behavior: 'deny'; message: string; toolUseID?: string }> {
    // allow 结果需带 updatedInput（原样回传 input 表示不修改）：SDK 运行时 zod 校验
    // 要求 allow 分支的 updatedInput 为 record（与 sdk.d.ts 标注的可选不一致，CLI 侧校验更严），
    // 缺失会报 ZodError「expected record, received undefined」导致工具执行失败。
    // autoAllow=true 时附带 updatedPermissions（SDK 的 suggestions 原样回传）→ SDK 自动把规则
    // 持久化到 settings.json（按 suggestions 的 destination：user/project/local），后续同类操作
    // SDK 自行匹配放行。这是 claude cli 原生的「自动允许」机制，cc-desk 不自己维护规则集。
    const allow = (updatedPermissions?: any[]): { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: any[]; toolUseID?: string } =>
      ({ behavior: 'allow', updatedInput: input, ...(updatedPermissions ? { updatedPermissions } : {}), toolUseID: opts.toolUseID })
    // ★ 硬阻塞核心：AskUserQuestion / ExitPlanMode 在 canUseTool 内部 await 用户作答，
    // 全程阻塞 CLI（canUseTool 不返回 CLI 就不动）。不返回 allow——allow 会让 CLI 执行
    // AskUserQuestion 工具，合成 dummy tool_result（"The user did not answer the questions."）
    // 污染对话历史，导致模型据此继续往下跑（用户没操作就续跑的根因）。
    // 改为返回 deny，deny 的 message 作为 tool_result 返给模型——我们把【用户真实答案】
    // 填进 deny.message，让模型看到真实答案而非 dummy。CLI 全程不执行工具、不合成 dummy。
    if (toolName === 'AskUserQuestion') {
      const questions: any[] = Array.isArray(input.questions) ? input.questions : []
      let result: any
      try {
        result = await this.askUserViaPanel(webContents, 'ask_user_question', input, opts.toolUseID, undefined, localSessionId)
      } catch {
        result = { behavior: 'cancelled' }
      }
      // 格式化真实答案为文本，作为 deny 的 message（= tool_result）返给模型
      const lines: string[] = []
      if (result?.behavior === 'completed') {
        const answers: any[] = result?.result?.answers ?? []
        questions.forEach((q, qi) => {
          const ans = answers.find((a) => a.questionIndex === qi)
          const label = q.question || `问题 ${qi + 1}`
          if (!ans) { lines.push(`${label}：（未回答）`); return }
          if (ans.other !== undefined) {
            lines.push(`${label}：${ans.other}`)
          } else if (ans.selected) {
            const sel = ans.selected
            const text = Array.isArray(sel)
              ? sel.map((s: any) => s?.label ?? s).join('、')
              : (sel?.label ?? String(sel))
            lines.push(`${label}：${text}`)
          }
        })
      }
      const answerText = result?.behavior === 'completed'
        ? `【用户已正式回答你的 AskUserQuestion，以下是用户的真实选择，请以此为准，忽略此前的任何占位/工具返回（如 "Answer questions?"）】\n${lines.join('\n')}`
        : '（用户取消了这次提问）'
      return { behavior: 'deny', message: answerText, toolUseID: opts.toolUseID }
    }
    if (toolName === 'ExitPlanMode') {
      const plan = typeof input.plan === 'string' ? input.plan : ''
      const allowedPrompts = Array.isArray(input.allowedPrompts) ? input.allowedPrompts : undefined
      let result: any
      try {
        result = await this.askUserViaPanel(webContents, 'plan_proposed', { plan, allowedPrompts }, opts.toolUseID, undefined, localSessionId)
      } catch {
        result = { behavior: 'cancelled' }
      }
      if (result?.behavior === 'completed' && result?.result?.permissionMode) {
        // 用户批准计划并选定授权模式：SDK 端实时切换权限（退出 plan 模式）
        await this.setPermissionMode(localSessionId, result.result.permissionMode)
        return { behavior: 'deny', message: '（用户已批准计划，开始执行）', toolUseID: opts.toolUseID }
      }
      return { behavior: 'deny', message: '（用户未批准计划，请根据反馈修改计划）', toolUseID: opts.toolUseID }
    }
    // 非 default 模式（自动编辑/完全访问/计划）或只读工具：直接放行
    if (permissionLabel !== '变更前确认' || !CONFIRM_TOOLS.has(toolName)) {
      return allow()
    }
    const payload = {
      toolName,
      displayName: opts.displayName ?? opts.title ?? toolName,
      description: opts.description,
      decisionReason: opts.decisionReason,
      // input 摘要：Write/Edit 的 file_path、Bash 的 command 等，截断显示
      input,
    }
    let result: any
    try {
      // 注意 signal 传 undefined：canUseTool 的 AbortSignal 是 SDK 的 query signal，
      // 它在工具等待期间可能因 SDK 内部超时/竞态提前 abort，导致 askUserViaPanel
      // resolve 成 cancelled → 误判为拒绝（用户明明点了批准却 deny）。
      // 权限授权应一直等用户决定，不被 SDK signal 打断；会话中断由 interrupt 单独处理。
      result = await this.askUserViaPanel(webContents, 'permission_request', payload, opts.toolUseID, undefined, localSessionId)
    } catch {
      result = { behavior: 'cancelled' }
    }
    if (result?.behavior === 'completed') {
      // 「自动允许此类」：把 SDK 的 suggestions 原样回传，SDK 据此写盘并后续自动匹配
      if (result?.autoAllow && Array.isArray(opts.suggestions) && opts.suggestions.length > 0) {
        return allow(opts.suggestions)
      }
      // 「本次批准」：仅本次放行，不持久化
      return allow()
    }
    return { behavior: 'deny', message: '用户拒绝了此操作', toolUseID: opts.toolUseID }
  }

  async send(opts: {
    prompt: string
    sessionId?: string
    localSessionId?: string
    cwd?: string
    permission?: string        // 中文标签，主进程翻译
    thinking?: 'low' | 'medium' | 'high'
    modelId?: string           // 远程切换模型：覆盖 cc-desk-store 的 activeModelId（不传则用默认）
    extraDirs?: string[]
    images?: { mediaType: string; data: string; name?: string }[]  // 用户附加的图片（data 为纯 base64）
    webContents: WebContents
  }): Promise<void> {
    const { prompt, sessionId, localSessionId, cwd, permission, thinking, modelId, extraDirs, images, webContents } = opts
    console.log(`[diag][send] ENTER: lsid=${localSessionId} prompt="${String(prompt).slice(0, 60)}" images=${images?.length ?? 0}`)
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
    const active = this.resolveActiveModel()
    if (!active) {
      webContents.send('claude:error', { localSessionId: lsid, error: '请先在「设置 → 模型设置」中添加并启用供应商与模型' })
      return
    }
    const { sdkEnv, executable: claudeCodeExecutable, modelId: defaultModelId } = active
    // 注：手机端切换模型走 session.setActiveModel（改 cc-desk-store 的 activeModelId），
    // send 时 resolveActiveModel 会读最新的 activeModelId，从而 sdkEnv（apiKey/baseUrl）+
    // modelId 一起用新 provider 的，三者一致。故 send 不再接受 modelId 参数覆盖——
    // 单独覆盖 model 会导致 model 名与 sdkEnv（apiKey/baseUrl）来自不同 provider 的不一致。
    if (process.env.CC_REMOTE_DEBUG !== '0') {
      console.warn('[claude] send with model:', defaultModelId)
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
    //
    // 【竞态防护】用户点击「停止并立即发送」时，interrupt() 发送 control request 后
    // 200ms 即调用 send()。此时旧循环可能仍在跑（isIterating=true），若复用旧 session
    // 则新消息推入旧 controller，但 interrupt() 的 2s 超时后会 ac.abort()，导致
    // AbortError → controller.close() + sessions.delete()，正在执行的新 task 被中断。
    // 故：isIterating 时先 closeSession 强制结束旧循环，再 ensureSession 重建。
    const wasIterating = this.manager?.isIterating(lsid)
    if (wasIterating) {
      console.log(`[diag][send] isIterating=true → closeSession then rebuild`)
      await this.manager.closeSession(lsid)
    }
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
          pathToClaudeCodeExecutable: claudeCodeExecutable,
          // env REPLACES process.env，故先铺底再覆盖。注入激活供应商的 apiKey/baseUrl
          // 与各角色模型映射（来自 ~/.cc-desk/config.json）。
          env: { ...process.env, ...proxyEnv, ...sdkEnv },
          model: defaultModelId,
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
          // 不自定义 systemPrompt：改用 SDK 默认 preset。
          // 原先用 systemPrompt.append 强制输出语言（settings.language 对经代理的非
          // Anthropic 模型常被忽略），但 systemPrompt append 会改变 prefix，第三方代理
          // 下影响 KV Cache 命中。语言约束退回下面的 settings.language 兜底。
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
          // canUseTool：default（变更前确认）模式下对写/执行类工具弹授权窗，其余 allow。
          // 经第三方代理时 SDK 不发 control_request，但会调用此回调（已用日志证实），
          // 故这是 default 模式逐次授权的唯一可靠途径。阻塞等用户决定后返回 PermissionResult。
          canUseTool: async (toolName: string, input: Record<string, unknown>, opts: any) => {
            return this.handlePermissionRequest(lsid, permission ?? '', toolName, input, opts, webContents)
          },
          // ★ 硬阻塞核心：PreToolUse hook 对 AskUserQuestion/ExitPlanMode 返回 permissionDecision:'ask'，
          // 让 CLI 子进程在【执行工具之前】硬停（发 can_use_tool 控制请求等宿主回复）。
          // canUseTool（handlePermissionRequest）对这两个工具 await 用户作答后返回 deny(真实答案)——
          // deny 让 CLI 不执行工具（不合成 dummy tool_result），deny.message 作为 tool_result 返给模型，
          // 模型看到的是真实答案而非 "did not answer"。根治「用户没操作就继续往下执行」。
          hooks: {
            PreToolUse: [{
              matcher: 'AskUserQuestion|ExitPlanMode',
              hooks: [async () => ({
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'ask' as const,
                },
              })],
            }],
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

    console.log(`[diag][send] calling pushMessage: lsid=${lsid} sessionExisted=${sessionExisted} wasIterating=${!!wasIterating} sessions.has=${this.manager.sessions.has(lsid)}`)
    this.manager.pushMessage(lsid, prompt, images)
    console.log(`[diag][send] pushMessage done`)
  }

  // SDK message → IPC 转发。逻辑与原 claude-service 的 for-await case 一致。
  private async forwardEvent(message: any, lsid: string, webContents: WebContents): Promise<void> {
    const mtype: string = message.type
    // 调试：确认 forwardEvent 被调用且对 webContents 做 delta 事件发送
    if (process.env.CC_REMOTE_DEBUG !== '0') {
      console.warn('[claude-fwd]', mtype, '→ wc.send(claude:', mtype === 'stream_event' ? message.event?.type || '?' : mtype, ')')
    }
    // AskUserQuestion/ExitPlanMode 的用户交互由 PreToolUse hook→canUseTool 硬阻塞处理，
    // forwardEvent 不再本地拦截、不再需要门控（旧 isAskGated 已随硬阻塞重构移除）。
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
        } else if (subtype === 'compact_boundary') {
          // 压缩完成：SDK 真实摘要了历史并替换内部上下文（区别于 cc-desk 手写 /compact 只压缩 UI）。
          // compact_metadata 带 pre_tokens/post_tokens/duration_ms/trigger(manual|auto)。
          // 告知用户压缩发生，并联动上下文进度环刷新（渲染端 onNotice 后可主动拉 context-usage）。
          const meta = sys.compact_metadata || {}
          const pre = typeof meta.pre_tokens === 'number' ? meta.pre_tokens : null
          const post = typeof meta.post_tokens === 'number' ? meta.post_tokens : null
          const trigger = meta.trigger === 'manual' ? '手动' : '自动'
          const tokenPart = (pre != null || post != null) ? `：${pre ?? '?'} → ${post ?? '?'} tokens` : ''
          webContents.send('claude:notice', { ...mkNotice('compact', `已${trigger}压缩上下文${tokenPart}`, 'info'), localSessionId: lsid })
        } else if (subtype === 'status' && sys.status === 'compacting') {
          // 压缩进行中：SDK 正在摘要历史。用户此前反馈不知道何时压缩，故改为可见提示。
          webContents.send('claude:notice', { ...mkNotice('compact', '正在压缩上下文…', 'info'), localSessionId: lsid })
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
        } else if (subtype === 'notification') {
          webContents.send('claude:notification', {
            localSessionId: lsid,
            text: sys.text || '',
            priority: sys.priority || 'medium',
          })
        }
        // 其余 system 子类型（status 的非 compacting 态、hook 协议进度等）属内部噪声，不打扰用户。
        break
      }
      case 'stream_event': {
        const evt = message.event
        if (evt?.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'text', delta: evt.delta.text })
          else if (evt.delta?.type === 'thinking_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'thinking', delta: evt.delta.thinking })
        } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          const tb = evt.content_block
          // AskUserQuestion / TodoWrite 由专属面板承载，不推主流 tool_use_start（否则会先入
          // streaming blocks 渲染成卡片，assistant_blocks 的过滤此时已太晚）。
          // AskUserQuestion/ExitPlanMode 的用户交互由 PreToolUse hook→canUseTool 硬阻塞处理
          // （见 handlePermissionRequest），不走 forwardEvent 本地拦截。
          // TaskCreate/TaskUpdate 做特殊处理（发 claude:task 驱动悬浮面板），又推进主流
          // tool_use_start，让对话流用 MetaToolCard 卡片完整记录这些规划类操作。
          if (tb.name === 'AskUserQuestion' || tb.name === 'TodoWrite') {
            break
          }
          if (tb.name === 'TaskCreate' || tb.name === 'TaskUpdate') {
            this.handleTaskPlanTool(lsid, tb, webContents)
          }
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_use_start', block: { type: 'tool_use', id: tb.id, name: tb.name, input: tb.input, status: 'running' } })
          // 记录所有 tool_use 的 input，供 tool_result 阶段提取 auto-background 信息 / TaskCreate id / ExitPlanMode filePath
          if (tb.name === 'Bash' || tb.name === 'Task' || tb.name === 'TaskCreate' || tb.name === 'ExitPlanMode' || tb.name === 'TaskList') {
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
            const nblocks = normalizeBetaBlocks(aContent)
            // 记录本轮 subagent 的 tool_use id → parent，供后续 user 阶段 tool_result 回填。
            for (const nb of nblocks) {
              if (nb.type === 'tool_use' && typeof nb.id === 'string') {
                this.subagentToolUseParent.set(nb.id, parentToolUseId)
              }
            }
            webContents.send('claude:subagent-output', {
              localSessionId: lsid,
              toolUseId: parentToolUseId,
              subagentType: message.subagent_type,
              taskDescription: message.task_description,
              block: nblocks,
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
        // 注意：TaskList 是查询操作（tool_result 返回 tasks 列表），不是清空。
        // 其任务同步在 user 阶段从 tool_result 解析（见 handleTaskListResult），不在此处理。
        const blocks = normalizeBetaBlocks(aContent)
          // 过滤由专属面板承载的 tool_use：AskUserQuestion（底部内联面板，由 canUseTool 弹窗）。
          // ExitPlanMode 保留进对话流由 PlanCard 渲染（计划卡片）。
          .filter((b: any) => !(b.type === 'tool_use' && b.name === 'AskUserQuestion'))
        // assistant 阶段 input 完整：拦截 TaskUpdate 推 claude:task；TaskCreate 仅记录 input
        // （真实 taskId 来自后续 tool_result，见 handleTaskCreateResult）。
        if (Array.isArray(aContent)) {
          for (const ab of aContent) {
            if (ab?.type === 'tool_use' && ab.name === 'TaskCreate') {
              this.toolUseInputs.set(ab.id, { name: ab.name, input: ab.input })
            } else if (ab?.type === 'tool_use' && ab.name === 'TaskUpdate') {
              this.handleTaskPlanTool(lsid, ab, webContents)
            } else if (ab?.type === 'tool_use' && ab.name === 'TaskList') {
              this.toolUseInputs.set(ab.id, { name: ab.name, input: ab.input })
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

        // AskUserQuestion / ExitPlanMode 的用户作答已由 canUseTool 统一处理（PreToolUse hook
        // 返回 'ask' → CLI 发 can_use_tool → handlePermissionRequest 在 canUseTool 内 await 弹窗
        // → 返回 deny(真实答案) 作为 tool_result）。CLI 全程阻塞，不合成 dummy。
        // 此处不再本地拦截——否则会与 canUseTool 并发弹两次同一问题。
        break
      }
      case 'user': {
        const results = extractToolResults(message.message?.content || [])
        for (const r of results) {
          // subagent 内部工具的结果：回填进对应 subagent 的输出（抽屉可见），
          // 不推主流 tool_result（subagent 工具不在主流 blocks，推了也找不到归属）。
          const subParent = this.subagentToolUseParent.get(r.toolUseId)
          if (subParent) {
            webContents.send('claude:subagent-output', {
              localSessionId: lsid,
              toolUseId: subParent,
              block: { type: 'tool_result', toolUseId: r.toolUseId, content: r.content, isError: r.isError },
            })
            this.subagentToolUseParent.delete(r.toolUseId)
            continue
          }
          // ExitPlanMode 的 tool_result：提取 plan 文档磁盘路径（ExitPlanModeOutput.filePath），
          // 附带在 tool_result 推送里。渲染端据此把 filePath 回填到计划卡片，
          // 提供「查看计划」持久入口（抽屉读取真实文件渲染）。
          const tcInput2 = this.toolUseInputs.get(r.toolUseId)
          let planFilePath: string | undefined
          if (tcInput2?.name === 'ExitPlanMode') {
            const rawBlocks = message.message?.content || []
            const rawBlock = Array.isArray(rawBlocks) ? rawBlocks.find((b: any) => b?.type === 'tool_result' && b.tool_use_id === r.toolUseId) : undefined
            planFilePath = extractPlanFilePath(rawBlock)
          }
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_result', toolUseId: r.toolUseId, result: { content: r.content, isError: r.isError }, planFilePath })
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
          } else if (tcInput?.name === 'TaskList') {
            // TaskList 的 tool_result：解析 tasks 列表（TaskListOutput.tasks），同步给悬浮面板。
            // 查询结果反映当前真实任务状态，用 todo_sync 整体替换（与 TodoWrite 同通道）。
            const tlRawBlocks = message.message?.content || []
            const tlRawBlock = Array.isArray(tlRawBlocks) ? tlRawBlocks.find((b: any) => b?.type === 'tool_result' && b.tool_use_id === r.toolUseId) : undefined
            this.handleTaskListResult(lsid, r.toolUseId, tlRawBlock, webContents)
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
        // 在 for-await 循环退出前（本 forwardEvent 仍 await 中、control 通道仍活着）查询本轮
        // 真实上下文用量并推给渲染端缓存。这是拿到准确 usage 的唯一可靠时机——循环退出后
        // control 命令不可用（SDK 限制），切回存量会话也无法重查。故每轮结束都缓存最后一次值。
        // 用户主动 interrupt 跳过（上下文未稳定，查到的值无意义）。
        if (!isUserAbort) {
          try {
            const usage = await this.manager?.getContextUsage(lsid)
            if (usage) webContents.send('claude:context-usage', { localSessionId: lsid, usage })
          } catch { /* control 查询失败不阻塞收尾 */ }
        }
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
   * 处理 TaskList 的 tool_result：从 TaskListOutput.tasks 解析当前任务列表，
   * 整体同步给悬浮面板（todo_sync）。TaskList 是查询操作，返回 SDK 当前所有任务的真实状态。
   *
   * TaskListOutput.tasks 结构：{ id, subject, status: 'pending'|'in_progress'|'completed', owner?, blockedBy }
   * tool_result 里可能在 structuredContent.tasks / content 对象.tasks / content JSON 文本。
   */
  private handleTaskListResult(
    lsid: string,
    toolUseId: string,
    rawContent: any,
    webContents: WebContents,
  ): void {
    // 从多个位置提取 tasks 数组
    let tasks: any[] | undefined
    // 1) structuredContent.tasks
    const sc = (rawContent as any)?.structuredContent
    if (sc && typeof sc === 'object' && Array.isArray(sc.tasks)) tasks = sc.tasks
    // 2) toolUseResult.tasks（真实 SDK 主路径）
    const tur = (rawContent as any)?.toolUseResult
    if (!tasks && tur && typeof tur === 'object' && Array.isArray(tur.tasks)) tasks = tur.tasks
    // 3) content 对象
    const c = (rawContent as any)?.content
    if (!tasks && c && typeof c === 'object' && !Array.isArray(c) && Array.isArray(c.tasks)) tasks = c.tasks
    // 4) content 文本解析 JSON
    if (!tasks) {
      const text = (typeof c === 'string' || Array.isArray(c)) ? contentToText(c) : ''
      // 文本可能是纯 JSON：{"tasks":[...]}，或包含 "tasks" 字段
      try {
        const parsed = JSON.parse(text)
        if (parsed && Array.isArray(parsed.tasks)) tasks = parsed.tasks
      } catch {
        const m = text.match(/"tasks"\s*:\s*(\[[\s\S]*?\])/)
        if (m) {
          try { tasks = JSON.parse(m[1]) } catch { /* 忽略 */ }
        }
      }
    }
    if (!Array.isArray(tasks)) return
    // 映射成 todo_sync 格式（与 TodoWrite 同通道），整体替换悬浮面板任务列表
    const todos = tasks.map((t: any) => ({
      id: typeof t.id === 'string' || typeof t.id === 'number' ? String(t.id) : undefined,
      content: typeof t.subject === 'string' ? t.subject : '',
      status: t.status === 'completed' ? 'completed'
        : t.status === 'in_progress' ? 'in_progress'
        : 'pending',
    }))
    webContents.send('claude:task', { localSessionId: lsid, kind: 'todo_sync', todos })
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
   * 中断当前轮次，并终止所有正在运行的 task/subagent。
   * 策略：①先逐个 stopTask 杀掉 registry 中 running 状态的子任务；
   *       ②再 query.interrupt()（优雅中断当前轮次）；
   *       ③若 2s 后 session 仍在迭代，abortController.abort() 强制中止。
   */
  async interrupt(localSessionId: string, webContents?: import('electron').WebContents): Promise<void> {
    if (!this.manager) return
    // 先终止所有正在运行的 task/subagent（彻底停止，释放子进程资源）
    if (this.registry) {
      const running = this.registry.listBySession(localSessionId)
        .filter(t => t.status === 'running')
      for (const task of running) {
        try { await this.manager.stopTask(localSessionId, task.id) } catch { /* ignore */ }
        // 同步标记 registry 状态为 stopped，并推送更新让 UI 立即反馈
        const t = this.registry.handleTaskNotification(localSessionId, { task_id: task.id, status: 'stopped' })
        if (t && webContents) webContents.send('claude:backend-task', { localSessionId, op: 'update', task: t })
      }
    }
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

  /** 查询当前会话上下文用量，供输入框进度环展示。委托 manager.getContextUsage。 */
  async getContextUsage(localSessionId: string): Promise<any> {
    if (!this.manager) return null
    return this.manager.getContextUsage(localSessionId)
  }

  /** 关闭会话：关闭 controller + query.return()，删除 session。委托 manager.closeSession。 */
  closeSession(localSessionId: string): Promise<void> {
    this.abortControllers.delete(localSessionId)
    this.dialogChain.delete(localSessionId)
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

  /** /init：在 cwd 生成 CLAUDE.md，已存在则直接覆盖重新生成（不弹确认）。 */
  async initProject(cwd: string, webContents: WebContents): Promise<void> {
    const target = join(cwd, 'CLAUDE.md')
    const existed = existsSync(target)
    try {
      const content = await this.runSideQuery('分析当前项目并生成 CLAUDE.md：包含项目概述、技术栈、常用命令、代码结构。直接输出 markdown 内容，不要用代码块包裹。', cwd)
      await writeFile(target, content || '', 'utf-8')
      webContents.send('claude:notice', { ...mkNotice('info', existed ? `已覆盖重新生成 ${target}` : `已生成 ${target}`, 'info'), localSessionId: '' })
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

  /**
   * 解析激活的供应商+模型，构造 SDK query 共用的基础选项（executable / env base / model id）。
   * send() 与 runSideQuery() 都走这里，避免两处分别 fetch cfg + resolve + buildSdkEnv 导致漂移
   * （改一处忘改另一处时，/compact /init 会用与主会话不同的供应商/模型）。
   * 返回 null 表示未配置可用供应商；调用方各自给本地化错误提示。
   */
  private resolveActiveModel(): {
    resolved: NonNullable<ReturnType<typeof resolveActiveProviderModel>>
    sdkEnv: Record<string, string>
    executable: string | undefined
    modelId: string
  } | null {
    const cfg = getModelProvidersConfig()
    const resolved = resolveActiveProviderModel(cfg)
    if (!resolved) return null
    return {
      resolved,
      sdkEnv: buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models),
      executable: resolveClaudeCodeExecutable(),
      modelId: resolved.model.sdkModelId,
    }
  }

  /** 旁路 query：跑一次性摘要/生成，不复用会话 manager。 */
  private async runSideQuery(prompt: string, cwd?: string): Promise<string> {
    const active = this.resolveActiveModel()
    if (!active) throw new Error('请先在「设置 → 模型设置」中添加并启用供应商与模型')
    const { sdkEnv, executable, modelId } = active
    const result = query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: executable,
        env: { ...process.env, ...sdkEnv },
        model: modelId,
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

  /** 审查 tab：AI 生成 Conventional Commits 格式 commit message（基于 git diff HEAD）。
   *  走 runSideQuery（独立通路、复用激活模型、不进会话历史、不污染对话流）。
   *  无改动或无 provider 配置返回 null，调用方回退让用户手填。 */
  async generateCommitMessage(cwd: string): Promise<string | null> {
    const gitSvc = await import('./git-service')
    const diffText = await gitSvc.diff(cwd, 'HEAD')
    if (!diffText.trim()) return null
    const trimmed = trimDiffForPrompt(diffText, 8000)
    const prompt = `你是 commit message 生成器。根据以下 git diff 生成一条 Conventional Commits 格式的提交信息。
要求：只输出一行，格式为 "<type>(<scope>): <subject>"，type 从 feat/fix/chore/docs/refactor/test/perf 中选最贴切的，scope 用受影响的主要模块。不要解释、不要代码块、不要引号。

git diff:
${trimmed}`
    try {
      const result = await this.runSideQuery(prompt)
      const cleaned = result?.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim()
      return cleaned || null
    } catch {
      return null   // AI 失败不阻塞 commit 流程
    }
  }
}

function findSession(projects: any[], localSessionId: string): any | null {
  for (const p of projects) {
    const s = p.sessions.find((x: any) => x.id === localSessionId)
    if (s) return s
  }
  return null
}

async function showSaveDialog(defaultName: string, content: string): Promise<string | null> {
  const { dialog } = await import('electron')
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, content, 'utf-8')
  return r.filePath
}
