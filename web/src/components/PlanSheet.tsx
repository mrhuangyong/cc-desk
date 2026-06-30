// web/src/components/PlanSheet.tsx
// ExitPlanMode 的移动端计划批准卡片（dialogKind='plan_proposed'）。
//
// 对齐桌面端 src/renderer/components/PlanCard.tsx：展示 plan 文本（markdown 行内渲染 +
// 滚动），底部给出批准后的权限模式二选一（自动编辑 / 完全访问；另外两模式在计划批准后
// 无意义，不展示）。拒绝 → 保持 plan 模式让模型改计划。
//
// payload 形态（forwarder 透传 SDK ExitPlanMode input）：
//   { plan: string, allowedPrompts?: any[] }
//   allowedPrompts 桌面端也仅接收未强渲染，这里保持一致不渲染（不扩范围）。
//
// result 构造（与桌面 PlanCard.approve 一致）：
//   批准 → { behavior:'completed', result:{ permissionMode:'中文标签' } }
//   拒绝 → deny（桌面端 handleExitPlanMode 把非 completed 视为「未批准，请改计划」）
import { useState } from 'react'
import type { DialogRequest } from '../lib/dialog-queue'
import { renderInline } from '../lib/render-inline'
import { ListIcon } from './icons'

// 计划批准后的可选授权模式（对齐桌面 PlanCard.APPROVE_MODES）
const APPROVE_MODES = [
  { label: '自动编辑', desc: '自动接受文件编辑，其他操作仍需确认', icon: '✎' },
  { label: '完全访问', desc: '跳过所有权限检查，完全自动执行', icon: '⚡' },
] as const

export interface PlanSheetProps {
  dialog: DialogRequest
  /** 批准：传 reqId + 选定的权限模式（中文标签）。 */
  onApprove: (reqId: string, permissionMode: string) => void
  /** 拒绝：传 reqId（调用方走 deny）。 */
  onDeny: (reqId: string) => void
}

export default function PlanSheet({ dialog, onApprove, onDeny }: PlanSheetProps) {
  const plan: string = (dialog.payload as any)?.plan ?? ''
  // 默认选中「自动编辑」（计划批准后最常见的执行态）
  const [mode, setMode] = useState<string>('自动编辑')

  // plan 为空：退化为「再改改」单按钮，避免空卡片卡死
  if (!plan) {
    return (
      <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="计划批准">
        <div className="dialog-sheet">
          <div className="dialog-grab" aria-hidden="true" />
          <div className="dialog-question">计划内容为空</div>
          <div className="dialog-actions">
            <button className="dialog-btn deny" onClick={() => onDeny(dialog.reqId)}>再改改</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="计划批准">
      <div className="dialog-sheet plan-sheet">
        <div className="dialog-grab" aria-hidden="true" />
        <div className="dialog-sheet-head">
          <span className="dialog-kind-badge"><ListIcon /></span>
          <span className="dialog-kind">计划方案（计划模式）</span>
        </div>
        {/* 计划文本：行内 markdown + pre-wrap 保留换行，max-height 滚动 */}
        <div className="dialog-plan">{renderInline(plan)}</div>
        {/* 权限模式选择 */}
        <div className="dialog-modes-label">批准并执行：</div>
        <div className="dialog-modes">
          {APPROVE_MODES.map((m) => (
            <button
              key={m.label}
              className={`dialog-mode${mode === m.label ? ' selected' : ''}`}
              onClick={() => setMode(m.label)}
              title={m.desc}
              type="button"
            >
              <span className="dialog-mode-icon">{m.icon}</span>
              <span className="dialog-mode-body">
                <span className="dialog-mode-label">{m.label}</span>
                <span className="dialog-mode-desc">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn deny" onClick={() => onDeny(dialog.reqId)} type="button">再改改</button>
          <button className="dialog-btn approve" onClick={() => onApprove(dialog.reqId, mode)} type="button">批准</button>
        </div>
      </div>
    </div>
  )
}
