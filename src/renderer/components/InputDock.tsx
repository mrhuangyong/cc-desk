import { useStore } from '../state/store'
import { InputBar } from './InputBar'
import { AnswerPanel } from './AnswerPanel'

export function InputDock() {
  const { state } = useStore()
  return state.pendingDialog ? <AnswerPanel /> : <InputBar />
}
