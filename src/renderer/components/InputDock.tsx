import { useStore } from '../state/store'
import { InputBar } from './InputBar'
import { AnswerPanel } from './AnswerPanel'
import { PermissionPanel } from './PermissionPanel'

// InputDock：底部输入区。AskUserQuestion / 权限授权触发的 pendingDialog 作为叠加层
// 浮在 InputBar 上方（输入框保留可见）。
export function InputDock() {
  const { state } = useStore()
  const dlg = state.pendingDialog
  const overlay =
    dlg && dlg.sessionId === state.activeSessionId &&
    (dlg.dialogKind === 'ask_user_question' || dlg.dialogKind === 'permission_request')
  const Panel = dlg?.dialogKind === 'permission_request' ? PermissionPanel : AnswerPanel
  return (
    <div style={{ position: 'relative' }}>
      {overlay && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, padding: '0 0 8px', zIndex: 50 }}>
          <Panel />
        </div>
      )}
      <InputBar />
    </div>
  )
}
