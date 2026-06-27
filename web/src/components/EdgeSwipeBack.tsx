// web/src/components/EdgeSwipeBack.tsx
// 边缘滑动返回手势 wrapper（包裹 ChatPage 根容器）。
//
// 行为：从屏幕左边缘（起始 x < EDGE_ZONE）按下右拖，容器跟随手指 translateX；
// 松手时位移超过 THRESHOLD（px）或速度超过 SPEED 阈值 → 触发 onBack；否则回弹归位。
// 模拟 iOS/Android 原生导航返回手势，让移动端不靠点左上角小箭头。
//
// 关键点：
// - 只在「从左边缘起手」时激活，避免与列表横向滚动/输入选区冲突。
// - translateX 限幅 + 阻尼（位移越大越费力，拖离感更真实）。
// - 滑动期间容器加 box-shadow 模拟「页面被拖离」的层次。
// - 尊重 prefers-reduced-motion：直接禁用手势（点返回按钮仍可用）。
//
// 为何用原生 addEventListener 而非 React onTouchMove：
// Chrome 默认把 touchmove 标记为 passive，React 合成事件的 preventDefault 会失效，
// 导致横向滑动时页面仍跟着垂直滚动（串扰）。原生监听显式 { passive: false } 才能阻止。
import React, { useEffect, useRef, useState } from 'react'

export interface EdgeSwipeBackProps {
  onBack: () => void
  children: React.ReactNode
  /** 是否启用手势（默认 true）。 */
  enabled?: boolean
}

const EDGE_ZONE = 28 // 左边缘 28px 内起手才识别
const THRESHOLD = 80 // 松手位移阈值（px）
const MIN_DRAG = 30 // 速度判定前需先满足的最小位移（防误触）
const SPEED = 0.5 // 速度阈值（px/ms）
const MAX_RATIO = 0.6 // 最大位移 = 屏幕宽 * 0.6

export default function EdgeSwipeBack({ onBack, children, enabled = true }: EdgeSwipeBackProps) {
  const [tx, setTx] = useState(0)
  const [dragging, setDragging] = useState(false)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const active = useRef(false) // 是否命中边缘起手
  const decided = useRef(false) // 是否已判定主轴（横/纵）
  const horizontal = useRef(false)
  const maxTx = useRef(0)
  // 把最新的 onBack 存进 ref，避免 useEffect 依赖它导致重新绑事件。
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const gestureOn = enabled && !reduceMotion

  useEffect(() => {
    if (!gestureOn) return
    const el = wrapRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX.current = t.clientX
      startY.current = t.clientY
      startTime.current = e.timeStamp
      active.current = t.clientX < EDGE_ZONE
      decided.current = false
      horizontal.current = false
      maxTx.current = window.innerWidth * MAX_RATIO
    }

    const onMove = (e: TouchEvent) => {
      if (!active.current) return
      const t = e.touches[0]
      const dx = t.clientX - startX.current
      const dy = t.clientY - startY.current

      // 首次移动判定主轴：横向位移 > 纵向 → 横向手势；否则放弃（交给垂直滚动）。
      if (!decided.current) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
        decided.current = true
        horizontal.current = Math.abs(dx) > Math.abs(dy)
        if (horizontal.current) setDragging(true)
        else {
          active.current = false
          return
        }
      }
      if (!horizontal.current) return

      // 阻尼：位移越大增长越慢。
      const ratio = Math.min(Math.max(dx, 0) / maxTx.current, 1)
      const damped = ratio * maxTx.current * (1 - 0.3 * ratio * ratio)
      setTx(Math.max(0, damped))

      // 横向占优时阻止垂直滚动串扰（原生 passive:false 才能 preventDefault）。
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = (e: TouchEvent) => {
      if (!active.current || !horizontal.current) {
        active.current = false
        return
      }
      const t = e.changedTouches[0]
      const dx = t.clientX - startX.current
      const dt = Math.max(e.timeStamp - startTime.current, 1)
      const speed = dx / dt

      active.current = false
      horizontal.current = false
      setDragging(false)

      // 触发条件：位移超阈值，或（已达最小拖动量且速度足够快）。
      // 单看 speed 不行：合成事件/快速轻触的 dt 失真会误判，要求先满足最小位移。
      const triggered = dx > THRESHOLD || (dx > MIN_DRAG && speed > SPEED)
      if (triggered) {
        // 触发返回：先滑出，再回调。
        setTx(maxTx.current)
        window.setTimeout(() => {
          setTx(0)
          onBackRef.current()
        }, 160)
      } else {
        setTx(0) // 回弹
      }
    }

    // touchmove 必须原生绑定 + passive:false，否则 preventDefault 无效。
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [gestureOn])

  return (
    <div
      ref={wrapRef}
      style={{
        transform: tx ? `translateX(${tx}px)` : undefined,
        transition: dragging ? 'none' : 'transform .24s ease',
        boxShadow: dragging ? 'var(--shadow-swipe)' : undefined,
        // height:100% + flex column：让百分比 min-height 沿 #root → wrap → .app → .chat-page 正确传递。
        // 不能用 min-height:100%——百分比 min-height 需父级有「确定 height」才生效，
        // wrap 若用 min-height 会让 .chat-page 的 min-height:100% 失效、高度塌成内容高度，
        // 导致 .chat-input-bar 的 sticky bottom 脱离视口底（输入框浮在内容尾）。
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  )
}
