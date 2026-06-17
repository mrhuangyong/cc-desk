// src/renderer/editor/PromptEditor.tsx
// TipTap 编辑器封装：装配扩展、onUpdate→onDocChange、降级 textarea。
//
// 关键：editor 只初始化一次（useEditor 无 deps），allSlashItems / getCwd 的
// 最新值通过 ref 注入扩展——否则 deps 变化会重建 editor，重建间隙
// EditorContent 拿到未就绪的 editor 触发 'isEditable of undefined' 崩溃。
import { useEffect, useRef } from 'react'
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
  // ref 持有最新值，供只建一次的扩展闭包读取
  const slashItemsRef = useRef(allSlashItems)
  const getCwdRef = useRef(getCwd)
  useEffect(() => { slashItemsRef.current = allSlashItems }, [allSlashItems])
  useEffect(() => { getCwdRef.current = getCwd }, [getCwd])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      SkillChip,
      FileChip,
      // 扩展通过 getter 读最新值，editor 无需随 props 变化重建
      buildSlashExtension(() => slashItemsRef.current),
      buildFileExtension(() => getCwdRef.current()),
    ],
    content: doc ?? '',
    // 不设 immediatelyRender: true——它会与 React 18 StrictMode 的 double-mount 冲突，
    // 导致 editor 同步创建但 plugin views 未就绪时 EditorContent 读到 undefined.isEditable。
    // 异步初始化时 editor=null 一帧，由下方降级 textarea 兜底。
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
  })

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
