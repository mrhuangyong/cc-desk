// 元工具卡片：渲染 TaskCreate / TaskUpdate / TaskList / ExitPlanMode 这类
// 「任务/计划管理」工具调用。它们原本被刻意从对话流过滤（只进悬浮面板），
// 现改为对话流也保留，用语义化卡片呈现，让对话流完整记录模型的行为。
//
// 与普通 ToolUseCard 的区别：
// - 专属图标 + 中文名称，一眼看出是「规划类」操作而非普通工具
// - ExitPlanMode 的 plan 内容可点击打开抽屉查看（PlanDrawer）
// - 输入/结果仍可展开查看原始结构
import { useState } from 'react'
import {
  ListPlus, CheckSquare, ClipboardList, Map as MapIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ContentBlock } from '../../types'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { PlanDrawer } from '../PlanDrawer'

// 元信息：每种元工具的图标 / 中文名 / 摘要提取
const META: Record<string, { icon: LucideIcon; label: string; summarize: (input: any) => string; statusKey?: (input: any) => string | undefined }> = {
  TaskCreate: {
    icon: ListPlus, label: '新建任务',
    summarize: (i) => i?.subject || i?.description || '',
  },
  TaskUpdate: {
    icon: CheckSquare, label: '更新任务',
    summarize: (i) => {
      const parts: string[] = []
      if (i?.taskId) parts.push(`#${i.taskId}`)
      if (typeof i?.status === 'string') parts.push(i.status)
      if (i?.subject) parts.push(i.subject)
      return parts.join(' · ')
    },
    statusKey: (i) => (typeof i?.status === 'string' ? i.status : undefined),
  },
  TaskList: {
    icon: ClipboardList, label: '查询任务',
    summarize: () => '',
  },
  ExitPlanMode: {
    icon: MapIcon, label: '提交计划',
    summarize: () => '',
  },
}

type Status = 'running' | 'error' | 'done'
const STATUS_COLOR: Record<Status, string> = {
  running: 'var(--status-warn, #d97706)',
  error: 'var(--danger)',
  done: 'var(--status-ok, #16a34a)',
}

interface Props {
  block: Extract<ContentBlock, { type: 'tool_use' }>
}

export function MetaToolCard({ block }: Props) {
  const meta = META[block.name]
  // ExitPlanMode 默认展开：授权后 PlanCard 弹窗消失，计划回看入口需立即可见，
  // 不能藏在折叠的 details 里让用户找不到。
  const [open, setOpen] = useState(block.name === 'ExitPlanMode')
  const [planOpen, setPlanOpen] = useState(false)

  if (!meta) return null
  const Icon = meta.icon
  const status: Status = block.status === 'running' ? 'running' : block.status === 'error' ? 'error' : 'done'
  const color = STATUS_COLOR[status]
  const summary = meta.summarize(block.input)
  const isPlan = block.name === 'ExitPlanMode'
  // plan 路径优先级：input.planFilePath（assistant 阶段可得，真实 SDK 字段）>
  // block.planFilePath（tool_result 回填兜底）。plan 文本作 PlanDrawer 的 fallback。
  const planFilePath = (typeof block.input?.planFilePath === 'string' && block.input.planFilePath) || block.planFilePath
  const planText = typeof block.input?.plan === 'string' ? block.input.plan : ''

  const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
    padding: '4px 0', userSelect: 'none',
  }

  return (
    <>
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ width: '100%', margin: '8px 0', padding: 0, fontSize: 12, fontFamily: 'var(--font-mono)' }}
    >
      <summary style={{ ...headerStyle, listStyle: 'none' }}>
        <span aria-hidden style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color,
          boxShadow: status === 'running' ? `0 0 0 3px ${hexToRgba(color, 0.18)}` : 'none',
          animation: status === 'running' ? 'pulse 1.4s ease-in-out infinite' : 'none',
        }} />
        <Icon size={13} />
        <span style={{ color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{meta.label}</span>
        {summary && (
          <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
            {summary}
          </span>
        )}
        {!summary && <span style={{ flex: 1 }} />}
        {/* 计划回看入口放在 summary 行：授权后 PlanCard 弹窗消失，
            「查看计划」需始终可见（不依赖 details 展开），用户随时能点开计划抽屉。 */}
        {isPlan && (planFilePath || planText) && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPlanOpen(true) }}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
              border: '1px solid var(--accent, #2563eb)', background: 'var(--accent, #2563eb)', color: '#fff',
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
            }}
          >
            <MapIcon size={11} /> 查看计划
          </button>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 10 }}>{open ? '▾' : '▸'}</span>
      </summary>

      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isPlan ? (
            // 提交计划：plan 是 Markdown 文档，直接渲染（而非 JSON.stringify 原始 input）。
            // 默认折叠到固定高度 + 渐隐遮罩，点击「展开全文」切换；容器有独立背景/边框/圆角，
            // 与对话流正文区分。allowedPrompts 以小标签列出，不再混入 JSON。
            <PlanDoc plan={planText} allowedPrompts={block.input?.allowedPrompts} />
          ) : block.input != null && (
            <div>
              <div style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>输入</div>
              <pre style={{
                margin: 0, padding: 10, background: 'var(--surface-1)', borderRadius: 6,
                overflowX: 'auto', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontSize: 11.5, lineHeight: 1.5,
              }}>
                {typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)}
              </pre>
            </div>
          )}
          {/* ExitPlanMode 的占位 result（"Exit plan mode?"）无信息价值，不渲染结果区 */}
          {block.result && !isPlan && (
            <div>
              <div style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>结果</div>
              <div style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: block.result.isError ? 'var(--danger)' : 'var(--text)', lineHeight: 1.5,
              }}>
                <MarkdownRenderer text={block.result.content} />
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
    </details>
    {/* PlanDrawer 必须在 <details> 外：details 折叠时会隐藏内部所有非 summary 子元素，
        fixed 定位的抽屉也会被吞掉，导致折叠状态下点击「查看计划」打不开。 */}
    {isPlan && (planFilePath || planText) && (
      <PlanDrawer filePath={planFilePath} plan={planText} open={planOpen} onClose={() => setPlanOpen(false)} />
    )}
    </>
  )
}

// 计划文档展示：把 ExitPlanMode 的 plan（Markdown）渲染为可折叠文档区。
// 默认限高 + 底部渐隐遮罩，点击「展开全文」切换；容器有独立背景/边框/圆角与对话流区分。
// allowedPrompts（计划需要的工具权限）以小标签列出，替代原先整块 JSON 的低可读性展示。
const PLAN_COLLAPSED_HEIGHT = 240
function PlanDoc({ plan, allowedPrompts }: { plan: string; allowedPrompts?: any[] }) {
  const [expanded, setExpanded] = useState(false)
  // 内容短于折叠高度时不显示「展开全文」（避免短计划还多个按钮）
  const [collapsible, setCollapsible] = useState(false)
  const measureRef = (el: HTMLDivElement | null) => {
    if (el) setCollapsible(el.scrollHeight > PLAN_COLLAPSED_HEIGHT + 8)
  }
  const prompts: any[] = Array.isArray(allowedPrompts) ? allowedPrompts : []

  return (
    <div style={{
      // 与对话流正文区分：卡片化容器
      border: '1px solid var(--border)', borderRadius: 8,
      background: 'var(--surface-1)', overflow: 'hidden',
    }}>
      <div style={{
        position: 'relative',
        maxHeight: expanded ? 'none' : PLAN_COLLAPSED_HEIGHT,
        overflow: expanded ? 'visible' : 'hidden',
        transition: 'max-height .2s ease',
        padding: '10px 14px',
      }}>
        <div ref={measureRef}>
          {plan ? <MarkdownRenderer text={plan} /> : <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>（无计划内容）</div>}
        </div>
        {/* 折叠态底部渐隐遮罩，暗示下方还有内容 */}
        {!expanded && collapsible && (
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: 48, pointerEvents: 'none',
            background: 'linear-gradient(to bottom, transparent, var(--surface-1))',
          }} />
        )}
      </div>
      {collapsible && (
        <div style={{ padding: '4px 14px 8px', textAlign: 'center' }}>
          <button onClick={() => setExpanded(v => !v)} style={{
            fontSize: 11, padding: '3px 12px', borderRadius: 5, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)',
          }}>
            {expanded ? '收起' : '展开全文'}
          </button>
        </div>
      )}
      {prompts.length > 0 && (
        <div style={{
          padding: '6px 14px 10px', borderTop: '1px solid var(--border-hair, var(--border))',
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        }}>
          <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>所需权限：</span>
          {prompts.map((p, i) => (
            <span key={i} style={{
              fontSize: 10.5, padding: '2px 7px', borderRadius: 4,
              background: 'var(--surface-2)', color: 'var(--text-muted)',
            }}>
              {p?.tool ? `${p.tool}` : ''}{p?.prompt ? `· ${p.prompt}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fa-f]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}
