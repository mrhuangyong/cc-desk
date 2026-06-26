import { useStore } from '../state/store'
import { InputBar } from './InputBar'

// InputDock：底部输入区。
// AskUserQuestion / 权限授权面板不再在此浮层渲染——改为 ChatArea 对话区底部的内联块，
// 占据对话区空间把消息往上推，永不遮挡对话内容。
export function InputDock() {
  return (
    <div style={{ position: 'relative' }}>
      <InputBar />
    </div>
  )
}
