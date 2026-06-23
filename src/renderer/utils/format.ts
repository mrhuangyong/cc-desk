// src/renderer/utils/format.ts
// 通用的数值/时长格式化（token 数、毫秒时长），供悬浮面板的 subagent/backend-task 展示复用。
// 原 fmtTokens/fmtDuration 在 SubagentDetailDrawer 内联定义、SubagentCard 又复制了一份行内逻辑，
// 现统一抽取，避免两处分叉。

// token 数：<1k 显示原值，>=1k 显示如 12.3k；0/undefined 显示 '-'。
export function fmtTokens(n?: number): string {
  if (!n) return '-'
  if (n < 1000) return `${n}`
  return `${(n / 1000).toFixed(1)}k`
}

// 毫秒时长：<1s 显示 ms，<1min 显示 s，否则显示分钟；0/undefined 显示 '-'。
export function fmtDuration(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}
