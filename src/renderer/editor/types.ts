// src/renderer/editor/types.ts
// TipTap / ProseMirror 文档的 JSON 形态（editor.getJSON() 的产物）。
// 用宽松类型，避免与 ProseMirror 内部类型耦合——序列化只关心结构。
export type TipTapDocJSON = {
  type: 'doc'
  content?: TipTapNodeJSON[]
}

export interface TipTapNodeJSON {
  type: string                  // 'paragraph' | 'text' | 'skillChip' | 'fileChip' | 'hardBreak' ...
  attrs?: Record<string, any>
  content?: TipTapNodeJSON[]
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
  text?: string
}

// / 菜单项（命令 + 技能 + 内置 混合）
export interface SlashMenuItem {
  kind: 'command' | 'skill' | 'builtin'
  id: string        // command: 'user:review'；skill: 'superpowers:frontend-design'；builtin: 'builtin:init'
  name: string      // command: '/review'（含斜杠）；skill: 'frontend-design'；builtin: '/init'
  desc: string
  builtinAction?: BuiltinAction   // 仅 builtin 有
}

// 内置命令的动作描述：渲染端据此分发到 handler
export type BuiltinAction =
  | { type: 'open-settings'; section: import('../types').SettingsSection }
  | { type: 'open-permission-menu' }
  | { type: 'clear-session' }
  | { type: 'compact' }
  | { type: 'show-cost' }
  | { type: 'init-project' }
  | { type: 'add-dir' }
  | { type: 'export-session' }
  | { type: 'show-status' }
  | { type: 'resume' }
  | { type: 'run-review' }
  | { type: 'insert-text' }
