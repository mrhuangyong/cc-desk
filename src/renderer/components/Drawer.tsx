// src/renderer/components/Drawer.tsx
// 从右侧滑入的详情抽屉外壳：无视觉遮罩（透明背景仍接收点击用于「点外部关闭」）。
// SubagentDetailDrawer / TaskDetailDrawer 原本各自复制这套滑入动画状态机
// （closingRef + rAF 滑入 + setTimeout(onClose,280) 滑出 + translateX + overlay/panel），
// 现统一抽出。header 与关闭按钮因两 Drawer 结构差异较大，仍由调用方在 children 内自定义。
//
// trigger 为「显示信号」：truthy 时渲染并滑入，falsy 时不渲染。
// trigger 值变化（如切换 subagent，非 null→非 null）会重置关闭标志并保持滑入态
// （setOpen(true) 幂等，视觉无闪），故直接把 task 当 trigger 传入即可。
//
// 用法：
//   <Drawer trigger={task} onClose={close} width="min(680px, 90vw)">
//     {(handleClose) => <>{header}{body}</>}
//   </Drawer>
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface DrawerProps {
  /** 显示信号：truthy 渲染并滑入，falsy 不渲染。值变化会重置关闭态（支持内容切换）。 */
  trigger: unknown
  onClose: () => void
  /** 抽屉宽度 CSS（如 'min(680px, 90vw)'），默认 'min(480px, 90vw)' */
  width?: string
  /** 抽屉正文；接收 handleClose（触发滑出动画后卸载），供关闭按钮/标题行绑定 */
  children: (handleClose: () => void) => ReactNode
}

export function Drawer({ trigger, onClose, width = 'min(480px, 90vw)', children }: DrawerProps) {
  const [open, setOpen] = useState(false)
  const closingRef = useRef(false)

  // trigger 变化驱动：出现/切换时重置关闭标志，下一帧滑入
  useEffect(() => {
    if (trigger) {
      closingRef.current = false
      const raf = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(raf)
    }
  }, [trigger])

  if (!trigger) return null

  const handleClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    // transition .25s，留点余量后通知外部卸载
    setTimeout(onClose, 280)
  }

  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1000,
    display: 'flex', justifyContent: 'flex-end',
    // 背景全透明（无视觉遮罩），但仍接收点击用于「点外部关闭」
    background: 'transparent',
  }
  const panelStyle: CSSProperties = {
    width, height: '100%', background: 'var(--bg)',
    borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-float)',
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform .25s ease',
  }

  return (
    <div onClick={handleClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={panelStyle}>
        {children(handleClose)}
      </div>
    </div>
  )
}
