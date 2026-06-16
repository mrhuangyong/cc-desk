import { useCallback, useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'expanding' | 'expanded' | 'collapsing'

/**
 * 面板展开/折叠动画。
 * 返回动画期间的宽度 style，由调用方合并到面板 div。
 * 展开：首帧 width:0 + overflow:hidden，次帧 transition + 目标宽度。
 * 折叠：transition + width:0，动画结束后 idle（卸载 DOM）。
 */
export function usePanelAnimation(collapsed: boolean) {
  const [phase, setPhase] = useState<Phase>(collapsed ? 'idle' : 'expanded')
  const [animWidth, setAnimWidth] = useState<number | undefined>(undefined)
  const rafRef = useRef(0)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (!collapsed) {
      // 展开：先设 0（无 transition），再设目标宽度（有 transition）
      setPhase('expanding')
      setAnimWidth(0)
      rafRef.current = requestAnimationFrame(() => {
        setPhase('expanded')
        setAnimWidth(undefined) // 释放控制，交给 resizable hook
      })
    } else {
      // 折叠：激活 transition，宽度设 0
      setPhase('collapsing')
      setAnimWidth(0)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [collapsed])

  const onTransitionEnd = useCallback((e: React.TransitionEvent) => {
    if (e.propertyName === 'width' && phase === 'collapsing') {
      setPhase('idle')
      setAnimWidth(undefined)
    }
  }, [phase])

  const styles: React.CSSProperties = phase === 'collapsing'
    ? { width: 0, overflow: 'hidden', transition: 'width .25s ease' }
    : phase === 'expanding'
    ? { width: animWidth, overflow: 'hidden' }
    : phase === 'expanded'
    ? { overflow: 'hidden' }
    : {}

  return {
    mounted: phase !== 'idle',
    styles,
    onTransitionEnd,
  }
}
