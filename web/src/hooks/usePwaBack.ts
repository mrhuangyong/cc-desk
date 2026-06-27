// web/src/hooks/usePwaBack.ts
// PWA 系统返回键（Android 硬件返回键 / 手势返回 / iOS 边缘返回）的接管。
//
// 问题背景：PWA 默认不拦截系统返回，浏览器历史栈为空时一次返回就退出到桌面。
//   - 对话页按返回 → 期望回列表页，实际直接退桌面
//   - 列表页按返回 → 期望「再按一次」确认，实际直接退桌面
//
// 方案：用 History API 把应用内视图推入历史栈，popstate 时做应用内导航或确认退出。
//
// 历史栈模型：
//   应用启动占用 [root]（初始条目）。
//   进入 chat → pushState 压 [inner]。
//
// popstate 语义（系统返回 = 浏览器回退一条历史）：
//   - 当前在 chat（栈顶是 inner）：回退弹出 inner → 调 onNavigateBack 回 list。栈剩 [root]。
//   - 当前在 list（栈顶是 root），首次：用户意图退出。pushState 补回 [root]（栈变 [root,root]），
//     阻止本次退出 + 显示「再按一次」toast。
//   - list 二次（toast 窗口内）：不再 pushState，栈回到 [root]；再按一次返回浏览器自然退出 PWA。
//     注意：不主动调 history.back()（会触发额外 popstate 形成循环），让浏览器的原始返回动作完成退出。
//
// 关键不变量：
//   - pushState 不触发 popstate（程序压栈）。
//   - 只在「首次 list 返回」时 pushState 补一条；退出分支绝不 pushState/back，避免循环。
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UsePwaBackOptions {
  /** 当前是否在「内层」视图（如对话页）。true 时返回键回外层；false 时走「再按一次退出」。 */
  inInnerView: boolean
  /** 从内层返回外层时调用（如 chat → list）。 */
  onNavigateBack: () => void
  /** 「再按一次退出」提示的超时毫秒；超时后提示失效，下次返回重新计一次。 */
  exitConfirmMs?: number
}

export interface UsePwaBackHandle {
  /** 是否正在显示「再按一次退出」提示。 */
  showExitToast: boolean
}

export function usePwaBack(opts: UsePwaBackOptions): UsePwaBackHandle {
  const { inInnerView, onNavigateBack, exitConfirmMs = 2500 } = opts
  const [showExitToast, setShowExitToast] = useState(false)

  // ref 持有最新值，避免 popstate 监听器依赖变化重绑。
  const inInnerRef = useRef(inInnerView)
  inInnerRef.current = inInnerView
  const onBackRef = useRef(onNavigateBack)
  onBackRef.current = onNavigateBack

  // 退出确认：是否已「武装」（已提示一次）。
  const exitArmedRef = useRef(false)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 内层历史是否已压入。
  const innerPushedRef = useRef(false)

  // 进入/离开内层时同步历史栈。
  useEffect(() => {
    if (inInnerView && !innerPushedRef.current) {
      window.history.pushState({ ccDeskInner: true }, '')
      innerPushedRef.current = true
    } else if (!inInnerView && innerPushedRef.current) {
      // 程序离开 chat（如点 header 返回按钮）：把栈顶 inner 换成 root 态，
      // 避免下次系统返回多退一步。replaceState 不触发 popstate。
      if (window.history.state?.ccDeskInner) {
        window.history.replaceState({ ccDeskRoot: true }, '')
      }
      innerPushedRef.current = false
    }
  }, [inInnerView])

  const disarmExit = useCallback(() => {
    exitArmedRef.current = false
    setShowExitToast(false)
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }, [])

  const armExit = useCallback(() => {
    exitArmedRef.current = true
    setShowExitToast(true)
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    exitTimerRef.current = setTimeout(() => {
      exitArmedRef.current = false
      setShowExitToast(false)
    }, exitConfirmMs)
  }, [exitConfirmMs])

  useEffect(() => {
    const onPopState = () => {
      if (inInnerRef.current) {
        // 内层返回：回外层。
        innerPushedRef.current = false
        disarmExit()
        onBackRef.current()
        return
      }
      // 外层（list）：意图退出。
      if (exitArmedRef.current) {
        // 窗口内第二次：放行退出。绝不 pushState/back，让浏览器原始返回完成退出。
        disarmExit()
        return
      }
      // 第一次：拦截退出 + 提示。pushState 补回被弹出的 root，阻止本次退出。
      window.history.pushState({ ccDeskRoot: true }, '')
      armExit()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [armExit, disarmExit])

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    }
  }, [])

  return { showExitToast }
}
