import { useStore } from '../state/store'
import { InputBar } from './InputBar'
import { AnswerPanel } from './AnswerPanel'

// InputDock：底部输入区。AskUserQuestion 触发的 pendingDialog 不再替换输入框，
// 而是作为叠加层浮在 InputBar 上方（输入框保留可见）。
export function InputDock() {
  const { state } = useStore()
  return (
    <div style={{ position: 'relative' }}>
      {state.pendingDialog?.dialogKind === 'ask_user_question'
        && state.pendingDialog.sessionId === state.activeSessionId && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, padding: '0 0 8px', zIndex: 50 }}>
          <AnswerPanel />
        </div>
      )}
      <InputBar />
    </div>
  )
}
