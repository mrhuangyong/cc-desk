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

// 「引用型」内置命令：选中后插入 /name 文本到输入框，发送时才执行（doSend 识别）。
// 其余内置命令（打开设置/菜单、清空会话、费用/状态、压缩、resume）是即时 UI 操作，
// 选中即执行（onBuiltinRun），引用无意义。
const REFERABLE_BUILTIN_ACTIONS = new Set(['init-project', 'export-session', 'add-dir'])
function isReferableBuiltin(item: SlashMenuItem): boolean {
  return item.kind === 'builtin' && !!item.builtinAction && REFERABLE_BUILTIN_ACTIONS.has(item.builtinAction.type)
}

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
              if (isReferableBuiltin(props)) {
                // 引用型（/init /export /add-dir）：插 /name 文本，发送时才执行
                chain.insertContent(props.name + ' ').run()
              } else {
                // 即时 UI 型：删触发符，立即执行（副作用交给渲染端 handler）
                chain.run()
                onBuiltinRun?.(props)
              }
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
            // 不传 onTabComplete：Tab 与 Enter/点击走同一条 command 路径（skill 插 skillChip、
            // command 插纯文本、builtin 执行），保证 Tab 也能富填充 chip（而非丢 / 的纯文本）。
            // suggestionController 在无 onTabComplete 时 fallback 到 command(items[sel]) 并 return true，
            // 拦截 Tab 不冒泡到 handleKeyDown 触发发送。
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
