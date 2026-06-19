// src/renderer/components/builtinCommands.ts
// 内置命令的渲染端副作用：builtinAction.type → 执行。
// ctx 由 InputBar 注入（dispatch/session/editor/toggleMenu 等）。
import type { SlashMenuItem } from '../editor/types'
import type { Action } from '../state/actions'

export interface BuiltinCtx {
  dispatch: (a: Action) => void
  sessionId: string
  cwd: string
  modelName: string
  claudeSessionId?: string
  toggleMenu: (id: 'permission' | 'model' | 'thinking') => void
  editor: { chain: () => any } | null   // TipTap editor 实例，用于插文本；可能为 null
}

export function runBuiltin(item: SlashMenuItem, ctx: BuiltinCtx): void {
  const action = item.builtinAction
  if (!action) return
  switch (action.type) {
    case 'open-settings':
      ctx.dispatch({ type: 'SET_SETTINGS_SECTION', section: action.section })
      return
    case 'open-permission-menu':
      ctx.toggleMenu('permission')
      return
    case 'clear-session':
      window.api?.claude?.stop(ctx.sessionId)
      ctx.dispatch({ type: 'CLEAR_SESSION_MESSAGES', sessionId: ctx.sessionId })
      return
    case 'compact':
      window.api?.cc?.builtin?.compact(ctx.sessionId)
      return
    case 'show-cost':
      // text 空 → reducer 聚合会话 costUSD；非空直接显示（这里统一传空让 reducer 算）
      ctx.dispatch({ type: 'SHOW_COST', sessionId: ctx.sessionId, text: '' })
      return
    case 'init-project':
      window.api?.cc?.builtin?.init({ cwd: ctx.cwd })
      return
    case 'export-session':
      window.api?.cc?.builtin?.exportSession(ctx.sessionId)
      return
    case 'add-dir': {
      void (async () => {
        const dir = await window.api?.dialog?.openDirectory()
        if (dir) {
          window.api?.cc?.builtin?.addDir({ localSessionId: ctx.sessionId, dir })
          ctx.dispatch({ type: 'ADD_SESSION_DIR', sessionId: ctx.sessionId, dir })
        }
      })()
      return
    }
    case 'show-status': {
      const resumeInfo = ctx.claudeSessionId ? `resume=${ctx.claudeSessionId}` : '新会话'
      ctx.dispatch({ type: 'SHOW_COST', sessionId: ctx.sessionId, text: `模型: ${ctx.modelName} | cwd: ${ctx.cwd} | ${resumeInfo}` })
      return
    }
    case 'resume':
      // cc-desk 无独立恢复面板，提示用户用左侧会话列表
      ctx.dispatch({ type: 'SHOW_COST', sessionId: ctx.sessionId, text: '请在左侧会话列表选择历史会话恢复' })
      return
    case 'run-review':
      ctx.editor?.chain().focus().insertContent('/code-review ').run()
      return
    case 'insert-text':
      ctx.editor?.chain().focus().insertContent(item.name + ' ').run()
      return
  }
}
