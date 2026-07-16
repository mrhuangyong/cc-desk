// DialogErrorBoundary：包裹 AskUserQuestion/权限/计划 等阻塞式 dialog 面板，
// 防止其渲染期抛异常（如竞态下 pendingDialog 瞬时为 null、payload 结构异常）导致
// 整棵对话区子树卸载、弹窗凭空消失（无全局 ErrorBoundary 时 React 会卸载出错组件树）。
// 捕获后记录诊断信息，渲染一个不致崩的占位（而非把弹窗吞掉），避免「用户没操作弹窗就消失」。
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
}

export class DialogErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // 诊断日志：定位 dialog 渲染崩溃的根因（AskUserQuestion 误消失 BUG 调查）。
    console.warn('[dialog] render crashed', { message: error?.message, stack: error?.stack, componentStack: info?.componentStack })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>
          弹窗渲染异常，请重新触发或查看控制台日志。
        </div>
      )
    }
    return this.props.children
  }
}
