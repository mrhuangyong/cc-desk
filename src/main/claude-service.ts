// src/main/claude-service.ts
import { query, AbortError } from '@anthropic-ai/claude-agent-sdk'
import type { WebContents } from 'electron'
import { getSettings } from './settings-store'
import { getModelProvidersConfig, resolveActiveProviderModel, buildSdkEnv } from './cc-desk-store'
import { getGeneralConfig } from './claude-config'
import { normalizeBetaBlocks, extractToolResults, mkNotice } from './claude-normalize'

/**
 * ClaudeService wraps the Claude Agent SDK `query()` into a renderer-facing
 * streaming interface. Results are pushed to `webContents` via IPC channels:
 *   - 'claude:system'         session init (sessionId / model / tools) + status/notice
 *   - 'claude:delta'          incremental text/thinking token (streaming)
 *   - 'claude:blocks'         tool_use_start / assistant_blocks / tool_result
 *   - 'claude:notice'         system notices (status/permission/compact/task/...)
 *   - 'claude:result'         terminal result (cost / turns / subtype)
 *   - 'claude:aborted'        aborted by user
 *   - 'claude:error'          any other failure
 *
 * Notes on the SDK (v0.3.178):
 *  - The API key is supplied to the spawned CLI subprocess via the `env`
 *    option (`ANTHROPIC_API_KEY`). There is no top-level `apiKey` option.
 *  - Streaming deltas are surfaced as `stream_event` messages emitted only
 *    when `includePartialMessages` is enabled; there is no `onTextDelta`
 *    callback. We forward `content_block_delta` text deltas here.
 */
export class ClaudeService {
  private abortController: AbortController | null = null
  // Pending onUserDialog resolvers keyed by reqId. The renderer answers via
  // the `claude:dialog-response` IPC handler -> resolveDialog().
  private dialogResolvers = new Map<string, (r: { behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }) => void>()

  /**
   * Bridge the SDK's blocking `onUserDialog` callback to a renderer-side dialog
   * via request/response IPC. Emits `claude:dialog-request` and parks a Promise
   * until the renderer replies through `claude:dialog-response` (resolveDialog)
   * or the query's AbortSignal fires (cancelled).
   */
  async askUserDialog(
    webContents: WebContents,
    request: { dialogKind: string; payload: unknown; toolUseID?: string },
    signal: AbortSignal,
  ): Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }> {
    const reqId = `dlg${Date.now()}_${Math.floor(performance.now())}`
    console.log('[cc-stream] onUserDialog', request.dialogKind, JSON.stringify(request.payload)?.slice(0, 200))
    webContents.send('claude:dialog-request', {
      reqId,
      dialogKind: request.dialogKind,
      payload: request.payload,
      toolUseId: request.toolUseID,
    })
    return new Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }>((resolve) => {
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

  /** Called from the `claude:dialog-response` IPC handler to settle a dialog. */
  resolveDialog(reqId: string, result: { behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }): void {
    const fn = this.dialogResolvers.get(reqId)
    if (fn) {
      this.dialogResolvers.delete(reqId)
      fn(result)
    }
  }

  async send(opts: {
    prompt: string
    sessionId?: string
    localSessionId?: string
    cwd?: string
    webContents: WebContents
  }): Promise<void> {
    const { prompt, sessionId, localSessionId, cwd, webContents } = opts
    // 本次流绑定的渲染端会话 id。所有事件载荷带上它，渲染端据此路由到正确会话，
    // 避免「在 A 发送后切到 B，A 的流式输出串到 B」（之前用「当前激活会话」导致串台）。
    const lsid = localSessionId ?? ''
    const settings = getSettings()

    // 从 cc-desk 自有配置（~/.cc-desk/config.json）取激活的供应商+模型。
    // 应用自成一套，不再读 ~/.claude/settings.json 的模型配置。
    const cfg = getModelProvidersConfig()
    const resolved = resolveActiveProviderModel(cfg)
    if (!resolved) {
      webContents.send('claude:error', { localSessionId: lsid, error: '请先在「设置 → 模型设置」中添加并启用供应商与模型' })
      return
    }
    const general = await getGeneralConfig()

    this.abortController = new AbortController()

    // 代理环境变量（来自常规设置 proxy）
    const proxyEnv: Record<string, string> = general.proxy
      ? { HTTP_PROXY: general.proxy, HTTPS_PROXY: general.proxy, http_proxy: general.proxy, https_proxy: general.proxy }
      : {}

    try {
      const stream = query({
        prompt,
        options: {
          // env REPLACES process.env，故先铺底再覆盖。注入激活供应商的 apiKey/baseUrl
          // 与各角色模型映射（来自 ~/.cc-desk/config.json）。
          env: { ...process.env, ...proxyEnv, ...buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models) },
          model: resolved.model.sdkModelId,
          cwd: cwd || settings.cwd || process.cwd(),
          resume: sessionId,
          permissionMode: 'auto',
          maxTurns: 20,
          // Required to receive incremental stream_event deltas.
          includePartialMessages: true,
          abortController: this.abortController,
          // Bridge the SDK's blocking `onUserDialog` (request_user_dialog control
          // requests, e.g. AskUserQuestion) to a renderer-side dialog UI.
          supportedDialogKinds: ['refusal_fallback_prompt'],
          onUserDialog: async (request: any, { signal }: { signal: AbortSignal }) => {
            return this.askUserDialog(
              webContents,
              { dialogKind: request.dialogKind, payload: request.payload, toolUseID: request.toolUseID },
              signal,
            )
          },
        },
      })

      for await (const message of stream) {
        console.log('[cc-stream] [4] message', message.type, (message as any).subtype ?? '')
        const mtype: string = message.type
        switch (mtype) {
          case 'system': {
            const sys = message as any
            if (sys.subtype === 'init') {
              webContents.send('claude:system', { localSessionId: lsid, sessionId: sys.session_id, model: sys.model, tools: sys.tools })
            } else if (sys.subtype === 'permission_denied') {
              webContents.send('claude:notice', { ...mkNotice('permission_denied', `权限拒绝：${sys.tool_name}`, 'warn'), localSessionId: lsid })
            } else if (sys.subtype === 'compact' || (sys.subtype && String(sys.subtype).startsWith('compact') && sys.compact_result === 'failed')) {
              webContents.send('claude:notice', { ...mkNotice('compact', `上下文压缩失败：${sys.compact_error ?? sys.subtype}`, 'warn'), localSessionId: lsid })
            }
            // 其余 system 子类型（status 的 requesting/processing 瞬态、hook_started/hook_response
            // 协议进度等）属内部噪声，仅记日志、不打扰用户。
            break
          }
          case 'stream_event': {
            const evt = (message as any).event
            if (evt?.type === 'content_block_delta') {
              if (evt.delta?.type === 'text_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'text', delta: evt.delta.text })
              else if (evt.delta?.type === 'thinking_delta') webContents.send('claude:delta', { localSessionId: lsid, kind: 'thinking', delta: evt.delta.thinking })
            } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
              const tb = evt.content_block
              webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_use_start', block: { type: 'tool_use', id: tb.id, name: tb.name, input: tb.input, status: 'running' } })
            }
            break
          }
          case 'assistant': {
            const blocks = normalizeBetaBlocks((message as any).message?.content || [])
            webContents.send('claude:blocks', { localSessionId: lsid, op: 'assistant_blocks', blocks, uuid: (message as any).uuid })
            break
          }
          case 'user': {
            const results = extractToolResults((message as any).message?.content || [])
            for (const r of results) {
              webContents.send('claude:blocks', { localSessionId: lsid, op: 'tool_result', toolUseId: r.toolUseId, result: { content: r.content, isError: r.isError } })
            }
            break
          }
          case 'result': {
            const r = message as any
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
            const am = message as any
            const text = am.error ? `认证错误：${am.error}` : ((Array.isArray(am.output) ? am.output.join(' ') : '') || (am.isAuthenticating ? '认证中…' : '认证就绪'))
            webContents.send('claude:notice', { ...mkNotice('auth', text, am.error ? 'warn' : 'info'), localSessionId: lsid })
            break
          }
          case 'task_started':
          case 'task_updated':
          case 'task_progress':
          case 'task_notification':
            webContents.send('claude:notice', { ...mkNotice('task', `任务事件：${message.type}`, 'info'), localSessionId: lsid }); break
          case 'keep_alive':
          case 'worker_shutting_down':
          case 'commands_changed':
            console.log('[cc-stream] protocol event ignored', message.type); break
          default:
            webContents.send('claude:notice', { ...mkNotice('info', `未分类事件：${message.type}`, 'info'), localSessionId: lsid })
        }
      }
    } catch (err) {
      if (err instanceof AbortError) {
        webContents.send('claude:aborted', { localSessionId: lsid })
      } else {
        webContents.send('claude:error', { localSessionId: lsid, error: String(err) })
      }
    } finally {
      this.abortController = null
    }
  }

  abort(): void {
    this.abortController?.abort()
  }
}
