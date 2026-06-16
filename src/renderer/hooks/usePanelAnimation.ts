import { useCallback, useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'expanding' | 'transitioning' | 'expanded' | 'collapsing'

/**
 * 面板展开/折叠动画。
 *
 * 展开 3 步：
 *   expanding    — width:0, 无 transition（挂载）
 *   transitioning — transition 已激活，宽度仍 0（准备）
 *   expanded     — 释放宽度控制，resizable hook 接管 → CSS 动画 0→target
 *
 * 折叠 1 步：
 *   collapsing — transition + width:0 → transitionend → idle（卸载）
 */
export function usePanelAnimation(collapsed: boolean) {
  const [phase, setPhase] = useState<Phase>(collapsed ? 'idle' : 'expanded')
  const [targetWidth, setTargetWidth] = useState<number | undefined>(undefined)
  const rafRef = useRef(0)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (!collapsed) {
      // 第 1 帧：挂载，width:0
      setPhase('expanding')
      setTargetWidth(0)
      rafRef.current = requestAnimationFrame(() => {
        // 第 2 帧：激活 transition，宽度仍为 0
        setPhase('transitioning')
        rafRef.current = requestAnimationFrame(() => {
          // 第 3 帧：释放宽度控制 → resizable hook 的 width 生效 → 触发动画
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
    styles,
    onTransitionEnd,
  }
}
