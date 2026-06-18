// src/renderer/editor/PromptEditor.tsx
// TipTap 编辑器封装：装配扩展、onUpdate→onDocChange、降级 textarea。
//
// editor 只初始化一次（useEditor 无 deps），allSlashItems / getCwd 的
// 最新值通过 ref 注入扩展。
//
// 已知 TipTap v3 bug：@tiptap/extensions viewport plugin 在 editor 初始化时
// 会触发一次 "Cannot destructure property 'isEditable' of 'editor'" 错误。
// 这是 viewport plugin 的 createViewportPluginView 在 EditorView.updatePluginViews
// 期间 dispatch，触发 @tiptap/suggestion Plugin.apply 但 editor 未就绪的竞态。
// 错误是非致命的，editor 最终正常工作。production build 无此噪音。
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
  onPasteFiles?: (files: File[]) => void
  onSend?: () => void            // Enter（无 Shift）触发发送
  onBuiltinRun?: (item: SlashMenuItem) => void   // 内置命令选中回调
  onEditorReady?: (editor: any) => void           // 暴露 editor 实例给父组件（用于插文本）
}

export function PromptEditor({ doc, placeholder, allSlashItems, getCwd, onDocChange, onPasteFiles, onSend, onBuiltinRun, onEditorReady }: Props) {
  const slashItemsRef = useRef(allSlashItems)
  const getCwdRef = useRef(getCwd)
  const onSendRef = useRef(onSend)
  const onBuiltinRunRef = useRef(onBuiltinRun)
  useEffect(() => { slashItemsRef.current = allSlashItems }, [allSlashItems])
  useEffect(() => { getCwdRef.current = getCwd }, [getCwd])
  useEffect(() => { onSendRef.current = onSend }, [onSend])
  useEffect(() => { onBuiltinRunRef.current = onBuiltinRun }, [onBuiltinRun])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      SkillChip,
      FileChip,
      buildSlashExtension(() => slashItemsRef.current, (item) => onBuiltinRunRef.current?.(item)),
      buildFileExtension(() => getCwdRef.current()),
    ],
    content: doc ?? '',
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length > 0) {
          onPasteFiles?.(files)
          return true
        }
        return false
      },
      handleKeyDown: (_view, event) => {
        // Enter（无 Shift）发送；Shift+Enter 换行。
        // suggestion 菜单打开时，suggestion 的 onKeyDown 会先消费 Enter 并返回 true，
        // 不会走到这里，所以菜单里按 Enter 是确认选项而非发送。
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault()
          onSendRef.current?.()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      onDocChange(editor.getJSON() as TipTapDocJSON)
    },
  })

  // 外部 doc 变化（切会话恢复 / 发送后清空）→ 同步进编辑器，避免 onUpdate 回环。
  // doc 为 null 时（发送后 reducer 把 draft.doc 置 null）也要清空 editor。
  useEffect(() => {
    if (!editor) return
    if (!doc) {
      // 发送后清空：仅当 editor 非空时才清，避免空 setContent 循环
      if (editor.getText() !== '' || editor.getJSON().content?.length > 1) {
        editor.commands.clearContent(false)
      }
      return
    }
    const cur = JSON.stringify(editor.getJSON())
    if (cur !== JSON.stringify(doc)) editor.commands.setContent(doc, { emitUpdate: false })
  }, [doc, editor])

  // editor 初始化后回调一次（暴露给父组件用于插文本等）
  useEffect(() => { if (editor) onEditorReady?.(editor) }, [editor, onEditorReady])

  // 降级：editor 初始化失败 → 原生 textarea
  if (!editor) {
    return (
      <textarea
        value={doc?.content?.[0]?.content?.[0]?.text ?? ''}
        onChange={e => onDocChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }] } as TipTapDocJSON)}
        placeholder={placeholder}
        rows={1}
        style={{ width: '100%', minHeight: 48, padding: '14px 16px 8px', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, resize: 'none', boxSizing: 'border-box' }}
      />
    )
  }

  return <EditorContent editor={editor} />
}
