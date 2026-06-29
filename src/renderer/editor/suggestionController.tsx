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

// 模块级:当前 active 的 suggestion controller 的「确认选中项」函数。
// 同一时刻只有一个菜单 active(输入框聚焦时)。供 isSuggestionActive / confirmActiveSuggestion 查询,
// 让 PromptEditor 的 handleKeyDown 在 Enter 到达编辑器默认处理(会先破坏 suggestion active 态)之前,
// 先判断菜单是否打开并补全——绕过 TipTap/ProseMirror 对 Enter 的时序坑。
let activeConfirm: (() => boolean) | null = null

// suggestion 菜单是否打开(供编辑器 keydown 检测)
export function isSuggestionActive(): boolean {
  return activeConfirm !== null
}

// 确认当前 suggestion 选中项(补全)。返回 true 表示有菜单且已处理。
export function confirmActiveSuggestion(): boolean {
  return activeConfirm ? activeConfirm() : false
}

export function makeSuggestionController<T>(opts: Options<T>) {
  let popupEl: HTMLDivElement | null = null
  let root: Root | null = null
  let items: T[] = []
  let sel = 0
  let clientRect: (() => DOMRect | null) | null = null
  let command: ((item: T) => void) | null = null

  // 确认当前选中项(Enter/Tab 补全)。返回 true 表示有菜单且已处理。
  const confirmSelected = (): boolean => {
    if (command && items[sel]) { command(items[sel]); return true }
    return false
  }
  // 本实例在模块级 activeConfirm 的 token(onExit 时只清自己的,避免误清其他 controller)
  const myToken = confirmSelected

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
      // 注册为当前 active 的 controller(同一时刻只有一个菜单),供模块级 confirmActiveSuggestion 调用
      activeConfirm = confirmSelected
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
        if (command && items[sel]) {
          // 与 Tab 对齐:阻止 Enter 的 DOM 默认行为(contenteditable 换行/触发发送链路)。
          // 否则 command 执行后 Enter 默认行为仍会冒泡,导致未补全就发送(用户反馈的 bug)。
          p.event.preventDefault()
          command(items[sel]); return true
        }
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
      // 只清自己的(避免误清同时 active 的其他 controller)
      if (activeConfirm === myToken) activeConfirm = null
    },
  }
}
