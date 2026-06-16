import type { CSSProperties } from 'react'
import { useStore } from '../../state/store'
import { SettingsMenu } from './SettingsMenu'
import { GeneralSettings } from './GeneralSettings'
import { CodePreviewSettings } from './CodePreviewSettings'
import { ModelSettings } from './ModelSettings'
import { SkillsSettings } from './SkillsSettings'
import { McpSettings } from './McpSettings'
import { PluginSettings } from './PluginSettings'
import { CommandSettings } from './CommandSettings'
import { HooksSettings } from './HooksSettings'

// WebkitAppRegion 是 Electron/WebKit CSS 属性，React CSSProperties 未收录，定义局部超集
type DragStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }
const drag: DragStyle = { WebkitAppRegion: 'drag' }

export function SettingsPage() {
  const { state } = useStore()
  const section = state.activeSettingsSection

  const renderSection = () => {
    switch (section) {
      case 'general': return <GeneralSettings />
      case 'code-preview': return <CodePreviewSettings />
      case 'model': return <ModelSettings />
      case 'skills': return <SkillsSettings />
      case 'mcp': return <McpSettings />
      case 'plugins': return <PluginSettings />
      case 'commands': return <CommandSettings />
      case 'hooks': return <HooksSettings />
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>
      <SettingsMenu />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 顶部拖动条：让设置页可拖动窗口（高度覆盖红绿灯区，透明） */}
        <div style={{ height: 36, flexShrink: 0, ...drag }} />
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {renderSection()}
        </div>
      </div>
    </div>
  )
}
