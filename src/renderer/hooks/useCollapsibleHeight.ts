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
 * 配合 ResizeObserver，任务/子代理增减时自动重测，maxHeight 始终贴合内容。
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

  // 内容变化时（任务增减）重测，保证展开态 maxHeight 跟随，新内容不被裁。
  // jsdom 测试环境无 ResizeObserver，判空调过（动画测量仍由 useLayoutEffect 兜底）。
  useEffect(() => {
    const el = ref.current
    if (!el || !open || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, measure])

  // 过渡完成后清掉固定值，让后续内容自由增长（动画期间用数值插值）
  const onTransitionEnd = useCallback(() => {
    if (open) setMaxH(null)
  }, [open])

  return {
    ref,
    style: {
      maxHeight: maxH,
      opacity: open ? 1 : 0,
      overflow: 'hidden',
      transition: 'max-height .2s ease, opacity .15s ease',
    } as CSSProperties,
    onTransitionEnd,
  }
}
