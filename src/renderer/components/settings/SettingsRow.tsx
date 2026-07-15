import type { ReactNode } from 'react'

// 卡片内的一行设置项：左侧标题+描述，右侧控件。
// 用 borderBottom 分隔；最后一行由父组件传 noBorder 去掉分割线。
interface Props {
  title: ReactNode
  desc?: ReactNode
  children: ReactNode  // 右侧控件
  noBorder?: boolean
}

export function SettingsRow({ title, desc, children, noBorder }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 16px',
      borderBottom: noBorder ? 'none' : '1px solid var(--border)'
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--text)', fontSize: 13 }}>{title}</div>
        {desc && <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}
