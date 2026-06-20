// 计划抽屉：渲染 ExitPlanMode 提交的完整 Markdown 计划。
// 复用 SubagentDetailDrawer 的滑入动画（从右侧滑入，无遮罩，点外部关闭）。
// 提供一个持久入口——对话流里的 MetaToolCard「查看计划」按钮唤起，
// 解决 plan 批准后入口丢失的问题（plan 内容不再随 pendingDialog 清空而消失）。
import { useEffect, useRef, useState } from 'react'
import { X, Map as MapIcon } from 'lucide-react'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'
import { Tooltip } from './Tooltip'

interface Props {
  // plan 文档磁盘路径（来自 ExitPlanModeOutput.filePath）。优先级最高，
  // 读取真实文件渲染——plan 被编辑/更新后仍反映最新内容。
  filePath?: string
  // 兜底：直接传入 plan 文本（input.plan，无文件路径时用）。
  plan?: string
  open: boolean
  onClose: () => void
}

export function PlanDrawer({ filePath, plan, open: openProp, onClose }: Props) {
  // 从磁盘读 plan 文件内容；无 filePath 时退回传入的 plan 文本。
  const [content, setContent] = useState<string>(plan ?? '')
  useEffect(() => {
    if (!filePath) { setContent(plan ?? ''); return }
    let cancelled = false
    window.api?.fs?.readFile(filePath).then((txt: string) => {
      if (!cancelled) setContent(typeof txt === 'string' ? txt : plan ?? '')
    }).catch(() => { if (!cancelled) setContent(plan ?? '') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])
  // 滑入/滑出动画用内部 state 控制：openProp=true 下一帧滑入，false 先滑出再卸载。
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const closingRef = useRef(false)

  useEffect(() => {
    if (openProp) {
      // 打开：挂载 + 下一帧滑入
      closingRef.current = false
      setMounted(true)
      const raf = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(raf)
    } else if (mounted) {
      // 关闭：先滑出，transition 结束后卸载
      closingRef.current = true
      setOpen(false)
      const t = setTimeout(() => setMounted(false), 280)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openProp])

  if (!mounted) return null

  const handleClose = () => {
    if (closingRef.current) return
    onClose()
  }

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', justifyContent: 'flex-end',
        background: 'transparent',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 90vw)', height: '100%', background: 'var(--bg)',
          borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow-float)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .25s ease',
        }}
      >
        {/* 头部：标题 + 关闭 */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>
            <MapIcon size={16} />
            <span>计划方案</span>
          </div>
          <Tooltip label="关闭"><button onClick={handleClose} aria-label="关闭" style={{
            width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 6,
          }}>
            <X size={16} />
          </button></Tooltip>
        </div>
        {/* 计划内容：Markdown 渲染，可滚动 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <MarkdownRenderer text={content} />
        </div>
      </div>
    </div>
  )
}
