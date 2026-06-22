import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/**
 * 纵向折叠动画：max-height 在 0 ↔ 内容真实高度 之间过渡。
 *
 * 用 scrollHeight 测量真实高度，无固定上限——内容多长都不会被自身 overflow:hidden 裁切，
 * 统一交给外层滚动容器（如 BackendTaskPanel 的 .panel-scroll）承担滚动。
 *
 * 展开态过渡结束后 maxHeight 置为 null（即不设置该属性），内容自由增长，
 * 兼顾「平滑动画」与「永不被裁」；动画期间用具体数值插值。
 * 由于 transitionend 在「max-height 无实际变化」时不一定触发，额外用略长于 transition
 * 的 setTimeout 兜底，保证稳定展开态必然回到 maxH=null，避免内容被固定高度截断。
 * 配合 ResizeObserver，任务/子代理增减时仅在动画窗口内重测，稳定态保持无上限。
 *
 * @param open 是否展开
 */
export function useCollapsibleHeight(open: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  // 展开态：maxH=null（无上限）；折叠态：0。动画进行中用具体数值插值。
  const [maxH, setMaxH] = useState<number | null>(open ? null : 0)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setMaxH(el.scrollHeight)
  }, [])

  // open 切换：折叠→0，展开→立即测量真实高度
  useLayoutEffect(() => {
    if (open) measure()
    else setMaxH(0)
  }, [open, measure])

  // 内容变化时（任务增减）重测，但仅在「有具体 maxH」态（动画进行中/折叠中）才回测，
  // 稳定展开态（maxH===null，无上限）保持 null——此时内容自由增长交给外层滚动容器。
  // 若稳定态也 measure，会把 maxH 打回具体数值 + overflow:hidden，后续内容超出即被裁切且不可滚动。
  // jsdom 测试环境无 ResizeObserver，判空调过（动画测量仍由 useLayoutEffect 兜底）。
  useEffect(() => {
    const el = ref.current
    if (!el || !open || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setMaxH(prev => (prev === null ? null : el.scrollHeight))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  // 过渡完成后清掉固定值，让后续内容自由增长（动画期间用数值插值）。
  // 但 transitionend 不可靠——当 max-height 从「无」变到「恰等于内容高度」时，
  // 视觉无变化，部分浏览器不触发 transitionend，maxH 会卡在具体数值 + overflow:hidden，
  // 后续内容增长即被裁切（子代理/后台任务卡片内容多时表现为固定高度截断）。
  // 故用略长于 transition(.2s) 的 setTimeout 兜底，确保稳定展开态必然回到 maxH=null。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleToNull = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { if (open) setMaxH(null) }, 260)
  }, [open])
  const onTransitionEnd = useCallback(() => {
    if (open) setMaxH(null)
  }, [open])

  // 每次进入展开态（maxH 被打成数值时）启动兜底定时器；卸载时清理。
  useEffect(() => {
    if (open && maxH !== null) settleToNull()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [open, maxH, settleToNull])

  return {
    ref,
    style: {
      maxHeight: maxH,
      opacity: open ? 1 : 0,
      // 稳定展开态（maxH===null）内容必须可见、可撑高，交由外层滚动容器承担；
      // 仅动画进行中（maxH 为具体数值）才 hidden 做裁切插值——
      // 否则长内容会被固定 maxHeight 截断且无法滚动（后台任务卡片在 streaming 期间尤为明显）。
      overflow: maxH === null ? 'visible' : 'hidden',
      transition: 'max-height .2s ease, opacity .15s ease',
    } as CSSProperties,
    onTransitionEnd,
  }
}
