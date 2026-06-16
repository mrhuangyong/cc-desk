import type { ReactNode } from 'react'

// 设置卡片：带边框的分组容器，内含若干设置项（children）。
// 每个设置项用 SettingsRow（标题+描述+右侧控件）。
interface Props {
  children: ReactNode
}

export function SettingsCard({ children }: Props) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      background: 'var(--bg-elevated)', overflow: 'hidden'
    }}>
      {children}
    </div>
  )
}
