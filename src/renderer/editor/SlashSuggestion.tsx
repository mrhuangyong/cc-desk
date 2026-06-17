// src/renderer/editor/SlashSuggestion.tsx
// / 触发：命令（插纯文本）+ 技能（插 skillChip）混合菜单。
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { filterSlashItems } from './slashFilter'
import { makeSuggestionController } from './suggestionController'
import { Command as CommandIcon, Sparkles } from 'lucide-react'
import type { SlashMenuItem } from './types'

export function buildSlashExtension(allItems: SlashMenuItem[]): Extension {
  return Extension.create({
    name: 'slashSuggestion',
    addOptions() {
      return {
        suggestion: {
          char: '/',
          startOfLine: false,
          allowSpaces: false,
          // v3: items 接收 { query, editor, signal }；我们只用 query
          items: ({ query }: { query: string }) => filterSlashItems(allItems, query),
          command: ({ editor, range, props }: { editor: any; range: any; props: SlashMenuItem }) => {
            editor.chain().focus().deleteRange(range).run()
            if (props.kind === 'command') {
              editor.chain().focus().insertContent(props.name + ' ').run()
            } else {
              editor.chain().focus().insertContent({
                type: 'skillChip',
                attrs: { refId: props.id, label: props.name.replace(/^\//, '') },
              }).insertContent(' ').run()
            }
          },
          render: () => makeSuggestionController<SlashMenuItem>({
            renderItem: (item, _selected) => {
              const isCmd = item.kind === 'command'
              const Icon = isCmd ? CommandIcon : Sparkles
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <Icon size={13} />
                  <span>{item.name}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</span>
                </span>
              )
            },
            emptyHint: '无可用命令/技能',
          }),
        },
      }
    },
    addProseMirrorPlugins() {
      return [Suggestion(this.options.suggestion as any)]
    },
  })
}
