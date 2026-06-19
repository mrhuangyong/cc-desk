// 任务详情抽屉：点击悬浮面板「任务」卡片行弹出，展示该 TaskItem 的完整内容。
// 复用 SubagentDetailDrawer 的滑入动画模式（从右侧滑入，无遮罩，点外部关闭）。
import { useEffect, useRef, useState } from 'react'
import { X, ListChecks, Clock, Tag } from 'lucide-react'
import type { TaskItem } from '../types'
import { formatSessionTime } from '../utils/formatSessionTime'
import { Tooltip } from './Tooltip'

interface Props {
  task: TaskItem | null
  onClose: () => void
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待处理', running: '进行中', completed: '已完成', failed: '失败', killed: '已终止', paused: '已暂停',
}

// 详情字段：标签 + 内容，内容为空则不渲染，保持抽屉紧凑。
function Field({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
        fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3,
      }}>
        {icon}
        <span>{label}</span>
      </div>
      <div style={{
        fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{children}</div>
    </div>
  )
}

export function TaskDetailDrawer({ task, onClose }: Props) {
  const [open, setOpen] = useState(false)
  const closingRef = useRef(false)

  useEffect(() => {
    if (task) {
      closingRef.current = false
      const raf = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(raf)
    }
  }, [task])

  if (!task) return null

  const handleClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    setTimeout(onClose, 280)
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
          width: 'min(560px, 90vw)', height: '100%', background: 'var(--bg)',
          borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--shadow-float)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .25s ease',
        }}
      >
        {/* 头部：标题 + 状态 + 关闭 */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>
              <ListChecks size={16} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>
                {task.subject || task.description || '(任务)'}
              </span>
            </div>
            <Tooltip label="关闭"><button onClick={handleClose} title="关闭" aria-label="关闭" style={{
              width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', borderRadius: 6,
            }}>
              <X size={16} />
            </button></Tooltip>
          </div>
          {/* 状态元信息条 */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 3 }}>{STATUS_LABEL[task.status] ?? task.status}</span>
            {task.taskType && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Tag size={11} /> {task.taskType}</span>
            )}
            {task.createdAt && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {formatSessionTime(task.createdAt)}</span>
            )}
          </div>
        </div>
        {/* 详情内容区：可滚动 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {task.details ? (
            <Field label="详细说明">{task.details}</Field>
          ) : task.description ? (
            <Field label="描述">{task.description}</Field>
          ) : null}
          {task.activeForm && (
            <Field label="进行中提示">{task.activeForm}</Field>
          )}
          {!task.details && !task.description && !task.activeForm && (
            <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '24px 0', textAlign: 'center' }}>
              该任务无更多详情内容
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
