// src/renderer/editor/SlashSuggestion.tsx
// / 触发：命令（插纯文本）+ 技能（插 skillChip）混合菜单。
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { filterSlashItems } from './slashFilter'
import { makeSuggestionController } from './suggestionController'
import { Command as CommandIcon, Sparkles } from 'lucide-react'
import type { SlashMenuItem } from './types'

// 独立 pluginKey：多个 Suggestion 扩展（/ 和 @）必须各有独立 key，
// 否则 ProseMirror 报 "Adding different instances of a keyed plugin (suggestion$)"。
const slashPluginKey = new PluginKey('slashSuggestion')

export function buildSlashExtension(getItems: () => SlashMenuItem[], onBuiltinRun?: (item: SlashMenuItem) => void): Extension {
  return Extension.create({
    name: 'slashSuggestion',
    addOptions() {
      return {
        suggestion: {
          pluginKey: slashPluginKey,
          char: '/',
          startOfLine: false,
          allowSpaces: false,
          // v3: items 接收 { query, editor, signal }；我们只用 query。
          // 通过 getter 读最新列表，避免闭包捕获初始空数组。
          items: ({ query }: { query: string }) => filterSlashItems(getItems(), query),
          command: ({ editor, range, props }: { editor: any; range: any; props: SlashMenuItem }) => {
            // 单次 chain：删触发符 + 插内容，避免两次 run() 间光标/placeholder 状态异常
            const chain = editor.chain().focus().deleteRange(range)
            if (props.kind === 'builtin') {
              // 内置命令：删触发符，不插内容；副作用交给渲染端 handler
              chain.run()
              onBuiltinRun?.(props)
              return
            }
            if (props.kind === 'command') {
              chain.insertContent(props.name + ' ').run()
            } else {
              chain.insertContent({
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
                  <Icon size={13} style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, flexShrink: 0 }}>{item.name}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</span>
                </span>
              )
            },
            emptyHint: '无可用命令/技能',
            groupKey: (item) => item.kind,
            groupLabel: (key) => key === 'builtin' ? '内置' : key === 'command' ? '命令' : '技能',
          }),
        },
      }
    },
    addProseMirrorPlugins() {
      // v3 要求显式传 editor 给 Suggestion（v2 自动从 context 取）
      return [Suggestion({ ...this.options.suggestion, editor: this.editor } as any)]
    },
  })
}
