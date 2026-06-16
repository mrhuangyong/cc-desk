// src/main/claude-service.ts
import { query, AbortError } from '@anthropic-ai/claude-agent-sdk'
import type { WebContents } from 'electron'
import { getSettings } from './settings-store'

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

    if (!settings.apiKey) {
      webContents.send('claude:error', { error: '请先在设置中配置 API Key' })
      return
    }

    this.abortController = new AbortController()

    try {
      const stream = query({
        prompt,
        options: {
          // The SDK spawns a CLI subprocess that reads ANTHROPIC_API_KEY from
          // its environment. `env` REPLACES process.env, so spread it through.
          env: { ...process.env, ANTHROPIC_API_KEY: settings.apiKey },
          model: settings.model,
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
            // SDKPartialAssistantMessage — forward text deltas for live typing.
            const evt = (message as any).event
            if (
              evt?.type === 'content_block_delta' &&
              evt?.delta?.type === 'text_delta'
            ) {
              webContents.send('claude:stream-delta', {
                delta: evt.delta.text as string,
              })
            }
            break
          }

          case 'result':
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
    } catch (err) {
      if (err instanceof AbortError) {
        webContents.send('claude:aborted')
      } else {
        webContents.send('claude:error', { error: String(err) })
      }
    } finally {
      this.abortController = null
    }
  }

  abort(): void {
    this.abortController?.abort()
  }
}
