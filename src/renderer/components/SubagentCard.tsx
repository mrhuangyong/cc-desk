// 子代理卡片：显示当前会话的 subagent（Task 工具 spawn）列表，嵌入 BackendTaskPanel。
// 复用 BackendTaskCard 的骨架（圆角浮层 + 折叠头 + 列表），但用 Bot 图标与子代理语义区分。
import { Bot, Loader2, Square, X, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { BackendTask } from '../types'
import { formatSessionTime } from '../utils/formatSessionTime'
import { Tooltip } from './Tooltip'

const STATUS_LABEL: Record<BackendTask['status'], string> = {
  running: '运行中', completed: '已完成', failed: '已退出', stopped: '已终止',
}

function StatusIcon({ status }: { status: BackendTask['status'] }) {
  const common = { size: 13, style: { flexShrink: 0, marginTop: 1 } }
  switch (status) {
    case 'running': return <Loader2 {...common} className="cc-spin" style={{ ...common.style, color: 'var(--accent)' }} />
    case 'completed': return <CheckCircle2 {...common} style={{ ...common.style, color: '#34c759' }} />
    case 'failed': return <AlertCircle {...common} style={{ ...common.style, color: '#ff3b30' }} />
    case 'stopped': return <Square {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
  }
}

interface Props {
  tasks: BackendTask[]
  onKill: (taskId: string) => void
  onRemove: (taskId: string) => void
  onClearFinished: () => void
  onClickTask?: (task: BackendTask) => void
}

export function SubagentCard({ tasks, onKill, onRemove, onClearFinished, onClickTask }: Props) {
  if (tasks.length === 0) return null
  const runningTasks = tasks.filter(t => t.status === 'running')
  const finishedTasks = tasks.filter(t => t.status !== 'running')
  const doneCount = finishedTasks.filter(t => t.status === 'completed').length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600 }}>
          <Bot size={13} /> 子代理
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {runningTasks.length} 运行 · {doneCount} 完成 · 共 {tasks.length}
        </span>
      </div>
      <div style={{ padding: 4 }}>
        {runningTasks.map(t => (
          <SubagentRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} onClick={onClickTask} />
        ))}
        {finishedTasks.length > 0 && (
          <>
            {runningTasks.length > 0 && <div style={{ height: 1, background: 'var(--border-hair)', margin: '4px 8px' }} />}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>已结束 · {finishedTasks.length}</span>
              <button onClick={onClearFinished} title="清除已结束" style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', color: 'var(--text-muted)', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 10,
              }}>
                <Trash2 size={11} /> 清除
              </button>
            </div>
            {finishedTasks.map(t => (
              <SubagentRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} onClick={onClickTask} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function SubagentRow({ t, onKill, onRemove, onClick }: {
  t: BackendTask
  onKill: (id: string) => void
  onRemove: (id: string) => void
  onClick?: (task: BackendTask) => void
}) {
  return (
    <div
      onClick={onClick ? () => onClick(t) : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '6px 8px', borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <StatusIcon status={t.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: t.status === 'running' ? 'var(--text)' : 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {t.command}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{STATUS_LABEL[t.status]}{t.startedAt ? ` · ${formatSessionTime(t.startedAt)}` : ''}</span>
          {t.subagentType && (
            <span style={{ background: 'var(--surface-2)', padding: '0 4px', borderRadius: 3 }}>{t.subagentType}</span>
          )}
        </div>
        {/* 实时进度(task_progress 刷新):running 时显示当前工具/摘要/token,让行「活」起来 */}
        {t.status === 'running' && (t.lastToolName || t.progressSummary || t.tokenCount != null) && (
          <div style={{ fontSize: 10, marginTop: 3, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {t.progressSummary && (
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.progressSummary}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: t.progressSummary ? 2 : 0, opacity: 0.8, flexWrap: 'wrap' }}>
              {t.lastToolName && (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '100%' }}>⏵ {t.lastToolName}</span>
              )}
              {t.tokenCount != null && <span style={{ whiteSpace: 'nowrap' }}>{t.tokenCount < 1000 ? t.tokenCount : `${(t.tokenCount / 1000).toFixed(1)}k`} tok</span>}
              {t.toolUses != null && t.toolUses > 0 && <span style={{ whiteSpace: 'nowrap' }}>{t.toolUses} 工具</span>}
            </div>
          </div>
        )}
      </div>
      {t.status === 'running' ? (
        <Tooltip label="终止">
          <button onClick={(e) => { e.stopPropagation(); onKill(t.id) }} style={{
            padding: '2px 6px', color: 'var(--text-muted)', background: 'var(--surface-2)',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
            display: 'inline-flex', alignItems: 'center',
          }}>
            <Square size={10} />
          </button>
        </Tooltip>
      ) : (
        <Tooltip label="移除">
          <button onClick={(e) => { e.stopPropagation(); onRemove(t.id) }} style={{
            padding: '2px 4px', color: 'var(--text-muted)', background: 'none',
            border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
          }}>
            <X size={13} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
