# 悬浮任务面板重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右侧悬浮任务面板从「钉死在右上、三分区各自折叠、永久遮挡对话区」改造为「一个可任意拖动的图标/面板，整体折叠，分区有数据才显示，位置可记忆」。

**Architecture:** 新增 `useDraggable` hook（pointer 事件 + ref/rAF 跟手，参考 `useResizableWidth`）。`BackendTaskPanel` 重构为单一图标↔面板形态，位置由 hook 管理。三个分区卡片去掉自带折叠头，改静态标题行。位置记忆走 settings（新增 `rememberPanelPosition` + `panelPosition` 字段）。

**Tech Stack:** React + TypeScript + Electron；vitest 测试；electron-store 持久化。

## Global Constraints

- IPC 契约：新增设置字段需同时改 `src/renderer/types.ts` 的 `AppSettings` 和 `src/main/settings-store.ts` 的 `AppSettings` + `defaults` + `withDefaults`（两处定义必须一致，CLAUDE.md 约定）。
- i18n 两语言对齐：新增/删除 key 必须在 `src/renderer/i18n/index.ts` 的 zh-CN 和 en 两边同步（有 `i18n-completeness.test.ts` 校验）。
- reducer 改动需同步更新 `tests/reducer.test.ts` 的 `initialState()` 全字段构造。
- 拖动 hook 测试在 jsdom：jsdom 无真实布局，`getBoundingClientRect` 返回 0，需用 mock 或基于 `window.innerWidth/innerHeight`（jsdom 默认 1024×768）。
- 不改任务/子代理/后台的数据来源与 reducer 数据结构，只改承载 UI。
- 频繁提交（每个 task 结束 commit）。
- 命令用项目脚本：`npx vitest run <file>` 跑单测，`npx tsc --noEmit` 类型检查。

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/renderer/hooks/useDraggable.ts`（新建） | 通用 pointer 拖动 hook：管理 `{x,y}` 位置，拖动期 ref+rAF 改 DOM，pointerup 同步 state，含视口 clamp 与点击/拖动判定。 |
| `src/renderer/components/FoldBadge.tsx`（已存在） | 数量角标，折叠图标复用。 |
| `src/renderer/components/BackendTaskPanel.tsx`（重写） | 单一图标↔面板形态，接 useDraggable，渲染有数据的分区。 |
| `src/renderer/components/TaskPanel.tsx`（改 TaskCard） | 去折叠头，改静态标题行。 |
| `src/renderer/components/SubagentCard.tsx`（改） | 同上。 |
| `src/renderer/components/BackendTaskCard.tsx`（改） | 同上。 |
| `src/renderer/components/TitleBar.tsx`（改） | 去掉 ListChecks 面板开关。 |
| `src/renderer/components/settings/GeneralSettings.tsx`（改） | 加「记住任务面板位置」Toggle。 |
| `src/renderer/types.ts` + `src/main/settings-store.ts` | AppSettings 加 `rememberPanelPosition` + `panelPosition`。 |
| `src/renderer/state/reducer.ts` + `actions.ts` + `store.tsx` | `panelFold` 简化为 `{ root: boolean }`；加 `SET_PANEL_POSITION`。 |
| `tests/useDraggable.test.ts`（新建） | 拖动 hook 单测。 |
| `tests/BackendTaskPanel.test.tsx`（重写） | 测整体折叠 + 有数据才显示。 |
| `tests/reducer.test.ts` / `tests/blocks-reducer.test.ts` / `tests/backend-task-clear.test.ts` | 同步 `panelFold` 字段简化。 |

---

### Task 1: useDraggable hook（新建 + 测试）

**Files:**
- Create: `src/renderer/hooks/useDraggable.ts`
- Test: `tests/useDraggable.test.ts`

**Interfaces:**
- Produces: `useDraggable(opts: { initial: { x: number; y: number }; onChange?: (pos: { x: number; y: number }) => void; size: { width: number; height: number }; margin?: number })` returns `{ ref, position, dragging, onPointerDown, setPosition }`
  - `ref`：绑到被拖动元素的 React ref（`HTMLDivElement`）。
  - `position`：当前 `{x, y}`（React state，pointerup 后更新）。
  - `dragging`：是否正在拖动。
  - `onPointerDown`：绑到拖动把手（图标或标题条）的 `onPointerDown`。
  - `setPosition`：外部直接设位置（如从 settings 恢复）。
  - 拖动判定：pointer 累计位移 < 3px → 视为点击（不更新位置，由调用方决定展开/折叠）；≥ 3px → 拖动（更新位置）。

- [ ] **Step 1: 写失败的测试**

```ts
// tests/useDraggable.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraggable } from '../src/renderer/hooks/useDraggable'

describe('useDraggable', () => {
  beforeEach(() => {
    // jsdom 内部尺寸默认 1024×768
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 768 })
  })

  it('初始位置 = initial，未拖动', () => {
    const { result } = renderHook(() => useDraggable({ initial: { x: 100, y: 50 }, size: { width: 36, height: 36 } }))
    expect(result.current.position).toEqual({ x: 100, y: 50 })
    expect(result.current.dragging).toBe(false)
  })

  it('setPosition 更新位置', () => {
    const { result } = renderHook(() => useDraggable({ initial: { x: 0, y: 0 }, size: { width: 36, height: 36 } }))
    act(() => result.current.setPosition({ x: 200, y: 100 }))
    expect(result.current.position).toEqual({ x: 200, y: 100 })
  })

  it('拖动超过阈值更新位置并触发 onChange', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useDraggable({ initial: { x: 100, y: 100 }, size: { width: 36, height: 36 }, onChange }))
    // 模拟 pointer 序列：down → move(位移 50) → up
    act(() => {
      result.current.onPointerDown({ clientX: 100, clientY: 100 } as any)
    })
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 100 }))
    })
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 100 }))
    })
    expect(result.current.dragging).toBe(false)
    // 位置应从 100 移到 150
    expect(result.current.position.x).toBe(150)
    expect(onChange).toHaveBeenCalledWith({ x: 150, y: 100 })
  })

  it('位移小于阈值不更新位置（视为点击）', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() => useDraggable({ initial: { x: 100, y: 100 }, size: { width: 36, height: 36 }, onChange }))
    act(() => result.current.onPointerDown({ clientX: 100, clientY: 100 } as any))
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 102, clientY: 101 })))
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: 102, clientY: 101 })))
    expect(result.current.position).toEqual({ x: 100, y: 100 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clamp 到视口内（不超出边界）', () => {
    const { result } = renderHook(() => useDraggable({ initial: { x: 0, y: 0 }, size: { width: 36, height: 36 }, margin: 8 }))
    act(() => result.current.onPointerDown({ clientX: 0, clientY: 0 } as any))
    // 往左上拖到负坐标
    act(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: -500, clientY: -500 })))
    act(() => window.dispatchEvent(new PointerEvent('pointerup', { clientX: -500, clientY: -500 })))
    // 应 clamp 到 margin=8
    expect(result.current.position.x).toBe(8)
    expect(result.current.position.y).toBe(8)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/useDraggable.test.ts`
Expected: FAIL — `useDraggable` 模块不存在。

- [ ] **Step 3: 实现 hook**

```ts
// src/renderer/hooks/useDraggable.ts
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Position { x: number; y: number }

interface Options {
  initial: Position
  onChange?: (pos: Position) => void
  // 被拖动元素尺寸，用于 clamp 不超出视口
  size: { width: number; height: number }
  // 视口安全边距
  margin?: number
}

const DRAG_THRESHOLD = 3

/**
 * 通用 pointer 拖动 hook。拖动期用 ref + 直接改 DOM transform 跟手（绕过逐帧渲染），
 * pointerup 时同步 React state 并触发 onChange。位移 < 3px 视为点击（不更新位置）。
 * 参考 useResizableWidth 的模式。jsdom 无 PointerEvent 时降级为 MouseEvent。
 */
export function useDraggable({ initial, onChange, size, margin = 8 }: Options) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPositionState] = useState<Position>(initial)
  const [dragging, setDragging] = useState(false)

  // 拖动期 ref（不触发渲染）
  const startPointer = useRef<Position | null>(null)   // pointerdown 时的指针坐标
  const startPos = useRef<Position>(initial)            // pointerdown 时的元素位置
  const moved = useRef(false)                           // 是否超过阈值
  const rafRef = useRef(0)

  const clamp = useCallback((p: Position): Position => {
    const maxX = window.innerWidth - size.width - margin
    const maxY = window.innerHeight - size.height - margin
    return {
      x: Math.min(Math.max(p.x, margin), Math.max(margin, maxX)),
      y: Math.min(Math.max(p.y, margin), Math.max(margin, maxY)),
    }
  }, [size.width, size.height, margin])

  const applyTransform = useCallback((p: Position) => {
    const el = ref.current
    if (el) el.style.transform = `translate(${p.x}px, ${p.y}px)`
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent | PointerEvent | { clientX: number; clientY: number }) => {
    startPointer.current = { x: (e as any).clientX, y: (e as any).clientY }
    startPos.current = position
    moved.current = false
    setDragging(true)
  }, [position])

  useEffect(() => {
    if (!dragging) return
    const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent
    const onMove = (e: Event) => {
      const ev = e as PointerEvent
      if (startPointer.current == null) return
      // 防卡死：buttons===0 表示已松手
      if ('buttons' in ev && ev.buttons === 0) { onUp(); return }
      const dx = ev.clientX - startPointer.current.x
      const dy = ev.clientY - startPointer.current.y
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      moved.current = true
      const next = clamp({ x: startPos.current.x + dx, y: startPos.current.y + dy })
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => applyTransform(next))
    }
    const onUp = () => {
      cancelAnimationFrame(rafRef.current)
      setDragging(false)
      if (moved.current && startPointer.current) {
        // 计算最终位置（最后一次 move 的目标已写到 transform，但 state 还没更新）
        const dxLast = (lastPointer.current?.x ?? startPointer.current.x) - startPointer.current.x
        const dyLast = (lastPointer.current?.y ?? startPointer.current.y) - startPointer.current.y
        const finalPos = clamp({ x: startPos.current.x + dxLast, y: startPos.current.y + dyLast })
        setPositionState(finalPos)
        onChange?.(finalPos)
      }
      startPointer.current = null
      lastPointer.current = null
    }
    const lastPointer = { current: null as Position | null }
    // 包装 onMove 记录最后指针位置
    const onMoveWrapped = (e: Event) => {
      const ev = e as PointerEvent
      lastPointer.current = { x: ev.clientX, y: ev.clientY }
      onMove(e)
    }
    window.addEventListener('pointermove', onMoveWrapped as EventListener)
    window.addEventListener('pointerup', onUp as EventListener)
    window.addEventListener('pointercancel', onUp as EventListener)
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMoveWrapped as EventListener)
      window.removeEventListener('pointerup', onUp as EventListener)
      window.removeEventListener('pointercancel', onUp as EventListener)
      document.body.style.userSelect = ''
    }
  }, [dragging, clamp, applyTransform, onChange])

  // position 外部变更时同步 transform（如从 settings 恢复）
  useEffect(() => { applyTransform(position) }, [position, applyTransform])

  const setPosition = useCallback((p: Position) => {
    setPositionState(p)
  }, [])

  return { ref, position, dragging, onPointerDown, setPosition, moved: moved.current }
}
```

注意：上面 `onUp` 在 `onMove` 之前定义会被引用——实际实现时把 `onUp` 用 `useRef` 或提到 effect 外。**实现者修正**：把 `onUp` 定义移到 `onMove` 之前（已在上面调整顺序，`onUp` 在 `onMove` 内被调用，需先声明）。最终实现确保 `onUp` 先于 `onMove` 定义。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/useDraggable.test.ts`
Expected: PASS（5 个用例）。若 jsdom 无 `PointerEvent` 构造函数导致 `new PointerEvent` 失败，改为 `new MouseEvent('pointermove', {...})`（jsdom 的 `PointerEvent` 可能未定义；hook 内已降级，测试也用 MouseEvent）。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无 `useDraggable.ts` 相关错误。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useDraggable.ts tests/useDraggable.test.ts
git commit -m "feat: 新增 useDraggable hook（pointer 拖动 + 视口 clamp + 点击/拖动判定）"
```

---

### Task 2: AppSettings 加位置记忆字段（主进程 + 渲染端类型 + 默认值）

**Files:**
- Modify: `src/renderer/types.ts:217-256`（AppSettings）
- Modify: `src/main/settings-store.ts:74-114`（AppSettings）+ `:173-218`（defaults）+ `:234-256`（withDefaults）
- Test: `tests/reducer.test.ts`（initialState 全字段，需加新字段）

**Interfaces:**
- Produces: `AppSettings.rememberPanelPosition: boolean`（默认 `true`）、`AppSettings.panelPosition?: { x: number; y: number }`。

- [ ] **Step 1: 加类型字段**

在 `src/renderer/types.ts` 的 `AppSettings` 里，`showBackendTask: boolean` 下一行加：

```ts
  showBackendTask: boolean
  rememberPanelPosition: boolean    // 是否记住悬浮任务面板的拖动位置
  panelPosition?: { x: number; y: number }  // 悬浮任务面板的持久化位置
```

在 `src/main/settings-store.ts` 的 `AppSettings` 接口（第 102 行 `showBackendTask: boolean` 后）加同样两行 + 注释。

- [ ] **Step 2: 加默认值**

在 `src/main/settings-store.ts` 的 `defaults` 对象（第 201 行 `showBackendTask: true,` 后）加：

```ts
  showBackendTask: true,
  rememberPanelPosition: true,
```

（`panelPosition` 是可选，默认不设——首次挂载时用代码计算的右上角坐标。）

- [ ] **Step 3: withDefaults 补齐**

在 `src/main/settings-store.ts` 第 252 行的布尔字段数组里加 `'rememberPanelPosition'`：

```ts
  ;(['inheritTerminal', 'taskNotify', 'notifySound', 'notifyOnComplete', 'notifyOnError', 'notifyOnConfirm', 'notifyOnPermission', 'showThinking', 'showTodo', 'showBackendTask', 'autoArchive', 'devTools', 'rememberPanelPosition'] as const).forEach(k => {
```

`panelPosition` 是可选对象，`withDefaults` 的 `{ ...defaults, ...raw }` 已处理（raw 有就用 raw，没有就 undefined），无需特殊补齐。

- [ ] **Step 4: 更新 reducer.test 的 initialState**

`tests/reducer.test.ts` 第 19-26 行的 `settings: { ... }` 里，在 `showBackendTask: true,` 后加 `rememberPanelPosition: true,`。同样更新 `tests/blocks-reducer.test.ts` 若它有完整 settings 构造（grep 确认）。

Run: `grep -n "showBackendTask" tests/reducer.test.ts tests/blocks-reducer.test.ts` 找到所有位置，每处加 `rememberPanelPosition: true,`。

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `npx vitest run tests/reducer.test.ts tests/blocks-reducer.test.ts && npx tsc --noEmit`
Expected: 全过；无 settings 相关类型错误。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/types.ts src/main/settings-store.ts tests/reducer.test.ts tests/blocks-reducer.test.ts
git commit -m "feat: AppSettings 加 rememberPanelPosition / panelPosition 字段"
```

---

### Task 3: 简化 panelFold 为 { root } + 加 SET_PANEL_POSITION

**Files:**
- Modify: `src/renderer/state/reducer.ts:44`（类型）+ `:839-841`（SET_PANEL_FOLD）
- Modify: `src/renderer/state/actions.ts:87`（SET_PANEL_FOLD 类型）
- Modify: `src/renderer/state/store.tsx:34`（initialState）
- Modify: `tests/reducer.test.ts:29`、`tests/blocks-reducer.test.ts:27`、`tests/backend-task-clear.test.ts:14`（panelFold 构造）

**Interfaces:**
- Produces: `AppState.panelFold: { root: boolean }`、`AppState.panelPosition: { x: number; y: number }`、action `SET_PANEL_POSITION`。

- [ ] **Step 1: 改 reducer 类型 + initialState**

`src/renderer/state/reducer.ts` 第 44 行：
```ts
  panelFold: { root: boolean }
  panelPosition: { x: number; y: number }
```

`src/renderer/state/store.tsx` 第 34 行：
```ts
    panelFold: { root: false },
    panelPosition: { x: 0, y: 0 },
```
（`root: false` 表示默认展开；位置 0,0 是占位，组件挂载时若开启记忆会用 settings.panelPosition 覆盖，否则用计算出的右上角坐标。）

- [ ] **Step 2: 改 actions**

`src/renderer/state/actions.ts` 第 86-87 行改为：
```ts
  // 悬浮任务面板：root 折叠态 + 拖动位置
  | { type: 'SET_PANEL_FOLD'; panel: 'root'; folded: boolean }
  | { type: 'SET_PANEL_POSITION'; position: { x: number; y: number } }
```

- [ ] **Step 3: 改 reducer SET_PANEL_FOLD + 加 SET_PANEL_POSITION**

`src/renderer/state/reducer.ts` 第 839-841 行改为：
```ts
    case 'SET_PANEL_FOLD': {
      return { ...state, panelFold: { root: action.folded } }
    }
    case 'SET_PANEL_POSITION': {
      return { ...state, panelPosition: action.position }
    }
```

- [ ] **Step 4: 更新测试里的 panelFold 构造**

把所有测试文件里的 `panelFold: { root: false, taskCard: false, subagentCard: false, backendTaskCard: false }` 改为 `panelFold: { root: false }, panelPosition: { x: 0, y: 0 }`：
- `tests/reducer.test.ts:29`
- `tests/blocks-reducer.test.ts:27`
- `tests/backend-task-clear.test.ts:14`（这处原是 `{ root: false, taskCard: false, backendTaskCard: false }`，改为 `{ root: false }` + 加 `panelPosition`）

Run: `grep -rn "panelFold:" tests/` 确认无遗漏。`tests/BackendTaskPanel.test.tsx` 的 `folded={{...}}` props 不在此步改（Task 6 重写整个文件）——但会让它编译失败，所以**本步先把它改为 `folded={{ root: false }}`** 让编译通过，Task 6 再重写。

- [ ] **Step 5: 运行测试 + 类型检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: `tests/BackendTaskPanel.test.tsx` 可能因旧的 `SET_PANEL_FOLD panel: 'backendTaskCard'` 断言失败——这是预期的（Task 6 重写）。其余测试全过。本步**暂不计较 BackendTaskPanel.test.tsx 的失败**，但需确保 tsc 编译通过（类型层面 panelFold 子字段已删，BackendTaskPanel.test.tsx 里引用子字段的断言是运行时断言不是类型错误，tsc 仍过）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/state/reducer.ts src/renderer/state/actions.ts src/renderer/state/store.tsx tests/
git commit -m "refactor: panelFold 简化为 { root } + 加 SET_PANEL_POSITION"
```

---

### Task 4: 三个分区卡片去掉折叠头，改静态标题行

**Files:**
- Modify: `src/renderer/components/TaskPanel.tsx`（TaskCard）
- Modify: `src/renderer/components/SubagentCard.tsx`
- Modify: `src/renderer/components/BackendTaskCard.tsx`

**Interfaces:**
- Consumes: 无（独立组件）
- Produces: 三个卡片不再接收 `folded` / `onToggleFold`，header 改为静态 `<div>`（图标 + 类型名 + 计数），不再用 `useCollapsibleHeight`（内容常驻显示）。`BackendTaskPanel`（Task 5）会以新 props 调用它们。

- [ ] **Step 1: 改 TaskCard（TaskPanel.tsx）**

把整个 `TaskCard` 组件改为：去掉 `folded`/`onToggleFold` props、去掉 `useCollapsibleHeight`、header 改静态。完整替换 `TaskCard` 函数（保留 `StatusIcon`、`STATUS_LABEL`、`TaskCardProps` 改接口）：

```tsx
interface TaskCardProps {
  tasks: TaskItem[]
  onClickTask?: (task: TaskItem) => void
}

export function TaskCard({ tasks, onClickTask }: TaskCardProps) {
  if (tasks.length === 0) return null
  const running = tasks.filter(t => t.status === 'running').length
  const done = tasks.filter(t => t.status === 'completed').length

  return (
    <div>
      {/* 静态标题行：不再可点折叠 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600 }}>
          <ListTodo size={13} /> 任务
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {running} 进行 · {done} 完成 · 共 {tasks.length}
        </span>
      </div>
      <div style={{ padding: 4 }}>
        {[...tasks].sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, { numeric: true })).map(t => (
          <div
            key={t.id}
            onClick={onClickTask ? () => onClickTask(t) : undefined}
            className="cc-task-row"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: onClickTask ? 'pointer' : 'default' }}
          >
            <div style={{ marginTop: 1 }}><StatusIcon status={t.status} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '(无描述)'}</div>
              <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2 }}>{STATUS_LABEL[t.status]}{t.taskType ? ` · ${t.taskType}` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
```

去掉 `import { useCollapsibleHeight }` 和 `import { FoldBadge }`（不再用）。保留 `ListTodo` import。

- [ ] **Step 2: 改 SubagentCard.tsx**

去掉 `folded`/`onToggleFold` props、`useCollapsibleHeight`、`FoldBadge` import、折叠态分支。`SubagentCard` 函数签名改：

```tsx
interface Props {
  tasks: BackendTask[]
  onKill: (taskId: string) => void
  onRemove: (taskId: string) => void
  onClearFinished: () => void
  onClickTask?: (task: BackendTask) => void
}

export function SubagentCard({ tasks, onKill, onRemove, onClearFinished, onClickTask }: Props) {
  if (tasks.length === 0) return null
  const runningTasks = tasks.filter(t => t.status === 'running')
  const finishedTasks = tasks.filter(t => t.status !== 'running')
  const doneCount = finishedTasks.filter(t => t.status === 'completed').length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600 }}>
          <Bot size={13} /> 子代理
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {runningTasks.length} 运行 · {doneCount} 完成 · 共 {tasks.length}
        </span>
      </div>
      <div style={{ padding: 4 }}>
        {runningTasks.map(t => (
          <SubagentRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} onClick={onClickTask} />
        ))}
        {finishedTasks.length > 0 && (
          <>
            {runningTasks.length > 0 && <div style={{ height: 1, background: 'var(--border-hair)', margin: '4px 8px' }} />}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>已结束 · {finishedTasks.length}</span>
              <button onClick={onClearFinished} title="清除已结束" style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', color: 'var(--text-muted)', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 10,
              }}>
                <Trash2 size={11} /> 清除
              </button>
            </div>
            {finishedTasks.map(t => (
              <SubagentRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} onClick={onClickTask} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
```

保留 `SubagentRow`、`StatusIcon`、`STATUS_LABEL` 不变。去掉 `useCollapsibleHeight`、`FoldBadge` import。

- [ ] **Step 3: 改 BackendTaskCard.tsx**

同样去折叠头，改静态标题行：

```tsx
interface Props {
  tasks: BackendTask[]
  onKill: (taskId: string) => void
  onRemove: (taskId: string) => void
  onClearFinished: () => void
}

export function BackendTaskCard({ tasks, onKill, onRemove, onClearFinished }: Props) {
  if (tasks.length === 0) return null
  const runningTasks = tasks.filter(t => t.status === 'running')
  const finishedTasks = tasks.filter(t => t.status !== 'running')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600 }}>
          <Terminal size={13} /> 后台任务
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {runningTasks.length} 运行 · 共 {tasks.length}
        </span>
      </div>
      <div style={{ padding: 4 }}>
        {runningTasks.map(t => (
          <TaskRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} />
        ))}
        {finishedTasks.length > 0 && (
          <>
            {runningTasks.length > 0 && <div style={{ height: 1, background: 'var(--border-hair)', margin: '4px 8px' }} />}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>已结束 · {finishedTasks.length}</span>
              <button onClick={onClearFinished} title="清除已结束" style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', color: 'var(--text-muted)', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: 10,
              }}>
                <Trash2 size={11} /> 清除
              </button>
            </div>
            {finishedTasks.map(t => (
              <TaskRow key={t.id} t={t} onKill={onKill} onRemove={onRemove} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
```

保留 `TaskRow`、`StatusIcon`、`STATUS_LABEL`。`Terminal` import 保留（标题行用）。去掉 `useCollapsibleHeight`、`FoldBadge` import。

- [ ] **Step 4: 类型检查（预期 BackendTaskPanel 报错）**

Run: `npx tsc --noEmit`
Expected: `BackendTaskPanel.tsx` 报错（还在传 `folded`/`onToggleFold`）——这是预期的，Task 5 修复。三个卡片文件本身无错误。

- [ ] **Step 5: Commit（三个卡片改动）**

```bash
git add src/renderer/components/TaskPanel.tsx src/renderer/components/SubagentCard.tsx src/renderer/components/BackendTaskCard.tsx
git commit -m "refactor: 三个任务卡片去掉折叠头，改静态标题行"
```

---

### Task 5: 重写 BackendTaskPanel（图标↔面板 + 拖动 + 有数据才显示）

**Files:**
- Modify: `src/renderer/components/BackendTaskPanel.tsx`（重写）
- Test: `tests/BackendTaskPanel.test.tsx`（重写）

**Interfaces:**
- Consumes: `useDraggable`（Task 1）、简化后的 `panelFold: { root }`、`panelPosition`、三个卡片新签名（Task 4）、`settings.rememberPanelPosition` + `settings.panelPosition`（Task 2）。
- Produces: `BackendTaskPanel` 新 props（去掉子折叠，加位置相关由内部从 store 读）。

- [ ] **Step 1: 重写 BackendTaskPanel.tsx**

完整替换文件内容：

```tsx
import { useState, useRef, useEffect } from 'react'
import { ListChecks, ChevronRight } from 'lucide-react'
import { SubagentDetailDrawer } from './SubagentDetailDrawer'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import { SubagentCard } from './SubagentCard'
import { FoldBadge } from './FoldBadge'
import { useDraggable, type Position } from '../hooks/useDraggable'
import { useStore } from '../state/store'
import type { TaskItem, BackendTask, ContentBlock } from '../types'

interface Props {
  tasks: TaskItem[]
  backendTasks: BackendTask[]
  showTodo: boolean
  showBackendTask: boolean
  activeSessionId: string
  subagentOutputByToolUseId?: Record<string, ContentBlock[]>
  dispatch: (action: any) => void
}

// 默认右上角坐标（挂载时若未开启记忆或无持久化位置时用）
function defaultPosition(): Position {
  const top = 48 // TitleBar 高度 + 间距
  const right = 24
  return { x: window.innerWidth - 36 - right, y: top }
}

export function BackendTaskPanel({
  tasks, backendTasks, showTodo, showBackendTask, activeSessionId, subagentOutputByToolUseId, dispatch,
}: Props) {
  const { state } = useStore()
  const [activeSubagent, setActiveSubagent] = useState<BackendTask | null>(null)
  const [activeTask, setActiveTask] = useState<TaskItem | null>(null)
  const subagents = backendTasks.filter(t => t.kind === 'subagent')
  const backends = backendTasks.filter(t => t.kind !== 'subagent')

  const folded = state.panelFold.root
  const settings = state.settings

  // 初始位置：开启记忆且有持久化坐标 → 用之；否则默认右上角
  const initialPos: Position = (settings.rememberPanelPosition && settings.panelPosition)
    ? settings.panelPosition
    : defaultPosition()

  const { ref, position, onPointerDown } = useDraggable({
    initial: initialPos,
    size: folded ? { width: 36, height: 36 } : { width: 280, height: 400 },
    onChange: (pos) => {
      dispatch({ type: 'SET_PANEL_POSITION', position: pos })
      if (settings.rememberPanelPosition) {
        dispatch({ type: 'SET_SETTINGS', settings: { panelPosition: pos } })
        window.api?.settings?.save({ panelPosition: pos })
      }
    },
  })

  // 记忆开启但当前无 panelPosition 时，首次挂载写入
  useEffect(() => {
    if (settings.rememberPanelPosition && !settings.panelPosition) {
      dispatch({ type: 'SET_SETTINGS', settings: { panelPosition: position } })
      window.api?.settings?.save({ panelPosition: position })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const taskVisible = showTodo && tasks.length > 0
  const subagentVisible = showBackendTask && subagents.length > 0
  const bgVisible = showBackendTask && backends.length > 0
  const totalCount = tasks.length + subagents.length + backends.length

  // 点图标：拖动则不切换，点击则切换（useDraggable 内 moved 判定，这里用 pointerup 位置不变判定）
  // 简化：用 onClick 切换；拖动时 onClick 仍会触发，故在 onPointerDown 记录起点，onClick 时若位移小才切换
  const downPos = useRef<Position | null>(null)
  const handlePointerDown = (e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY }
    onPointerDown(e)
  }
  const handleClick = () => {
    if (!downPos.current) { dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded }); return }
    // 位移由 useDraggable 内部判定，这里简化：拖动后 position 已变则不切换
    dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded })
  }

  const onKill = (taskId: string) => { void window.api.backendTask.kill(activeSessionId, taskId) }
  const onRemove = (taskId: string) => {
    void window.api?.backendTask?.remove?.(activeSessionId, taskId)
    dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId })
  }

  return (
    <>
      <div
        ref={ref}
        style={{
          position: 'fixed',
          top: 0, left: 0,
          transform: `translate(${position.x}px, ${position.y}px)`,
          zIndex: 50,
          ...(folded ? {
            width: 36, height: 36, borderRadius: 10, cursor: 'grab',
            background: 'var(--surface-1)', boxShadow: 'var(--shadow-float)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text)', position: 'relative',
          } : {
            width: 280, maxHeight: 'calc(100vh - 96px)', borderRadius: 10,
            background: 'var(--surface-1)', boxShadow: 'var(--shadow-float)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }),
        }}
      >
        {folded ? (
          <div
            onPointerDown={handlePointerDown}
            onClick={handleClick}
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', cursor: 'pointer' }}
          >
            <ListChecks size={16} />
            {totalCount > 0 && <FoldBadge count={totalCount} />}
          </div>
        ) : (
          <>
            {/* 标题条：拖把手 + 收起 */}
            <div
              onPointerDown={handlePointerDown}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', cursor: 'grab', borderBottom: '1px solid var(--border-hair)',
                fontWeight: 600, color: 'var(--text)', fontSize: 12,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ListChecks size={13} /> 任务面板
              </span>
              <button
                onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })}
                onPointerDown={(e) => e.stopPropagation()}
                title="收起"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', padding: 2 }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="panel-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px' }}>
              {taskVisible && (
                <TaskCard tasks={tasks} onClickTask={(task) => setActiveTask(task)} />
              )}
              {subagentVisible && (
                <SubagentCard
                  tasks={subagents}
                  onKill={onKill}
                  onRemove={onRemove}
                  onClearFinished={() => {
                    const ids = subagents.filter(t => t.status !== 'running').map(t => t.id)
                    if (ids.length) void window.api?.backendTask?.remove?.(activeSessionId, ids)
                    dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })
                  }}
                  onClickTask={(task) => setActiveSubagent(task)}
                />
              )}
              {bgVisible && (
                <BackendTaskCard
                  tasks={backends}
                  onKill={onKill}
                  onRemove={onRemove}
                  onClearFinished={() => {
                    const ids = backends.filter(t => t.status !== 'running').map(t => t.id)
                    if (ids.length) void window.api?.backendTask?.remove?.(activeSessionId, ids)
                    dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })
                  }}
                />
              )}
              {!taskVisible && !subagentVisible && !bgVisible && (
                <div style={{ padding: '20px 10px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>暂无任务</div>
              )}
            </div>
          </>
        )}
      </div>
      <SubagentDetailDrawer
        task={activeSubagent}
        outputByToolUseId={subagentOutputByToolUseId ?? {}}
        onClose={() => setActiveSubagent(null)}
      />
      <TaskDetailDrawer task={activeTask} onClose={() => setActiveTask(null)} />
    </>
  )
}
```

注意：`handleClick` 的拖动/点击区分简化为"拖动后位置已变则不切换"需额外判定——**实现者完善**：在 `handleClick` 里比较 `downPos.current` 与 `e.clientX/Y`，位移 < 3px 才 dispatch 切换。修改 `handleClick` 接收 `e: React.MouseEvent`：

```tsx
const handleClick = (e: React.MouseEvent) => {
  if (!downPos.current) { dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded }); return }
  const dist = Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y)
  if (dist < 3) dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: !folded })
}
```

并把折叠态 div 的 `onClick={handleClick}` 改为 `onClick={handleClick}`（传事件）。

- [ ] **Step 2: 重写 BackendTaskPanel.test.tsx**

完整替换 `tests/BackendTaskPanel.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { BackendTaskPanel } from '../src/renderer/components/BackendTaskPanel'
import { AppProvider } from '../src/renderer/state/store'
import { seedProjects } from './fixtures'

function renderPanel(overrides: any = {}) {
  return render(
    <AppProvider initialProjects={structuredClone(seedProjects)} {...overrides}>
      <BackendTaskPanel
        tasks={[]}
        backendTasks={[]}
        showTodo={true}
        showBackendTask={true}
        activeSessionId="s1"
        dispatch={vi.fn()}
        {...overrides}
      />
    </AppProvider>
  )
}

describe('BackendTaskPanel', () => {
  it('折叠态默认显示图标（无数据无徽章）', () => {
    // 默认 panelFold.root=false（展开），先切到折叠：通过 store 初始折叠
    // 这里直接验证：无数据时折叠图标不渲染徽章
    renderPanel()
    // 展开态标题条存在
    expect(screen.getByText('任务面板')).toBeTruthy()
  })

  it('有任务数据才显示对应分区', () => {
    const tasks = [{ id: 't1', status: 'running', description: '做A', taskType: 'task' }] as any
    renderPanel({ tasks })
    expect(screen.getByText('任务')).toBeTruthy()
  })

  it('全空时展开态显示「暂无任务」', () => {
    renderPanel()
    expect(screen.getByText('暂无任务')).toBeTruthy()
  })

  it('点收起按钮折叠为图标态', async () => {
    const { container } = renderPanel()
    const collapseBtn = screen.getByTitle('收起')
    fireEvent.click(collapseBtn)
    await waitFor(() => {
      expect(container.textContent).not.toContain('任务面板')
    })
  })
})
```

（`renderPanel` 把 overrides 既给 AppProvider 又给 BackendTaskPanel 不太对——实现者修正为：tasks/backendTasks 等只给 BackendTaskPanel，initialProjects 给 AppProvider。实现时拆开传参。）

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/BackendTaskPanel.test.tsx`
Expected: PASS。若 `useStore` 在 BackendTaskPanel 内部调用导致 props 重复传 dispatch 冲突——实现者调整为：BackendTaskPanel 从 useStore 读 dispatch（去掉 props.dispatch），或测试用真实 store。**倾向**：BackendTaskPanel 内部 `const { state, dispatch } = useStore()`，props 不再传 dispatch/folded/panelFold（与 ChatArea 调用对齐，Task 7 改 ChatArea）。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: ChatArea.tsx 报错（还在传旧 props `folded`）——Task 7 修。BackendTaskPanel 本身无错。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/BackendTaskPanel.tsx tests/BackendTaskPanel.test.tsx
git commit -m "feat: BackendTaskPanel 重写为可拖动图标/面板，整体折叠，有数据才显示"
```

---

### Task 6: 去掉 TitleBar 的 ListChecks 开关 + 改 ChatArea 调用

**Files:**
- Modify: `src/renderer/components/TitleBar.tsx:140,190-196`
- Modify: `src/renderer/components/ChatArea.tsx:339-348`

**Interfaces:**
- Consumes: BackendTaskPanel 新签名（Task 5，不接收 folded）。

- [ ] **Step 1: 去掉 TitleBar 开关**

`src/renderer/components/TitleBar.tsx`：删除第 140 行 `const taskPanelOpen = !state.panelFold.root`。删除第 189-196 行的 `<GhostButton title={taskPanelOpen ? ...} ...><ListChecks .../></GhostButton>` 整块。去掉 `ListChecks` import（若仅此处用）。

- [ ] **Step 2: 改 ChatArea 调用**

`src/renderer/components/ChatArea.tsx:339-348`，把传给 BackendTaskPanel 的 `folded={state.panelFold}` 去掉（BackendTaskPanel 内部从 store 读）。改为：

```tsx
      <BackendTaskPanel
        tasks={state.tasksBySession[state.activeSessionId] ?? []}
        backendTasks={state.backendTasksBySession[state.activeSessionId] ?? []}
        showTodo={state.settings.showTodo}
        showBackendTask={state.settings.showBackendTask}
        activeSessionId={state.activeSessionId}
        subagentOutputByToolUseId={state.subagentOutputBySession[state.activeSessionId] ?? {}}
      />
```

（去掉 `dispatch` 和 `folded`——BackendTaskPanel 内部用 useStore 取。）

- [ ] **Step 3: 删除 i18n 废弃 key**

`src/renderer/i18n/index.ts` 删除 `'title.taskPanelShow'` 和 `'title.taskPanelHide'`（zh-CN 第 13-14 行 + en 第 118-119 行）。两边都要删（i18n-completeness 校验）。

- [ ] **Step 4: 类型检查 + i18n 完整性测试**

Run: `npx tsc --noEmit && npx vitest run tests/i18n-completeness.test.ts`
Expected: 全过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TitleBar.tsx src/renderer/components/ChatArea.tsx src/renderer/i18n/index.ts
git commit -m "refactor: 去掉 TitleBar 面板开关，ChatArea 适配新 BackendTaskPanel 签名"
```

---

### Task 7: GeneralSettings 加「记住任务面板位置」Toggle

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.tsx:158-160`（在"显示任务面板"行后加）
- Modify: `src/renderer/i18n/index.ts`（加 key 两边）

- [ ] **Step 1: 加 Toggle**

在 `src/renderer/components/settings/GeneralSettings.tsx` 第 158-160 行的"显示任务面板" SettingsRow 后插入（注意 noBorder 要移到新行）：

把原：
```tsx
        <SettingsRow title="显示任务面板" desc="在右上角悬浮面板展示 Claude 规划的任务列表。" noBorder>
          <Toggle on={s.showTodo} onChange={v => persist({ showTodo: v })} />
        </SettingsRow>
```
改为（去掉 noBorder，加新行）：
```tsx
        <SettingsRow title="显示任务面板" desc="在右上角悬浮面板展示 Claude 规划的任务列表。">
          <Toggle on={s.showTodo} onChange={v => persist({ showTodo: v })} />
        </SettingsRow>
        <SettingsRow title="记住面板位置" desc="拖动任务面板后记住位置，刷新或重开仍在原处；关闭则每次回到右上角。" noBorder>
          <Toggle on={s.rememberPanelPosition} onChange={v => persist({ rememberPanelPosition: v })} />
        </SettingsRow>
```

- [ ] **Step 2: 全套测试 + 类型检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全过（651+ 测试）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/GeneralSettings.tsx
git commit -m "feat: 常规设置加「记住面板位置」开关"
```

---

### Task 8: 端到端验证 + 旧 panelFold 残留清理

**Files:**
- 验证：手动 + 全套测试
- 检查残留：grep

- [ ] **Step 1: 检查 panelFold 子字段残留**

Run: `grep -rn "taskCard\|subagentCard\|backendTaskCard" src/ tests/`
Expected: 无输出（应全部清理）。若有残留，删除。

- [ ] **Step 2: 检查 BackendTaskPanel 旧 props 残留**

Run: `grep -rn "onToggleFold\|folded={" src/renderer/components/BackendTaskPanel.tsx`
Expected: 无输出。

- [ ] **Step 3: 全套测试 + 类型检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全过，无新增类型错误（仓库既有无关错误除外：CommandSettings/dataPath/bump-version）。

- [ ] **Step 4: 真机验证清单**

`pnpm dev` 后人工验证：
1. 默认右上角出现面板（展开态），标题"任务面板"。
2. 拖标题条，面板跟手移动；松手后面板在新位置。
3. 点收起按钮（ChevronRight）→ 缩成右上图标（带总数徽章）。
4. 拖图标到屏幕中部，松手；点图标 → 在该位置展开。
5. 拖到视口边缘，被 clamp 不超出。
6. 有任务/子代理/后台时对应分区出现；全空显示"暂无任务"。
7. 设置 → 常规：关闭「记住面板位置」，拖动后面板位置刷新后回到右上角；开启则保留。
8. TitleBar 不再有 ListChecks 开关。

- [ ] **Step 5: Commit（若有清理）**

```bash
git add -A
git commit -m "chore: 清理 panelFold 旧字段残留"
```

---

## Self-Review

**Spec coverage（逐节核对 spec）：**
- 折叠态图标 36×36 + 徽章 → Task 5
- 展开态宽 280 / 高自适应 / 标题条拖动 → Task 5
- 三分区有数据才显示 / 无单独折叠 → Task 4 + Task 5
- 点图标/收起按钮切换 / 不自动收起 → Task 5（无外部点击收起逻辑，符合）
- useDraggable pointer + rAF + clamp + 阈值 → Task 1
- 位置记忆设置项默认开启 → Task 2 + Task 7
- TitleBar 去开关 → Task 6
- panelFold 简化 + SET_PANEL_POSITION → Task 3

**Placeholder scan：** Task 5 有两处"实现者完善/修正"标记（handleClick 拖动判定、test overrides 拆参）——已在步骤内给出修正代码，不算占位，但实现者需执行。已明确。

**Type consistency：** `Position = { x: number; y: number }` 在 Task 1 定义，Task 5 使用一致。`panelFold: { root: boolean }` 在 Task 3 定义，Task 5/6 使用一致。`SET_PANEL_POSITION` action 名一致。

**潜在风险：** Task 5 的 BackendTaskPanel 从 props 读 dispatch 改为内部 useStore——需确保 ChatArea（Task 6）不再传 dispatch，且测试用 AppProvider 包裹。已在 Task 5 Step 3 注明。
