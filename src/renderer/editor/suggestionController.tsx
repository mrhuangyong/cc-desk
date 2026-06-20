// src/renderer/editor/suggestionController.tsx
// / 和 @ 共用的 Suggestion render controller 工厂。
// 职责：创建浮层 div → ReactDOM render SuggestionMenu → 维护选中索引 → 处理 ↑↓/Enter/Esc。
import { createRoot, type Root } from 'react-dom/client'
import type { EditorView } from '@tiptap/pm/view'
import { SuggestionMenu } from '../components/blocks/SuggestionMenu'
import type { SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { ReactNode } from 'react'

interface Options<T> {
  renderItem: (item: T, selected: boolean) => ReactNode
  emptyHint?: string
  buildFooter?: (items: T[]) => ReactNode
  groupKey?: (item: T) => string                  // 分组键（相同键的连续项归一组，组间分隔线）
  groupLabel?: (key: string) => ReactNode | null  // 组标题（null 则只画分隔线）
  // Tab 补全（可选）：Tab 只补全到输入框，不执行命令/不触发副作用。
  // 不提供时 Tab 退化为与 Enter 一致（走 command）。
  onTabComplete?: (item: T, view: EditorView, range: { from: number; to: number }) => boolean
}

export function makeSuggestionController<T>(opts: Options<T>) {
  let popupEl: HTMLDivElement | null = null
  let root: Root | null = null
  let items: T[] = []
  let sel = 0
  let clientRect: (() => DOMRect | null) | null = null
  let command: ((item: T) => void) | null = null

  const render = () => {
    if (!root) return
    root.render(
      <SuggestionMenu<T>
        items={items}
        selectedIndex={sel}
        clientRect={clientRect}
        renderItem={opts.renderItem}
        emptyHint={opts.emptyHint}
        footer={opts.buildFooter?.(items)}
        onSelectIdx={(i) => { if (command && items[i]) command(items[i]) }}
        onHover={(i) => { sel = i; render() }}
        groupKey={opts.groupKey}
        groupLabel={opts.groupLabel}
      />,
    )
  }

  return {
    onStart: (p: any) => {
      items = p.items; sel = 0; clientRect = p.clientRect; command = p.command
      popupEl = document.createElement('div')
      document.body.appendChild(popupEl)
      root = createRoot(popupEl)
      render()
    },
    onUpdate: (p: any) => {
      items = p.items; sel = 0; clientRect = p.clientRect; command = p.command
      render()
    },
    onKeyDown: (p: SuggestionKeyDownProps) => {
      if (items.length === 0) return false
      if (p.event.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; render(); return true }
      if (p.event.key === 'ArrowDown') { sel = (sel + 1) % items.length; render(); return true }
      if (p.event.key === 'Enter') {
        if (command && items[sel]) { command(items[sel]); return true }
      }
      if (p.event.key === 'Tab') {
        if (!items[sel]) return false
        // Tab 默认是焦点跳转：不拦会从编辑器移走焦点。
        p.event.preventDefault()
        // 有 Tab 补全钩子时只补全（不执行命令/副作用），否则退化为与 Enter 一致。
        if (opts.onTabComplete) {
          return opts.onTabComplete(items[sel], p.view, p.range)
        }
        if (command) { command(items[sel]); return true }
      }
      return false
    },
    onExit: () => {
      root?.unmount(); root = null
      if (popupEl) { popupEl.remove(); popupEl = null }
      items = []; sel = 0; clientRect = null; command = null
    },
  }
}
