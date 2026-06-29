// src/renderer/components/ContextUsageRing.tsx
// 输入框内的上下文用量进度环：模型选择按钮左侧。
// 数据来自 SDK getContextUsage control 命令（每轮对话结束主进程主动推送，缓存到 store）。
// 圆环按 percentage 填充，颜色随用量分级（绿→黄→红）。
// 点击圆环弹出自定义详情面板（非 tooltip——tooltip 容量太小，无法展示进度条与明细），
// 显示「上下文容量 X/Y（Z%）」+ 横向进度条 + 各 category 明细。点击外部/ESC 关闭。
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtTokens } from '../utils/format'
import { useI18n } from '../i18n/useI18n'
import type { ContextUsageInfo } from '../state/reducer'

interface Props {
  usage: ContextUsageInfo | null
  // 模型 contextLength（已解析为数字，token 数）；usage.maxTokens 缺失时兜底。
  maxContextFallback?: number
}

// 按占比选色：<60% 绿、60-85% 黄、>85% 红。
function colorFor(pct: number): string {
  if (pct >= 85) return '#ef4444' // red
  if (pct >= 60) return '#f59e0b' // amber
  return '#10b981' // green
}

// 解析模型的 contextLength 字符串（'200000' / '200K' / '20万'）为数字 token 数。
export function parseContextLength(raw?: string): number | undefined {
  if (!raw) return undefined
  const s = String(raw).trim()
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  const m = /^([\d.]+)\s*(k|m|千|万)?$/i.exec(s)
  if (m) {
    const n = parseFloat(m[1])
    const unit = m[2]?.toLowerCase()
    if (unit === 'k' || unit === '千') return Math.round(n * 1000)
    if (unit === 'm') return Math.round(n * 1000_000)
    if (unit === '万') return Math.round(n * 10000)
    return Math.round(n)
  }
  return undefined
}

// 中文友好的 token 量级格式：14.4万 / 100万 / 1234。与进度面板风格一致。
function fmtTokensCN(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  return fmtTokens(n)
}

export function ContextUsageRing({ usage, maxContextFallback }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)

  // 无数据：灰色空心环
  const hasData = !!(usage && typeof usage.totalTokens === 'number')
  const total = hasData ? usage!.totalTokens : 0
  // maxTokens:优先用模型配置的 contextLength(用户在模型设置里配的真实窗口大小),
  // 其次用 SDK 返回的 maxTokens(SDK 可能返回硬编码默认值如 200000,与实际模型不匹配)。
  const max = hasData
    ? (maxContextFallback && maxContextFallback > 0 ? maxContextFallback : (typeof usage!.maxTokens === 'number' && usage!.maxTokens > 0 ? usage!.maxTokens : total))
    : (maxContextFallback ?? 0)
  // percentage:用本地 max(模型 contextLength 优先)重算,不用 SDK 的 percentage(它基于 SDK maxTokens)。
  const pct = hasData
    ? (max > 0 ? Math.min(100, (total / max) * 100) : 0)
    : 0
  const color = colorFor(pct)

  // ESC 关闭面板
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // 圆环几何
  const r = 6
  const c = 2 * Math.PI * r
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c

  return (
    <>
      <span
        ref={triggerRef}
        onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', width: 16, height: 16, cursor: 'pointer' }}
        aria-label={t('contextUsage.title')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r={r} fill="none" stroke="var(--text-faint)" strokeWidth="2" opacity={hasData ? 0.25 : 0.4} />
          {hasData && (
            <circle
              cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="2"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeLinecap="round"
              transform="rotate(-90 8 8)"
            />
          )}
        </svg>
      </span>
      {open && triggerRef.current && (
        <ContextUsagePanel
          anchor={triggerRef.current}
          hasData={hasData}
          total={total}
          max={max}
          pct={pct}
          color={color}
          categories={usage?.categories}
          onClose={() => setOpen(false)}
          title={t('contextUsage.title')}
          unknownLabel={t('contextUsage.unknown')}
          capacityLabel={t('contextUsage.capacity')}
        />
      )}
    </>
  )
}

// 自定义详情面板：定位在圆环上方，宽度足够显示进度条与明细。
// 用 createPortal 渲染到 body，逃离输入框的 overflow/拖拽区。
interface PanelProps {
  anchor: HTMLElement
  hasData: boolean
  total: number
  max: number
  pct: number
  color: string
  categories?: ContextUsageInfo['categories']
  onClose: () => void
  title: string
  unknownLabel: string
  capacityLabel: string
}

function ContextUsagePanel({ anchor, hasData, total, max, pct, color, categories, onClose, title, unknownLabel, capacityLabel }: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // 定位：面板右下角对齐圆环左上角（向上向左展开），避免超出视口右侧。
  // 不用固定 PH 预估高度（空会话面板矮，固定高度导致弹窗离圆环太远）。
  // 首次渲染用 visibility:hidden 占位(不 return null,否则 ref 永远 null → 死循环),
  // ref 挂载后测实际高度再定位 + 设可见。
  useEffect(() => {
    if (!panelRef.current) return
    const rect = anchor.getBoundingClientRect()
    const panelHeight = panelRef.current.offsetHeight
    const PW = 320
    let left = rect.right - PW
    let top = rect.top - panelHeight - 8
    if (top < 8) top = rect.bottom + 8 // 上方放不下则向下
    if (left < 8) left = 8
    setPos({ left, top })
  }, [anchor, hasData, total, max, pct])

  // 点击面板外部关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [anchor, onClose])

  const cats = (categories ?? []).filter(cat => cat.tokens > 0).sort((a, b) => b.tokens - a.tokens)

  return createPortal(
    <>
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: pos ? pos.left : -9999, // 未定位时移出视区(但仍渲染,让 ref 可测高度)
          top: pos ? pos.top : 0,
          visibility: pos ? 'visible' : 'hidden',
          width: 320,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-float)',
          padding: 14, zIndex: 99999, fontSize: 12, color: 'var(--text)',
        }}
      >
        {/* 标题行 + 容量数值 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontWeight: 600 }}>{capacityLabel}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: hasData ? 'var(--text)' : 'var(--text-muted)' }}>
            {hasData ? `${fmtTokensCN(total)}/${fmtTokensCN(max)}（${Math.round(pct)}%）` : unknownLabel}
          </span>
        </div>
        {/* 横向进度条 */}
        <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-hover)', overflow: 'hidden', marginBottom: cats.length ? 12 : 0 }}>
          {hasData && (
            <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
          )}
        </div>
        {/* 各 category 明细 */}
        {cats.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cats.map((cat, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {cat.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: cat.color, display: 'inline-block' }} />}
                  {cat.name}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtTokens(cat.tokens)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
