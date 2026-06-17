// src/renderer/editor/serialize.ts
// 把 TipTap doc 展开为提交给 Claude 的纯文本 prompt。
// chip → 文本：skillChip = "请使用 Skill: <label>"；fileChip = "@<refId>"。
// 这是输入态(doc)与展开态(prompt)的边界——所有 chip 在这里"塌缩"成文本。
import type { TipTapDocJSON, TipTapNodeJSON } from './types'

export function serializeForPrompt(doc: TipTapDocJSON | null): string {
  if (!doc || !Array.isArray(doc.content)) return ''
  // 顶层段落之间用换行分隔；空段落贡献一个空行占位（与多行输入一致）
  return doc.content.map(node => serializeBlock(node)).join('\n')
}

// 块级节点（paragraph 等）→ 其内联子节点拼接成的单行文本
function serializeBlock(node: TipTapNodeJSON): string {
  if (!node.content) return ''
  return node.content.map(inline => serializeInline(inline)).join('')
}

// 内联节点 → 文本片段
function serializeInline(node: TipTapNodeJSON): string {
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return '\n'
    case 'skillChip':
      return `请使用 Skill: ${node.attrs?.label ?? ''}`
    case 'fileChip':
      return `@${node.attrs?.refId ?? ''}`
    default:
      // 未知 inline 节点：忽略，不破坏序列化
      return ''
  }
}
