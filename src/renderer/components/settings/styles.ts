// src/renderer/components/settings/styles.ts
// settings 页共享的样式常量。只收录跨多文件字节级一致的样式（避免收录有变体的样式
// 导致样式回归）：
//   - segBtn: 4 文件（PluginSettings/McpSettings/HooksSettings/CommandSettings）完全相同
//   - iconBtn: 3 文件（PluginSettings/McpSettings/CommandSettings）完全相同
// primaryBtn/inputStyle 等因各文件有变体（透明 vs 实心、单行 vs 多行），保留各文件本地定义。
import type { CSSProperties } from 'react'

// 分段切换按钮（active 态 accent 实心）。padding/字号/圆角与原 4 文件一致。
export const segBtn = (active: boolean): CSSProperties => ({
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
  marginRight: 4,
})

// 图标按钮（透明、无边框、muted 色）。行内操作图标共用。
export const iconBtn: CSSProperties = {
  padding: '4px 6px', fontSize: 13, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1,
}
