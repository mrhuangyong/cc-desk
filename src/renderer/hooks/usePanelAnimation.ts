import { useCallback, useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'expanding' | 'transitioning' | 'expanded' | 'collapsing'

/**
 * 面板展开/折叠动画。
 *
 * 内层 wrapper 用固定 width 锁定原始宽度，外层 overflow:hidden 裁剪，
 * 展开和折叠过程中内容均不换行。
 *
 * 展开 3 步：expanding → transitioning → expanded
 * 折叠 1 步：collapsing → transitionend → idle
 */
export function usePanelAnimation(collapsed: boolean) {
  const [phase, setPhase] = useState<Phase>(collapsed ? 'idle' : 'expanded')
  const [targetWidth, setTargetWidth] = useState<number | undefined>(undefined)
  const originalWidthRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (!collapsed) {
      setPhase('expanding')
      setTargetWidth(0)
      rafRef.current = requestAnimationFrame(() => {
        setPhase('transitioning')
        rafRef.current = requestAnimationFrame(() => {
          setPhase('expanded')
          setTargetWidth(undefined)
        })
      })
    } else {
      setPhase('collapsing')
      setTargetWidth(0)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [collapsed])

  const onTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName !== 'width') return
    if (phase === 'collapsing') {
      setPhase('idle')
      setTargetWidth(undefined)
    }
  }, [phase])

  const animating = phase === 'expanding' || phase === 'transitioning' || phase === 'collapsing'

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
