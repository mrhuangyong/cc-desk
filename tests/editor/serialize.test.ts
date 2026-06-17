import { describe, it, expect } from 'vitest'
import { serializeForPrompt } from '../../src/renderer/editor/serialize'
import type { TipTapDocJSON } from '../../src/renderer/editor/types'

// 辅助：构造一个只含纯文本段落的 doc
function textDoc(text: string): TipTapDocJSON {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
// 辅助：构造含一个 skillChip 的段落
function skillDoc(label: string): TipTapDocJSON {
  return {
    type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '用' },
      { type: 'skillChip', attrs: { refId: 'src:' + label, label } },
      { type: 'text', text: '改' },
    ] }],
  }
}
// 辅助：构造含一个 fileChip 的段落
function fileDoc(refId: string, label: string): TipTapDocJSON {
  return {
    type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '看' },
      { type: 'fileChip', attrs: { refId, label } },
      { type: 'text', text: '这个' },
    ] }],
  }
}

describe('serializeForPrompt', () => {
  it('纯文本原样输出', () => {
    expect(serializeForPrompt(textDoc('你好'))).toBe('你好')
  })
  it('skillChip 展开为 Skill 锚点，夹在文本之间', () => {
    expect(serializeForPrompt(skillDoc('frontend-design'))).toBe('用请使用 Skill: frontend-design改')
  })
  it('fileChip 展开为 @绝对路径', () => {
    expect(serializeForPrompt(fileDoc('/abs/InputBar.tsx', 'InputBar.tsx'))).toBe('看@/abs/InputBar.tsx这个')
  })
  it('空 doc 返回空串', () => {
    expect(serializeForPrompt({ type: 'doc', content: [] })).toBe('')
  })
  it('null doc 返回空串', () => {
    expect(serializeForPrompt(null)).toBe('')
  })
  it('hardBreak 展开为换行', () => {
    const doc: TipTapDocJSON = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }] },
    ] }
    expect(serializeForPrompt(doc)).toBe('第一行\n第二行')
  })
  it('多个段落之间用换行分隔', () => {
    const doc: TipTapDocJSON = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
    ] }
    expect(serializeForPrompt(doc)).toBe('A\nB')
  })
  it('混合：命令纯文本 + 技能 chip + 文件 chip', () => {
    const doc: TipTapDocJSON = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '/review 用' },
      { type: 'skillChip', attrs: { refId: 's:fd', label: 'frontend-design' } },
      { type: 'text', text: '改' },
      { type: 'fileChip', attrs: { refId: '/x/InputBar.tsx', label: 'InputBar.tsx' } },
    ] }] }
    expect(serializeForPrompt(doc)).toBe('/review 用请使用 Skill: frontend-design改@/x/InputBar.tsx')
  })
})
