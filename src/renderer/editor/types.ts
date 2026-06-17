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

// / 菜单项（命令 + 技能混合）
export interface SlashMenuItem {
  kind: 'command' | 'skill'
  id: string        // command: 'user:review'；skill: 'superpowers:frontend-design'
  name: string      // command: '/review'（含斜杠）；skill: 'frontend-design'
  desc: string
}

// @ 菜单项（文件/目录）
export interface FileMenuItem {
  kind: 'dir' | 'file'
  name: string      // 条目名（不含路径）
  absPath: string   // 绝对路径
}
