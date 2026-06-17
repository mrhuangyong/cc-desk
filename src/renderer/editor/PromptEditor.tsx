// src/renderer/editor/PromptEditor.tsx
// TipTap 编辑器封装：装配扩展、onUpdate→onDocChange、降级 textarea。
import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { SkillChip } from './SkillChip'
import { FileChip } from './FileChip'
import { buildSlashExtension } from './SlashSuggestion'
import { buildFileExtension } from './FileSuggestion'
import type { SlashMenuItem, TipTapDocJSON } from './types'

interface Props {
  doc: TipTapDocJSON | null
  placeholder: string
  allSlashItems: SlashMenuItem[]
  getCwd: () => string
  onDocChange: (doc: TipTapDocJSON) => void
  onPasteFiles?: (files: File[]) => void   // 粘贴的图片/文件走附件通道
}

export function PromptEditor({ doc, placeholder, allSlashItems, getCwd, onDocChange, onPasteFiles }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      SkillChip,
      FileChip,
      buildSlashExtension(allSlashItems),
      buildFileExtension(getCwd),
    ],
    content: doc ?? '',
    // Electron 是纯 CSR，同步初始化避免首帧 editor=null 闪烁。
    immediatelyRender: true,
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length > 0) {
          onPasteFiles?.(files)
          return true   // 拦截：不交给 TipTap 当文本粘贴
        }
        return false    // 交 TipTap 处理文本
      },
    },
    onUpdate: ({ editor }) => {
      onDocChange(editor.getJSON() as TipTapDocJSON)
    },
  }, [allSlashItems, getCwd])   // 菜单/工作区变化时重建扩展

  // 外部 doc 变化（切会话恢复）→ 同步进编辑器，避免 onUpdate 回环
  useEffect(() => {
    if (editor && doc) {
      const cur = JSON.stringify(editor.getJSON())
      if (cur !== JSON.stringify(doc)) editor.commands.setContent(doc, { emitUpdate: false })
    }
  }, [doc, editor])

  // 降级：editor 初始化失败 → 原生 textarea（纯文本，无法 chip）
  if (!editor) {
    return (
      <textarea
        value={doc?.content?.[0]?.content?.[0]?.text ?? ''}
        onChange={e => onDocChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }] } as TipTapDocJSON)}
        placeholder={placeholder + '（降级模式）'}
        rows={1}
        style={{ width: '100%', minHeight: 48, padding: '14px 16px 8px', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, resize: 'none', boxSizing: 'border-box' }}
      />
    )
  }

  return <EditorContent editor={editor} />
}
