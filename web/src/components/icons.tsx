// web/src/components/icons.tsx
// 内联 SVG 线性图标库（统一风格）。
//
// 设计约定（保持视觉一致性）：
// - 全部 stroke 描边、无 fill（fill="none"），用 currentColor 继承文字色。
// - stroke-width 统一 1.75（细线，工具感），linecap/linejoin round（柔和不刺）。
// - viewBox 0 0 24 24，size 由 props.size 控制（默认跟随字号，多数场景用 1em）。
// - 不引外部图标库（Musk Algorithm：手机端首屏体积敏感，能不引就不引）。
//
// 替换原各处 emoji（📁🔧📋🗑✓☾☀ 等）——emoji 跨系统渲染不一、不够专业。
import React from 'react'

export interface IconProps {
  size?: number | string
  className?: string
}

const base = (size: number | string, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
})

/** 项目/文件夹。 */
export function FolderIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  )
}

/** 展开箭头（向下，配合 rotate 表达折叠态）。 */
export function ChevronDownIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** 右箭头（会话行进入）。 */
export function ChevronRightIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** 新建 / 加号。 */
export function PlusIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** 纸飞机发送。 */
export function SendIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  )
}

/** 左箭头（返回）。 */
export function ArrowLeftIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  )
}

/** 扳手（工具调用 tool_use）。 */
export function WrenchIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17v3h3l5.5-5.5a4 4 0 0 0 5.2-5.2l-2.3 2.3-2-2 2.3-2.3Z" />
    </svg>
  )
}

/** 勾（结果 tool_result / 成功）。 */
export function CheckIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/** 列表/计划清单（plan）。 */
export function ListIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}

/** 垃圾桶（归档）。 */
export function TrashIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
    </svg>
  )
}

/** 太阳（亮色）。 */
export function SunIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

/** 月亮（暗色）。 */
export function MoonIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  )
}

/** 方块（停止/中断）。 */
export function SquareIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

/** cc-desk 标记（配对页 logo，几何抽象「命令台」）。 */
export function CommandMarkIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      {/* 圆角方框 + 中心十字交叉，呼应 command 键与控制台 */}
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 9h6v6H9z" />
    </svg>
  )
}

/** 向下箭头（回到底部）。 */
export function ArrowDownIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  )
}

export function ArrowRightIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

/** 转圈（工具执行中 running）。CSS .icon-spin 驱动旋转动画。 */
export function SpinnerIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)} className={`icon-spin${className ? ` ${className}` : ''}`}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

/** 错误（工具执行失败 error）。 */
export function ErrorIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 8v5M12 16.5v.5" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

/** 盾牌（权限请求）。 */
export function ShieldIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

/** 问号（提问）。 */
export function QuestionIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}

/** 关闭（模态关闭）。 */
export function CloseIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

/** 大脑（思考强度）。 */
export function BrainIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      {/* 简化脑形：左右两半 + 沟回，表达"思考" */}
      <path d="M9 4.5a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0-1.5 4.5 2.5 2.5 0 0 0 1 4 2.5 2.5 0 0 0 3 .5V4.5Z" />
      <path d="M15 4.5a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1 1.5 4.5 2.5 2.5 0 0 1-1 4 2.5 2.5 0 0 1-3 .5V4.5Z" />
    </svg>
  )
}

/** 盒子/CPU（模型）。 */
export function ChipIcon({ size = '1em', className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  )
}
