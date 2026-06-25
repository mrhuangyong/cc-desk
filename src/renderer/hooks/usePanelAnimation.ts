import { useCallback, useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'expanding' | 'transitioning' | 'expanded' | 'collapsing'
const ANIMATION_FALLBACK_MS = 350

/**
 * 面板展开/折叠动画。
 *
 * 内层 wrapper 用固定 width 锁定原始宽度，外层 overflow:hidden 裁剪，
 * 展开和折叠过程中内容均不换行。
 *
 * 展开 3 步：expanding → transitioning → expanded → transitionend 清除 expandingRef
 * 折叠 1 步：collapsing → transitionend → idle
 */
export function usePanelAnimation(collapsed: boolean) {
  const [phase, setPhase] = useState<Phase>(collapsed ? 'idle' : 'expanded')
  const [targetWidth, setTargetWidth] = useState<number | undefined>(undefined)
  const originalWidthRef = useRef(0)
  // 追踪展开动画：expanding 开始 → transitionEnd 结束
  const expandingRef = useRef(false)
  const rafRef = useRef(0)
  const timeoutRef = useRef(0)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    clearTimeout(timeoutRef.current)
    if (!collapsed) {
      expandingRef.current = true
      setPhase('expanding')
      setTargetWidth(0)
      rafRef.current = requestAnimationFrame(() => {
        setPhase('transitioning')
        rafRef.current = requestAnimationFrame(() => {
          setPhase('expanded')
          setTargetWidth(undefined)
        })
      })
      // transitionend 在宽度被直接写 style、页面隐藏或 React 重排时可能丢失。
      // 兜底释放 animating，避免内层 wrapper 长期锁住展开前宽度。
      timeoutRef.current = window.setTimeout(() => {
        expandingRef.current = false
        setPhase('expanded')
        setTargetWidth(undefined)
      }, ANIMATION_FALLBACK_MS)
    } else {
      if (phase === 'idle') return
      expandingRef.current = false
      setPhase('collapsing')
      setTargetWidth(0)
      timeoutRef.current = window.setTimeout(() => {
        setPhase('idle')
        setTargetWidth(undefined)
      }, ANIMATION_FALLBACK_MS)
    }
    return () => {
      cancelAnimationFrame(rafRef.current)
      clearTimeout(timeoutRef.current)
    }
  }, [collapsed])

  const onTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName !== 'width') return
    clearTimeout(timeoutRef.current)
    if (expandingRef.current) {
      // 展开动画结束
      expandingRef.current = false
    } else if (phase === 'collapsing') {
      // 折叠动画结束
      setPhase('idle')
      setTargetWidth(undefined)
    }
  }, [phase])

  // animating 覆盖展开 transition 全过程（expanding → expanded → transitionEnd）
  const animating = phase === 'expanding' || phase === 'transitioning' || phase === 'collapsing' || expandingRef.current

  const styles: React.CSSProperties = phase === 'expanding'
    ? { width: targetWidth, overflow: 'hidden' }
    : phase === 'transitioning'
    ? { width: targetWidth, overflow: 'hidden', transition: 'width .25s ease' }
    : phase === 'expanded'
    ? { overflow: 'hidden', transition: 'width .25s ease' }
    : phase === 'collapsing'
    ? { width: targetWidth, overflow: 'hidden', transition: 'width .25s ease' }
    : {}

  return {
    mounted: phase !== 'idle',
    animating,
    originalWidthRef,
    styles,
    onTransitionEnd,
  }
}
