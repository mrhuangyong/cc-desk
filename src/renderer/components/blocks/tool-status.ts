// src/renderer/components/blocks/tool-status.ts
// 工具状态三件套（状态色映射 + hex→rgba + pulse 动画）：
// ToolUseCard / ToolGroup / MetaToolCard 三者原本各自复制一份，
// 现统一在此，避免改一处忘改另两处（status 色 / 动画语义漂移）。

// 三态：running 进行中（琥珀脉冲）/ error 出错（红）/ done 完成（绿）。
export type ToolStatus = 'running' | 'error' | 'done'

export const STATUS_COLOR: Record<ToolStatus, string> = {
  running: 'var(--status-warn, #d97706)',
  error: 'var(--danger)',
  done: 'var(--status-ok, #16a34a)',
}

// 把任意工具块的 raw status 字符串收敛到三态。
export function deriveToolStatus(raw: string | undefined): ToolStatus {
  if (raw === 'running') return 'running'
  if (raw === 'error') return 'error'
  return 'done'
}

// 把 #rrggbb 转成 rgba（用于 running 态光晕）。非 # 格式原样返回（兼容 CSS 变量回退值）。
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

// running 态脉冲动画的 keyframes（三处组件都注入同名 keyframes，统一字符串）。
export const PULSE_KEYFRAMES = `@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }`

// running 态光晕 box-shadow（0.18 透明度，与原三处一致）。
export function runningGlow(color: string): string {
  return `0 0 0 3px ${hexToRgba(color, 0.18)}`
}
