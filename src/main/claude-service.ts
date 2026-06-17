// src/main/claude-service.ts
import { query, AbortError } from '@anthropic-ai/claude-agent-sdk'
import type { WebContents } from 'electron'
import { getSettings } from './settings-store'
import { getModelProvidersConfig, resolveActiveProviderModel, buildSdkEnv } from './cc-desk-store'
import { getGeneralConfig } from './claude-config'

/**
 * ClaudeService wraps the Claude Agent SDK `query()` into a renderer-facing
 * streaming interface. Results are pushed to `webContents` via IPC channels:
 *   - 'claude:system'        session init (sessionId / model / tools)
 *   - 'claude:assistant'     a complete assistant message (content blocks)
 *   - 'claude:stream-delta'  incremental text token (streaming)
 *   - 'claude:result'        terminal result (cost / turns / subtype)
 *   - 'claude:aborted'       aborted by user
 *   - 'claude:error'         any other failure
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

  async send(opts: {
    prompt: string
    sessionId?: string
    cwd?: string
    webContents: WebContents
  }): Promise<void> {
    const { prompt, sessionId, cwd, webContents } = opts
    const settings = getSettings()
    console.log('[cc-stream] [2/3] ClaudeService.send start', { promptLen: prompt?.length, sessionId, cwd })

    // 从 cc-desk 自有配置（~/.cc-desk/config.json）取激活的供应商+模型。
    // 应用自成一套，不再读 ~/.claude/settings.json 的模型配置。
    const cfg = getModelProvidersConfig()
    const resolved = resolveActiveProviderModel(cfg)
    if (!resolved) {
      webContents.send('claude:error', { error: '请先在「设置 → 模型设置」中添加并启用供应商与模型' })
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
        },
      })

      for await (const message of stream) {
        console.log('[cc-stream] [4] message', message.type, (message as any).subtype ?? '')
        switch (message.type) {
          case 'system': {
            const sys = message as any
            // The 'init' system message carries session metadata.
            if (sys.subtype === 'init') {
              webContents.send('claude:system', {
                sessionId: sys.session_id,
                model: sys.model,
                tools: sys.tools,
              })
            }
            break
          }

          case 'assistant':
            webContents.send('claude:assistant', {
              content: (message as any).message?.content || [],
              costUSD: (message as any).cost_usd,
              durationMs: (message as any).duration_ms,
              sessionId: (message as any).session_id,
            })
            break

          case 'stream_event': {
            // SDKPartialAssistantMessage — 转发文本/思考增量与工具调用块。
            const evt = (message as any).event
            if (evt?.type === 'content_block_delta') {
              if (evt?.delta?.type === 'text_delta') {
                webContents.send('claude:stream-delta', { delta: evt.delta.text as string })
              } else if (evt?.delta?.type === 'thinking_delta') {
                webContents.send('claude:thinking-delta', { delta: evt.delta.thinking as string })
              }
            } else if (evt?.type === 'content_block_start' && evt?.content_block?.type === 'tool_use') {
              // 工具调用开始：转发为待办/工具卡片
              const tb = evt.content_block
              webContents.send('claude:tool-use', {
                id: tb.id, name: tb.name, input: tb.input,
              })
            }
            break
          }

          case 'result':
            console.log('[cc-stream] [5] send claude:result', {
              sessionId: (message as any).session_id,
              subtype: (message as any).subtype,
            })
            webContents.send('claude:result', {
              sessionId: (message as any).session_id,
              subtype: (message as any).subtype,
              costUSD: (message as any).total_cost_usd,
              durationMs: (message as any).duration_ms,
              turns: (message as any).num_turns,
            })
            break
        }
      }
      console.log('[cc-stream] [6] stream loop ended normally')
    } catch (err) {
      console.log('[cc-stream] [6] caught', err instanceof AbortError ? 'AbortError' : 'Error', String(err))
      if (err instanceof AbortError) {
        webContents.send('claude:aborted')
      } else {
        webContents.send('claude:error', { error: String(err) })
      }
    } finally {
      console.log('[cc-stream] [6] finally, abortController cleared')
      this.abortController = null
    }
  }

  abort(): void {
    this.abortController?.abort()
  }
}
