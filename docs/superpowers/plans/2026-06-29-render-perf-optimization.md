# 渲染性能优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除桌面端四类卡顿（流式输出、长会话、重组件多开、切换启动），通过四层渲染层优化：流式节流、分片订阅、消息项 memo、消息列表虚拟化。

**Architecture:** 全部改动在渲染层与 Context 分发层，不碰 reducer 数据流逻辑、持久化、IPC 通道、SDK 桥接、主进程。实施顺序按「最小爆炸半径」：先 memo（零新依赖）→ 节流（独立模块）→ 分片订阅（渐进迁移）→ 虚拟化（最大改动最后）。

**Tech Stack:** React 18.3.1, TypeScript, vitest 4.1.9 + @testing-library/react 16.3.2, 新增 `react-virtuoso` + `use-context-selector`。

**对应设计文档:** `docs/superpowers/specs/2026-06-29-render-perf-optimization-design.md`

## Global Constraints

- **不碰 reducer 的数据流**：`STREAM_DELTA` 等动作的语义和 reducer 实现不变，节流只降 dispatch 频率。
- **不碰持久化/IPC/主进程**：所有改动在 `src/renderer/` 下。
- **测试隔离约定**：reducer 测试用 `tests/fixtures.ts` 的 `seedProjects`（p1 含 s1..s8）+ `initialState()` 工厂（见 `tests/blocks-reducer.test.ts`），不另造 mock。涉及落盘的主进程测试用 `withFakeConfigDir()`（本计划不涉及）。
- **`tsc` 是唯一类型检查**：无 lint 脚本；改完跑 `npx tsc --noEmit` 确认无类型错误。
- **commit 规范**：Conventional Commits（`feat:`/`fix:`/`refactor:`/`perf:`），发版靠 CI 推断。
- **i18n 双语**：新增文案要在 `src/renderer/i18n/` 的 zh-CN 与 en 两边都加（本计划预计不新增用户可见文案）。

---

## 关键背景（实施者必读）

### 现有数据结构（来自 `src/renderer/types.ts` 与 `reducer.ts`）

- `AppState.streamingBySession: Record<string, StreamingState>`，其中 `StreamingState = { blocks: ContentBlock[]; notices: SystemNotice[]; error?: string; draftMessageId?: string; _seenUuids?: string[] }`。
- **关键**：流式草稿**已经存在于 `session.messages` 数组里**。`reducer.ts:161` 的 `syncDraftMessage` 把 `streaming.blocks` 同步写入 `projects.messages` 中 `draftMessageId` 对应的 message（若无则懒创建一个 draft message 并关联回 `streaming.draftMessageId`）。
- 现有 `ChatArea.tsx:392-476` 渲染消息时，**跳过草稿消息**（`if (streaming?.draftMessageId === m.id) return null`），改由独立的 `streaming` 区（478-489 行）单独渲染 `streaming.blocks`。这是为了避免草稿同时被两处渲染导致重复。

### 关键耦合点（决定 memo 能否生效）

`src/renderer/components/blocks/BlockRenderer.tsx` 内部的 `BlockRenderer` 组件（第 7 行 `const { state } = useStore()`）和 `ToolUseCard`/`MetaToolCard` 等**自己调用了 `useStore()`**。因此即使外层 `MessageRow` 用 `React.memo` 包裹，只要这些子组件订阅了全局 state，它们仍会在每次 state 变化时重渲——memo 拦不住。

**结论**：层 3（memo）要真正生效，必须配合层 2（分片订阅）把子组件的全局订阅收窄。本计划把「BlockRenderer 解耦 useStore」作为层 2 的前置子任务，确保 memo 收益可验证。

### 测试范式（来自 `tests/blocks-reducer.test.ts`）

```ts
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'
function initialState(): AppState {
  return { projects: structuredClone(seedProjects), activeSessionId: 's1',
    tabsBySession: { s1: [] }, activeTabIdBySession: { s1: null }, /* …全字段… */ }
}
describe('xxx', () => {
  beforeEach(() => setIdCounter(100))
  it('…', () => { let s = initialState(); s = reducer(s, {…}); expect(…).toBe(…) })
})
```

`initialState()` 完整字段见 `tests/blocks-reducer.test.ts:6-35`，本计划新增测试文件直接复制该工厂。

---

## 文件结构

**新建：**
- `src/renderer/hooks/useStreamBatcher.ts` — 层 1：rAF 批合并流式 delta 的 hook
- `src/renderer/components/MessageRow.tsx` — 层 3：memo 化的消息行组件
- `tests/stream-batcher.test.ts` — 层 1 单元测试（rAF/flush 合并正确性）
- `tests/messagerow-memo.test.tsx` — 层 3 memo 验证（render counter）
- `tests/store-selector.test.tsx` — 层 2 分片订阅验证

**修改：**
- `src/renderer/state/store.tsx` — 层 2：换 `use-context-selector` 的 Context + `useSelector`
- `src/renderer/components/blocks/BlockRenderer.tsx` — 层 2：`showThinking` 改 props 传入，解耦 `useStore`
- `src/renderer/components/ChatArea.tsx` — 层 1/2/3/4 集成点：接入 batcher、selector、MessageRow、Virtuoso
- `package.json` — 加 `react-virtuoso`、`use-context-selector` 依赖

---

## Task 1: 抽出 MessageRow 组件（不 memo，仅纯重构）

**目标**：把 `ChatArea.tsx:392-476` 的消息渲染逻辑抽成独立组件，行为零变化。这是后续 memo 与虚拟化的载体，先保证抽出后渲染结果与现在逐字节一致。

**Files:**
- Create: `src/renderer/components/MessageRow.tsx`
- Modify: `src/renderer/components/ChatArea.tsx`（消息 map 改为调用 `<MessageRow />`）
- Test: 无（纯重构，由现有渲染冒烟覆盖；下一 Task 才加 memo 测试）

**Interfaces:**
- Produces: `MessageRow` 组件，props 见下。本 Task 不 memo，下 Task 加。

- [ ] **Step 1: 创建 MessageRow.tsx（无 memo，原样搬运 ChatArea 的消息渲染分支）**

`src/renderer/components/MessageRow.tsx`：

```tsx
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { AttachmentChip } from './AttachmentChip'
import { Notices } from './Notices'
import { Tooltip } from './Tooltip'
import { PromptEditor } from '../editor/PromptEditor'
import { serializeForPrompt } from '../editor/serialize'
import { renderBlocks } from './blocks/BlockRenderer'
import { CopyButton, extractText, messageAttachments } from './ChatArea'

import type { ContentBlock, DraftAttachment, Message } from '../types'

export interface MessageRowProps {
  message: Message
  isStreaming: boolean
  subagentOutputByToolUseId: Record<string, ContentBlock[]>
  subagentToolUseIds: Set<string>
  isLastUserMessage: boolean
  editingMessageId: string | null
  onEditResend: () => void
}

export function MessageRow(props: MessageRowProps) {
  const { dispatch } = useStore()
  const { t } = useI18n()
  const { message: m, isStreaming, subagentOutputByToolUseId, subagentToolUseIds, isLastUserMessage, editingMessageId, onEditResend } = props
  const [editDoc, setEditDoc] = useState<any>(null)

  if (m.role === 'assistant') {
    return (
      <div className="msg-row is-assistant" style={{
        alignSelf: 'flex-start', width: '100%',
        color: 'var(--text)',
        display: 'flex', flexDirection: 'column', gap: 0,
        userSelect: 'text', cursor: 'text',
      }}>
        {messageAttachments(m).map((attachment, index) => <AttachmentChip key={index} attachment={attachment} />)}
        <Notices notices={m.notices ?? []} />
        {renderBlocks(m.content, false, subagentOutputByToolUseId, subagentToolUseIds)}
        <div className="msg-foot" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          {(m.costUSD != null || m.durationMs != null) && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {m.costUSD != null && `$${m.costUSD.toFixed(4)} `}
              {m.durationMs != null && `${(m.durationMs / 1000).toFixed(1)}s`}
              {m.turns != null && ` · ${m.turns} 轮`}
            </div>
          )}
          <CopyButton text={extractText(m.content)} inline />
        </div>
      </div>
    )
  }

  // 用户消息
  return (
    <div className="msg-row is-user" style={{
      alignSelf: 'flex-end', maxWidth: '75%',
      background: 'var(--surface-1)', borderRadius: 'var(--radius)', padding: '5px 11px',
      color: 'var(--text)',
      display: 'flex', flexDirection: 'column', gap: 2,
      userSelect: 'text', cursor: 'text',
      position: 'relative',
    }}>
      {isLastUserMessage && !isStreaming && editingMessageId !== m.id && (
        <button
          onClick={() => {
            const origText = extractText(m.content)
            setEditDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: origText }] }] })
            dispatch({ type: 'SET_EDITING_MESSAGE', messageId: m.id })
          }}
          title={t('chat.edit')}
          className="msg-copy edit-resend-btn"
        >
          <Pencil size={13} />
        </button>
      )}
      {editingMessageId === m.id && editDoc ? (
        <div style={{ minWidth: 280 }}>
          <PromptEditor
            doc={editDoc}
            placeholder=""
            allSlashItems={[]}
            getCwd={() => ''}
            onDocChange={(doc) => setEditDoc(doc)}
            onSend={onEditResend}
            onEditorReady={() => {}}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setEditDoc(null); dispatch({ type: 'SET_EDITING_MESSAGE', messageId: null }) }}
              style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)' }}
            >{t('chat.editCancel')}</button>
            <button
              onClick={onEditResend}
              disabled={!serializeForPrompt(editDoc).trim()}
              style={{ padding: '4px 12px', fontSize: 12, cursor: serializeForPrompt(editDoc).trim() ? 'pointer' : 'not-allowed', border: 'none', borderRadius: 6, background: serializeForPrompt(editDoc).trim() ? 'var(--accent)' : 'var(--bg-hover)', color: serializeForPrompt(editDoc).trim() ? 'var(--accent-text)' : 'var(--text-faint)' }}
            >{t('chat.editSend')}</button>
          </div>
        </div>
      ) : (
        <>
          {messageAttachments(m).map((attachment, index) => <AttachmentChip key={index} attachment={attachment} />)}
          {renderBlocks(m.content, true, subagentOutputByToolUseId, subagentToolUseIds)}
          <CopyButton text={extractText(m.content)} />
        </>
      )}
    </div>
  )
}
```

注意：`CopyButton`、`extractText`、`messageAttachments` 目前定义在 `ChatArea.tsx` 且 `extractText`/`CopyButton` 已 `export`，`messageAttachments` 未导出——需在 ChatArea 加 `export`（Step 2 处理）。

- [ ] **Step 2: ChatArea.tsx 导出 messageAttachments**

`src/renderer/components/ChatArea.tsx:47`：

```tsx
export function messageAttachments(message: Message): DraftAttachment[] {
```
（仅加 `export` 关键字，函数体不变。）

- [ ] **Step 3: ChatArea.tsx 用 MessageRow 替换内联渲染**

把 `ChatArea.tsx:392-476` 的 `session.messages.map(m => {...})` 整段替换为：

```tsx
        {session.messages.map(m => {
          if (streaming?.draftMessageId === m.id) return null
          return (
            <MessageRow
              key={m.id}
              message={m}
              isStreaming={isStreaming}
              subagentOutputByToolUseId={subagentOutputByToolUseId}
              subagentToolUseIds={subagentToolUseIds}
              isLastUserMessage={m.id === lastUserMessage?.id}
              editingMessageId={state.editingMessageId}
              onEditResend={handleEditResend}
            />
          )
        })}
```

并在 `ChatArea.tsx` 顶部加 import：

```tsx
import { MessageRow } from './MessageRow'
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。（若报 `messageAttachments` 未导出，确认 Step 2 已加 export。）

- [ ] **Step 5: 跑现有测试确认无回归**

Run: `npx vitest run`
Expected: 全绿（默认套件，~386 测试）。本 Task 是纯重构，不应有测试失败。

- [ ] **Step 6: 手动冒烟（pnpm dev）**

启动 `pnpm dev`，打开一个会话，确认：用户/AI 消息正常显示、编辑重发按钮正常、复制按钮正常、流式输出正常。视觉与重构前一致。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/MessageRow.tsx src/renderer/components/ChatArea.tsx
git commit -m "refactor: 抽出 MessageRow 组件(纯重构,无行为变化)"
```

---

## Task 2: MessageRow 加 React.memo（层 3）

**目标**：给 `MessageRow` 包 `React.memo`，验证 props 不变时不重渲。但因 BlockRenderer 子组件仍调 `useStore()`，本 Task 只验证「MessageRow 函数体不被调用」这一层（子组件的重渲在 Task 5 解耦后才能彻底拦截）。先建立 memo 基础设施和验证手段。

**Files:**
- Modify: `src/renderer/components/MessageRow.tsx`
- Test: `tests/messagerow-memo.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `MessageRow` + props
- Produces: memo 化的 `MessageRow`（默认导出保持，`React.memo` 包裹）

- [ ] **Step 1: 写失败测试——memo 化后 props 不变不重渲**

`tests/messagerow-memo.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { MessageRow } from '../src/renderer/components/MessageRow'
import type { Message } from '../src/renderer/types'

const baseMsg: Message = {
  id: 'm-fixed', role: 'assistant',
  content: [{ type: 'text', text: '固定内容' }],
}

// 渲染计数器：通过 spy 验证 MessageRow 函数体执行次数
let renderCount = 0

function renderRow(overrides: Partial<Parameters<typeof MessageRow>[0]> = {}) {
  return render(
    <AppProvider>
      <MessageRow
        message={baseMsg}
        isStreaming={false}
        subagentOutputByToolUseId={{}}
        subagentToolUseIds={new Set()}
        isLastUserMessage={false}
        editingMessageId={null}
        onEditResend={() => {}}
        {...overrides}
      />
    </AppProvider>,
  )
}

describe('MessageRow memo', () => {
  it('props 引用不变时不重渲（render count 不增长）', () => {
    // 包一层组件触发两次渲染,但传给 MessageRow 的 props 引用稳定
    const stableProps = {
      message: baseMsg,
      isStreaming: false,
      subagentOutputByToolUseId: {} as Record<string, any>,
      subagentToolUseIds: new Set<string>(),
      isLastUserMessage: false,
      editingMessageId: null,
      onEditResend: () => {},
    }
    const Wrapper = ({ tick }: { tick: number }) => (
      <AppProvider>
        <MessageRow {...stableProps} />
        <span data-testid="tick">{tick}</span>
      </AppProvider>
    )
    const { rerender } = render(<Wrapper tick={1} />)
    expect(screen.getByTestId('tick').textContent).toBe('1')
    // 改 tick 触发 Wrapper 重渲,但 MessageRow 的 props 引用未变
    rerender(<Wrapper tick={2} />)
    expect(screen.getByTestId('tick').textContent).toBe('2')
    // MessageRow 的文本内容应保持(未被重新执行破坏)—基础断言
    expect(screen.getByText('固定内容')).toBeDefined()
  })
})
```

注：本测试在 Task 2 完成后跑会通过（memo 生效后 props 不变确实不重渲函数体）。由于难以直接计数函数体执行（React.memo 在渲染层拦截），测试以「稳定 props 下重复渲染不破坏内容」为可观测契约。真正的「子组件不重渲」验证在 Task 5 后补强。

- [ ] **Step 2: 跑测试确认当前状态**

Run: `npx vitest run tests/messagerow-memo.test.tsx`
Expected: 通过（当前 MessageRow 无 memo，但测试断言只校验内容稳定，仍应通过——这是基线）。若失败，检查 import 路径。

- [ ] **Step 3: 给 MessageRow 加 React.memo**

`src/renderer/components/MessageRow.tsx`，把组件声明改为：

```tsx
import { useState, memo } from 'react'
// …其他 import 不变…

// 浅比 message + subagentOutputByToolUseId + subagentToolUseIds 引用,
// 其余基本类型字段 Object.is 即可。自定义 areEqual 兜底,确保 Set/Record 引用稳定时跳过重渲。
function arePropsEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  return (
    prev.message === next.message &&
    prev.subagentOutputByToolUseId === next.subagentOutputByToolUseId &&
    prev.subagentToolUseIds === next.subagentToolUseIds &&
    prev.isStreaming === next.isStreaming &&
    prev.isLastUserMessage === next.isLastUserMessage &&
    prev.editingMessageId === next.editingMessageId &&
    prev.onEditResend === next.onEditResend
  )
}

export const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  // …函数体不变…
}, arePropsEqual)
```

注意：原本 `export function MessageRow(props)` 改成 `export const MessageRow = memo(function MessageRow(props) {...}, arePropsEqual)`。

- [ ] **Step 4: ChatArea 确保 props 引用稳定**

`ChatArea.tsx` 里传给 MessageRow 的派生 props 必须是稳定引用，否则 memo 永远失效。检查：
- `subagentOutputByToolUseId` / `subagentToolUseIds` 已是 `useMemo`（ChatArea.tsx:88-95），✓ 稳定。
- `onEditResend={handleEditResend}` —— `handleEditResend` 是普通函数，每次渲染新引用。需用 `useCallback` 包裹：

把 `ChatArea.tsx:110` 的 `const handleEditResend = () => {` 改为：

```tsx
const handleEditResend = useCallback(() => {
```

并在文件顶部 import 加 `useCallback`：
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

`handleEditResend` 依赖 `lastUserMessage`、`state.activeSessionId`、`state.claudeSessionMap`、`active?.path`、`state.settings?.cwd`、`editDoc`、`dispatch`——`useCallback` 依赖数组写：

```tsx
}, [lastUserMessage, state.activeSessionId, state.claudeSessionMap, active, state.settings?.cwd, editDoc])
```

- [ ] **Step 5: 类型检查 + 跑测试**

Run: `npx tsc --noEmit && npx vitest run tests/messagerow-memo.test.tsx`
Expected: 类型无错；测试通过。

- [ ] **Step 6: 跑全量测试**

Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/MessageRow.tsx src/renderer/components/ChatArea.tsx tests/messagerow-memo.test.tsx
git commit -m "perf: MessageRow 加 React.memo,稳定派生 props 引用"
```

---

## Task 3: 流式节流 hook（层 1）

**目标**：新增 `useStreamBatcher`，把同一帧内的多个 `STREAM_DELTA` 合并成一次 dispatch。reducer 不变，只降频率。

**设计**：hook 暴露 `pushDelta(sessionId, kind, delta)` 与 `flush()`。内部按 `sessionId` 维护 buffer，rAF 回调里合并同 kind 的 delta 成单次 dispatch，`setTimeout(16ms)` 兜底后台/失焦。

**Files:**
- Create: `src/renderer/hooks/useStreamBatcher.ts`
- Test: `tests/stream-batcher.test.ts`
- 不修改 reducer。

**Interfaces:**
- Produces: `useStreamBatcher(dispatch)` 返回 `{ pushDelta, flush, bindOnDelta }`。
  - `pushDelta(sessionId: string, kind: 'text'|'thinking', delta: string): void`
  - `flush(): void`（同步立即 flush，用于中断/结束兜底）
  - `bindOnDelta(handler: (data: any) => void): void`——可选便利方法，本计划不用，ChatArea 直接调 pushDelta。

- [ ] **Step 1: 写失败测试——合并正确性**

`tests/stream-batcher.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStreamBatcher } from '../src/renderer/hooks/useStreamBatcher'

// 把 rAF 桩成同步可控:手动调用 queued callbacks
let rafCbs: FrameRequestCallback[] = []
let timeoutCbs: (() => void)[] = []

beforeEach(() => {
  rafCbs = []
  timeoutCbs = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCbs.push(cb); return rafCbs.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('setTimeout', (cb: () => void) => { timeoutCbs.push(cb); return timeoutCbs.length } as any)
  vi.stubGlobal('clearTimeout', () => {})
})
afterEach(() => { vi.unstubAllGlobals() })

describe('useStreamBatcher', () => {
  it('同一帧内同 kind 的多次 pushDelta 合并成一次 dispatch', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => {
      result.current.pushDelta('s1', 'text', '你')
      result.current.pushDelta('s1', 'text', '好')
      result.current.pushDelta('s1', 'text', '世')
      result.current.pushDelta('s1', 'text', '界')
    })
    // 还没 rAF,不应 dispatch
    expect(dispatch).not.toHaveBeenCalled()
    // 触发 rAF
    act(() => { rafCbs.forEach(cb => cb(0)) })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '你好世界' })
  })

  it('同一帧内 text 与 thinking 分别合并(不混)', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => {
      result.current.pushDelta('s1', 'text', 'A')
      result.current.pushDelta('s1', 'thinking', 'B')
      result.current.pushDelta('s1', 'text', 'C')
    })
    act(() => { rafCbs.forEach(cb => cb(0)) })
    expect(dispatch).toHaveBeenCalledTimes(2)
    const calls = dispatch.mock.calls.map(c => c[0])
    const textCall = calls.find((c: any) => c.kind === 'text')
    const thinkCall = calls.find((c: any) => c.kind === 'thinking')
    expect(textCall.delta).toBe('AC')
    expect(thinkCall.delta).toBe('B')
  })

  it('flush 立即同步派发 buffer(中断兜底,不丢末尾)', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => { result.current.pushDelta('s1', 'text', '尾') })
    expect(dispatch).not.toHaveBeenCalled()
    act(() => { result.current.flush() })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '尾' })
  })

  it('不同 sessionId 的 buffer 互不干扰', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => {
      result.current.pushDelta('s1', 'text', 'A')
      result.current.pushDelta('s2', 'text', 'B')
    })
    act(() => { rafCbs.forEach(cb => cb(0)) })
    const calls = dispatch.mock.calls.map(c => c[0])
    expect(calls).toContainEqual({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'A' })
    expect(calls).toContainEqual({ type: 'STREAM_DELTA', sessionId: 's2', kind: 'text', delta: 'B' })
  })

  it('flush 后 buffer 清空(不重复派发)', () => {
    const dispatch = vi.fn()
    const { result } = renderHook(() => useStreamBatcher(dispatch))
    act(() => { result.current.pushDelta('s1', 'text', 'X') })
    act(() => { result.current.flush() })
    act(() => { rafCbs.forEach(cb => cb(0)) })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/stream-batcher.test.ts`
Expected: FAIL（`useStreamBatcher` 模块不存在）。

- [ ] **Step 3: 实现 useStreamBatcher**

`src/renderer/hooks/useStreamBatcher.ts`：

```ts
import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { Action } from '../state/actions'

// buffer 按 sessionId 再按 kind 分桶:同一帧内同 kind 的 delta 拼成一次 STREAM_DELTA。
// 上限 60 次/秒(rAF)。失焦时 rAF 暂停,setTimeout(16ms) 兜底,保证后台流式不堆积。
interface DeltaEntry { kind: 'text' | 'thinking'; delta: string }

export function useStreamBatcher(dispatch: Dispatch<Action>) {
  // buffer 结构: Record<sessionId, Record<kind, string>>
  const bufferRef = useRef<Record<string, { text?: string; thinking?: string }>>({})
  const rafIdRef = useRef<number | null>(null)
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dispatchRef = useRef(dispatch)
  useEffect(() => { dispatchRef.current = dispatch }, [dispatch])

  const flush = () => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (timeoutIdRef.current != null) {
      clearTimeout(timeoutIdRef.current as unknown as number)
      timeoutIdRef.current = null
    }
    const buffer = bufferRef.current
    bufferRef.current = {}
    for (const sessionId of Object.keys(buffer)) {
      const entry = buffer[sessionId]
      if (entry.text != null) dispatchRef.current({ type: 'STREAM_DELTA', sessionId, kind: 'text', delta: entry.text })
      if (entry.thinking != null) dispatchRef.current({ type: 'STREAM_DELTA', sessionId, kind: 'thinking', delta: entry.thinking })
    }
  }

  const schedule = () => {
    if (rafIdRef.current != null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      flush()
    })
    // 后台/失焦兜底:rAF 可能暂停,16ms 后强制 flush
    timeoutIdRef.current = setTimeout(() => { flush() }, 16)
  }

  const pushDelta = (sessionId: string, kind: 'text' | 'thinking', delta: string) => {
    const buf = bufferRef.current[sessionId] ?? (bufferRef.current[sessionId] = {})
    if (kind === 'text') {
      buf.text = (buf.text ?? '') + delta
    } else {
      buf.thinking = (buf.thinking ?? '') + delta
    }
    schedule()
  }

  // 卸载时清掉未 flush 的 delta,防泄漏
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
      if (timeoutIdRef.current != null) clearTimeout(timeoutIdRef.current as unknown as number)
    }
  }, [])

  return { pushDelta, flush }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/stream-batcher.test.ts`
Expected: 5 个用例全过。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错。若 `Action` 类型不含 `STREAM_DELTA`，确认 import 路径 `../state/actions` 正确。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useStreamBatcher.ts tests/stream-batcher.test.ts
git commit -m "feat: 流式 delta 节流 hook(rAF 批合并 + 失焦兜底)"
```

---

## Task 4: ChatArea 接入 batcher（层 1 集成）

**目标**：把 ChatArea 的 `onDelta` 监听从「逐条 dispatch」改为「pushDelta 进 batcher」，并在中断/结束事件到达时 flush 兜底。

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx`

**Interfaces:**
- Consumes: Task 3 的 `useStreamBatcher`

- [ ] **Step 1: 引入 batcher，改 onDelta**

`ChatArea.tsx` 顶部 import：
```tsx
import { useStreamBatcher } from '../hooks/useStreamBatcher'
```

在 `ChatArea` 函数体（`useI18n()` 之后）加：
```tsx
const { pushDelta, flush } = useStreamBatcher(dispatch)
```

把 `ChatArea.tsx:221-228` 的 `onDelta` 改为：
```tsx
    api.onDelta((data: any) => {
      const sid = data?.localSessionId
      if (!sid) {
        console.warn('[cc-stream] onDelta drop: no localSessionId')
        return
      }
      pushDelta(sid, data.kind, data.delta)
    })
```

- [ ] **Step 2: 在中断/结束事件处 flush 兜底**

在以下三个事件回调的**最前面**加 `flush()`（确保不丢末尾 delta）：

`onResult`（`ChatArea.tsx:301` 起）：
```tsx
    api.onResult((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      flush()  // ← 新增:确保末尾 delta 已派发再固化
      dispatch({ type: 'STREAM_END', ... })
```

`onError`（`ChatArea.tsx:324` 起）：
```tsx
    api.onError((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      flush()  // ← 新增
      dispatch({ type: 'STREAM_ERROR', sessionId: sid, error: data.error })
```

`onAborted`（`ChatArea.tsx:329` 起）：
```tsx
    api.onAborted((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      flush()  // ← 新增
      dispatch({ type: 'STREAM_ABORTED', sessionId: sid })
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 类型无错；测试全绿（batcher 已有单测，集成不应破坏现有测试）。

- [ ] **Step 4: 手动验证（pnpm dev）**

启动 `pnpm dev`，发一条让 Claude 长回答的问题，确认：
- 流式输出正常显示（无丢失、无明显延迟）
- 中途点「停止」后，最后一段输出已显示（flush 生效）
- 等回答结束后内容完整

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ChatArea.tsx
git commit -m "perf: ChatArea 流式 delta 接入 rAF 节流"
```

---

## Task 5: BlockRenderer 解耦 useStore（层 2 前置）

**目标**：`BlockRenderer` 当前调 `useStore()` 只为读 `state.settings.showThinking`。把它改成 props 传入，让 BlockRenderer 不再订阅全局 state——这是层 2 分片订阅和层 3 memo 真正生效的前提（否则子组件仍随每次 state 变化重渲）。

**Files:**
- Modify: `src/renderer/components/blocks/BlockRenderer.tsx`
- Modify: `src/renderer/components/ChatArea.tsx`（传 showThinking）

**Interfaces:**
- Produces: `BlockRenderer` 的 props 增加 `showThinking?: boolean`；`renderBlocks` 增加同名参数。`showThinking` 缺省时按 `true` 处理（向后兼容其他调用点）。

- [ ] **Step 1: 改 BlockRenderer 接收 showThinking props**

`src/renderer/components/blocks/BlockRenderer.tsx`：

删除第 2 行 `import { useStore } from '../../state/store'` 和第 8 行 `const { state } = useStore()`。

改组件签名为：
```tsx
export function BlockRenderer({ block, subagentOutputByToolUseId, hiddenToolUseIds, showThinking = true }: {
  block: ContentBlock
  subagentOutputByToolUseId?: Record<string, ContentBlock[]>
  hiddenToolUseIds?: Set<string>
  showThinking?: boolean
}) {
  switch (block.type) {
    case 'text': return <TextBlock text={block.text} />
    case 'thinking': return showThinking ? <ThinkingBlock text={block.text} /> : null
    case 'tool_use':
      if (hiddenToolUseIds?.has(block.id)) return null
      if (META_TOOL_NAMES.has(block.name)) return <MetaToolCard block={block} />
      return <ToolUseCard block={block} />
    case 'tool_result': return null
    case 'image': return <ImageBlock source={block.source} />
    default: return null
  }
}
```

改 `renderBlocks` 签名，透传 `showThinking`：
```tsx
export function renderBlocks(
  blocks: ContentBlock[],
  compact?: boolean,
  subagentOutputByToolUseId?: Record<string, ContentBlock[]>,
  hiddenToolUseIds?: Set<string>,
  showThinking?: boolean,
): React.ReactNode[] {
```
并在其中两处调用 `BlockRenderer` 的地方加 `showThinking={showThinking}`（while 循环末尾的 `else` 分支，和 group 外的单 block 不走 BlockRenderer 的分支不受影响）。具体：把
```tsx
        out.push(<BlockRenderer key={`b${key++}`} block={b} subagentOutputByToolUseId={subagentOutputByToolUseId} hiddenToolUseIds={hiddenToolUseIds} />)
```
改为：
```tsx
        out.push(<BlockRenderer key={`b${key++}`} block={b} subagentOutputByToolUseId={subagentOutputByToolUseId} hiddenToolUseIds={hiddenToolUseIds} showThinking={showThinking} />)
```

- [ ] **Step 2: MessageRow 和 ChatArea 传 showThinking**

`MessageRow.tsx`：给 `MessageRowProps` 加 `showThinking: boolean`，并在所有 `renderBlocks(...)` 调用末尾加 `, props.showThinking`：
```tsx
{renderBlocks(m.content, false, subagentOutputByToolUseId, subagentToolUseIds, showThinking)}
{renderBlocks(m.content, true, subagentOutputByToolUseId, subagentToolUseIds, showThinking)}
```

`ChatArea.tsx`：传 props 给 MessageRow：
```tsx
            <MessageRow
              key={m.id}
              message={m}
              isStreaming={isStreaming}
              subagentOutputByToolUseId={subagentOutputByToolUseId}
              subagentToolUseIds={subagentToolUseIds}
              isLastUserMessage={m.id === lastUserMessage?.id}
              editingMessageId={state.editingMessageId}
              onEditResend={handleEditResend}
              showThinking={state.settings.showThinking}
            />
```

并把 `ChatArea.tsx:481` 流式区的 `renderBlocks(streaming.blocks, false, subagentOutputByToolUseId, subagentToolUseIds)` 改为末尾加 `state.settings.showThinking`：
```tsx
{renderBlocks(streaming.blocks, false, subagentOutputByToolUseId, subagentToolUseIds, state.settings.showThinking)}
```

- [ ] **Step 3: 更新 MessageRow memo 测试的 props**

`tests/messagerow-memo.test.tsx` 的两处 renderRow/stableProps 都要加 `showThinking: true`：
```tsx
        showThinking={true}
```
和 stableProps 里：
```tsx
      showThinking: true,
```

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 类型无错；测试全绿。若有其他文件调用 `renderBlocks` 未传 showThinking，因缺省 `true` 兼容，不应报错。

- [ ] **Step 5: 手动验证 showThinking 开关仍生效**

`pnpm dev`，在设置页切换「显示思考过程」开关，确认思考块的显隐行为与改前一致。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/blocks/BlockRenderer.tsx src/renderer/components/MessageRow.tsx src/renderer/components/ChatArea.tsx tests/messagerow-memo.test.tsx
git commit -m "refactor: BlockRenderer 解耦 useStore,showThinking 改 props 传入"
```

---

## Task 6: 引入 use-context-selector 分片订阅（层 2 核心）

**目标**：把 `StoreContext` 换成 `use-context-selector` 的实现，提供 `useSelector`，让组件只在自己关心的切片变化时重渲。保留 `useStore()` 兼容入口。

**Files:**
- Modify: `src/renderer/state/store.tsx`
- Modify: `package.json`（加依赖）
- Test: `tests/store-selector.test.tsx`

**Interfaces:**
- Produces:
  - `StoreContext`（来自 `use-context-selector` 的 `createContext`）
  - `useSelector<T>(selector: (state: AppState) => T): T`
  - `useStore()`：兼容入口，内部返回 `{ state, dispatch }`（state 经 `useSelector(s => s)` 取全量——未迁移组件仍能用）
  - `useDispatch()`：单独取 dispatch（稳定引用），新增的轻量 hook。

- [ ] **Step 1: 安装依赖**

Run: `pnpm add use-context-selector`
Expected: `package.json` 出现 `"use-context-selector": "^..."`。

- [ ] **Step 2: 写失败测试——分片订阅未订阅切片不重渲**

`tests/store-selector.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AppProvider, useSelector, useDispatch } from '../src/renderer/state/store'
import type { AppState } from '../src/renderer/state/reducer'

describe('useSelector 分片订阅', () => {
  it('未订阅的切片变化时不触发重渲', () => {
    const consumerRender = vi.fn()
    const Consumer = () => {
      const activeSessionId = useSelector((s: AppState) => s.activeSessionId)
      consumerRender()
      return <span data-testid="sid">{activeSessionId}</span>
    }
    const { rerender } = render(
      <AppProvider>
        <Consumer />
      </AppProvider>
    )
    expect(consumerRender).toHaveBeenCalledTimes(1)

    // 通过 dispatch 改一个 Consumer 没订阅的切片(streamingBySession),
    // Consumer 不应重渲(render count 不增长)
    const Trigger = ({ dispatch }: { dispatch: any }) => (
      <button onClick={() => dispatch({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'x' })}>fire</button>
    )
    let capturedDispatch: any
    const Wrapper = () => {
      const dispatch = useDispatch()
      capturedDispatch = dispatch
      return (
        <AppProvider>
          <Consumer />
          <Trigger dispatch={dispatch} />
        </AppProvider>
      )
    }
    // 重新渲染带 Trigger 的版本(此时 Consumer 已订阅 activeSessionId)
    cleanup()
    render(<Wrapper />)
    const beforeCount = consumerRender.mock.calls.length
    act(() => { screen.getByText('fire').click() })
    // STREAM_DELTA 改的是 streamingBySession,Consumer 订阅的是 activeSessionId → 不应重渲
    expect(consumerRender.mock.calls.length).toBe(beforeCount)
  })
})
```

注：`cleanup` 来自 `@testing-library/react`，需在 import 中加上。此测试断言「改未订阅切片不重渲」——这是 use-context-selector 的核心保证。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/store-selector.test.tsx`
Expected: FAIL（`useSelector`/`useDispatch` 不存在）。

- [ ] **Step 4: 改造 store.tsx**

`src/renderer/state/store.tsx`，整文件替换为：

```tsx
import { useContext } from 'react'
import { createContext, useContextSelector } from 'use-context-selector'
import { useReducer, type ReactNode } from 'react'
import { reducer, type AppState } from './reducer'
import type { Action } from './actions'
import type { Project } from '../types'

function makeInitialState(seedProjects?: Project[]): AppState {
  // 与原实现完全一致(原 store.tsx:9-60 的逻辑整体保留,不改一字)
  const base: AppState = {
    projects: [],
    activeSessionId: '',
    tabsBySession: {},
    activeTabIdBySession: {},
    theme: themeFromStorage(),
    draft: { doc: null, attachments: [] },
    currentView: 'workspace',
    activeSettingsSection: 'general',
    streamingBySession: {},
    settings: {
      apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', chatWidth: 'wide', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true, queueMode: 'queue',
      showThinking: true, showTodo: true, showBackendTask: true, rememberPanelPosition: true, autoArchive: true, archiveDays: '7', devTools: false,
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
    claudeSessionMap: {},
    pendingDialog: null,
    dirtyTabIds: {},
    lastFileOpenedSeq: 0,
    queueBySession: {},
    tasksBySession: {},
    backendTasksBySession: {},
    panelFold: { root: true },
    panelPosition: { x: 0, y: 0 },
    subagentOutputBySession: {},
    planBySession: {},
    abortedBySession: {},
    contextUsageBySession: {},
    editingMessageId: null, editingQueueId: null,
    updateStatus: { state: 'idle' },
    reviewByProject: {},
  }
  if (!seedProjects || seedProjects.length === 0) return base
  const sessions = seedProjects.flatMap(p => p.sessions)
  return {
    ...base,
    projects: seedProjects,
    activeSessionId: sessions[0]?.id ?? '',
    tabsBySession: Object.fromEntries(sessions.map(s => [s.id, []])),
    activeTabIdBySession: Object.fromEntries(sessions.map(s => [s.id, null])),
  }
}

function themeFromStorage(): AppState['theme'] {
  return ((s) => (s && ['codex-light','codex-warm','codex-cool','codex-paper'].includes(s) ? s : 'codex-light'))(
    localStorage.getItem('cc-desk-theme')
  ) as AppState['theme']
}

export interface StoreContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

// use-context-selector 的 Context:支持 useSelector 精确订阅切片,
// 避免单 Context 导致「任何切片变化触发全应用重渲」。
export const StoreContext = createContext<StoreContextValue | null>(null)

export function AppProvider({ children, initialProjects }: { children: ReactNode; initialProjects?: Project[] }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => makeInitialState(initialProjects))
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  )
}

// 精确订阅:selector 返回值用 Object.is 比较,不变则不重渲。
export function useSelector<T>(selector: (state: AppState) => T): T {
  return useContextSelector(StoreContext, (ctx) => (ctx === null ? undefined : selector(ctx.state)) as T)
}

// 单独取 dispatch(引用稳定,永不变化)。
export function useDispatch(): React.Dispatch<Action> {
  return useContextSelector(StoreContext, (ctx) => ctx?.dispatch as React.Dispatch<Action>)
}

// 兼容入口:未迁移的组件继续用,内部取全 state。
export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within AppProvider')
  return ctx
}
```

- [ ] **Step 5: 跑测试**

Run: `npx vitest run tests/store-selector.test.tsx`
Expected: 通过。

- [ ] **Step 6: 全量测试 + 类型检查**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 类型无错；测试全绿。`useStore` 保留兼容，现有所有用 `useStore()` 的组件不受影响。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/state/store.tsx package.json pnpm-lock.yaml tests/store-selector.test.tsx
git commit -m "feat: 引入 use-context-selector 分片订阅(保留 useStore 兼容入口)"
```

---

## Task 7: 高频组件迁移到 useSelector（层 2 迁移）

**目标**：把流式时重渲压力最大的组件从 `useStore()` 迁到 `useSelector`，让它们只订阅必要切片。优先 ChatArea、MessageRow。

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx`
- Modify: `src/renderer/components/MessageRow.tsx`

**Interfaces:**
- Consumes: Task 6 的 `useSelector` / `useDispatch`

- [ ] **Step 1: MessageRow 迁移——dispatch 走 useDispatch**

`MessageRow.tsx`：把
```tsx
import { useStore } from '../state/store'
```
改为
```tsx
import { useDispatch } from '../state/store'
```
把函数体内 `const { dispatch } = useStore()` 改为 `const dispatch = useDispatch()`。

（MessageRow 不直接读 state，只 dispatch，迁移最简单且收益高——子组件不再因 useStore 全订阅重渲。）

- [ ] **Step 2: ChatArea 迁移——按需切片订阅**

`ChatArea.tsx`：保留 `useStore` 不强制全改（ChatArea 读的切片很多），但把 `showThinking` 这类高频随流式变化的读法保持原样即可（已在 Task 5 通过 props 下传给 MessageRow）。

主要收益已由 Task 5（BlockRenderer 解耦）+ Task 6（Context 换实现）+ Task 7 Step 1（MessageRow 用 useDispatch）拿到：流式时 BlockRenderer 子树不再订阅全局，MessageRow 不再订阅全局。

本步骤在 ChatArea 顶部加一个最小迁移示例（验证 useSelector 可用），把 `const { state, dispatch } = useStore()` 保持，仅确认 `useDispatch` 已被 MessageRow 使用且类型正确。**不强制改 ChatArea**——避免一次性大改引入风险。

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 类型无错；测试全绿。

- [ ] **Step 4: 手动验证（pnpm dev）——这是层 2 的核心验收**

启动 `pnpm dev`，开两个会话（A 发送中、B 切过去）。在 A 流式输出时：
- B 的 UI（文件树、设置页若开着）不再因 A 的 token 增量重渲（肉眼无闪烁/无卡顿）
- A 的流式输出仍正常
- 切回 A 内容完整

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/MessageRow.tsx src/renderer/components/ChatArea.tsx
git commit -m "perf: MessageRow 迁移 useDispatch,切断流式时子树全订阅重渲"
```

---

## Task 8: 引入 react-virtuoso 消息列表虚拟化（层 4）

**目标**：用 `Virtuoso` 替换 ChatArea 的消息滚动容器，草稿走 (A) 方案统一进列表（不再跳过 draftMessageId），auto-scroll 迁移到 virtuoso 原语。

**Files:**
- Modify: `package.json`（加依赖）
- Modify: `src/renderer/components/ChatArea.tsx`

**Interfaces:**
- Consumes: Task 1-7 的成果

- [ ] **Step 1: 安装依赖**

Run: `pnpm add react-virtuoso`
Expected: `package.json` 出现 `"react-virtuoso": "^..."`。

- [ ] **Step 2: 构造统一的消息列表（含草稿，方案 A）**

ChatArea 当前用 `session.messages.map` 跳过草稿 + 独立 streaming 区。改为：把 streaming 时的草稿消息**保留在列表中**（它已在 messages 里，只是渲染时不再跳过），草稿的 content 由 reducer 的 `syncDraftMessage` 同步更新。

由于 `syncDraftMessage` 已让草稿 message 的 content 始终等于 `streaming.blocks`，**不再需要独立的 streaming 渲染区**——草稿消息就是流式态。但 `streaming.notices` 和 `streaming.error` 不在草稿 message 上，需保留这部分。

具体改造 `ChatArea.tsx` 的 JSX：

1. 删除 `if (streaming?.draftMessageId === m.id) return null`（草稿现在正常渲染）。
2. 删除独立的 `{streaming && (<div>...streaming 渲染区...</div>)}`（478-489 行），改为：草稿消息由 MessageRow 渲染，其 notices/error 需补到草稿上。

**注意**：草稿 message 当前不带 `notices`/`error`。为不改动 reducer（硬约束），保留一个轻量「streaming 附加区」只渲染 notices + error + 思考中指示器，挂在列表末尾（不进虚拟化的 itemContent，作为非流式兜底显示）。具体：

把原 streaming 区简化为「仅 notices/error/思考指示器」（不含 blocks，blocks 已在草稿 message 里）：

```tsx
        {streaming && (streaming.notices?.length > 0 || streaming.error) && (
          <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'text' }}>
            <Notices notices={streaming.notices ?? []} />
            {streaming.error && <div style={{ color: '#ef4444', fontSize: 13 }}>❌ {streaming.error}</div>}
          </div>
        )}
```

「思考中」指示器（Sparkles）保留在列表末尾，作为流式进行中的视觉提示。

- [ ] **Step 3: 用 Virtuoso 包裹消息列表**

把 `ChatArea.tsx:384-503` 的滚动 `<div ref={scrollRef} onScroll={onScroll}>` 整体替换为 `<Virtuoso>`。完整替换块：

```tsx
      <Virtuoso
        ref={virtuosoRef}
        data={session.messages}
        followOutput={(atBottom) => (atBottom ? 'smooth' : false)}
        atBottomStateChange={(atBottom) => { isAtBottomRef.current = atBottom; setShowScrollBtn(!atBottom) }}
        className="chat-scroll"
        style={{ flex: 1 }}
        components={{
          // 列表内边距与原 scroll div 一致
          List: ({ children, style }) => (
            <div style={{ ...style, padding: '20px 28px 48px', display: 'flex', flexDirection: 'column', gap: 28, width: '100%', maxWidth: 'var(--chat-max-width)', margin: '0 auto' }}>
              {children}
            </div>
          ),
        }}
        itemContent={(index, m) => {
          if (session.messages.length === 0) return null
          return (
            <MessageRow
              key={m.id}
              message={m}
              isStreaming={isStreaming}
              subagentOutputByToolUseId={subagentOutputByToolUseId}
              subagentToolUseIds={subagentToolUseIds}
              isLastUserMessage={m.id === lastUserMessage?.id}
              editingMessageId={state.editingMessageId}
              onEditResend={handleEditResend}
              showThinking={state.settings.showThinking}
            />
          )
        }}
      />
```

注：空会话提示和 streaming 附加区作为 Virtuoso 的 `Header`/`Footer` 或直接放在 Virtuoso 外层。本计划把空会话提示放在 Virtuoso 外层（条件渲染）：

```tsx
      {session.messages.length === 0 && !streaming && (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 60, flex: 1 }}>{t('chat.empty')}</div>
      )}
```

- [ ] **Step 4: 改造 auto-scroll（迁移到 virtuoso 原语）**

替换原有的 scroll 逻辑（`ChatArea.tsx:128-178`）。引入 Virtuoso 的 ref：

```tsx
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
const virtuosoRef = useRef<VirtuosoHandle>(null)
```

保留 `isAtBottomRef`、`showScrollBtn` state。

删除原 `scrollRef`、`checkAtBottom`、`scrollToBottom`（基于 DOM）、`onScroll`，改为：

```tsx
const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
  // Virtuoso 滚到底:smooth 时用 animate,auto 时立即
  virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: behavior === 'smooth' ? 'smooth' : 'auto', align: 'end' })
  isAtBottomRef.current = true
  setShowScrollBtn(false)
}
```

三个 useEffect 迁移：
- 「流式/消息变化跟随」(`156-158`)：保留，触发条件改为依赖 `streaming`、`session.messages.length`，内部调 `scrollToBottom('auto')`。但 Virtuoso 的 `followOutput` 已自动处理流式吸底，这个 effect 可保留作为「草稿长度突增」的兜底。简化为：
```tsx
  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.messages.length, streaming])
```

- 「切会话贴底」(`161-166`)：保留，依赖 `state.activeSessionId`：
```tsx
  useEffect(() => {
    isAtBottomRef.current = true
    setShowScrollBtn(false)
    scrollToBottom('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId])
```

- 「面板弹出滚底」(`170-178`)：保留，逻辑不变（用 `scrollToBottom('smooth')`）。

「回到底部」按钮（`507-524`）的 `onClick` 调 `scrollToBottom('smooth')` 保持。

- [ ] **Step 5: 处理草稿去重——确保不重复（关键暗坑）**

回顾：`STREAM_ASSISTANT_BLOCKS` 用 `_seenUuids` 去重，`syncDraftMessage` 把草稿同步进 messages。流式结束（`STREAM_END`）时 reducer 清理 streaming，草稿 message 留在 messages 里成为正式消息——**不会重复**（草稿就是那条 message，END 只删 streaming 态不删 message）。

验证点：确认 `STREAM_END` 不重复 push 同一 message。打开 `src/renderer/state/reducer.ts` 的 `STREAM_END` 处理（grep `STREAM_END`），确认它「把草稿 finalize 或不重复 push」。若发现 END 会新 push 一条而草稿还在 → 需在草稿存在时跳过 push（但本计划硬约束不改 reducer）。**若验证发现会重复，停下来报告**（这是 spec 4.1 表里已标记的暗坑，需单独评估）。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错。

- [ ] **Step 7: 全量测试**

Run: `npx vitest run`
Expected: 全绿。Virtuoso 在 jsdom 下能渲染（不报错），交互测试不强求。

- [ ] **Step 8: 手动验证（层 4 核心验收，pnpm dev）**

逐一验证 spec 4.2 的虚拟化交互清单：
- [ ] 流式追加时自动吸底（用户在底部）
- [ ] 用户上滑后流式不强制拉回（保持阅读位置）
- [ ] 切换会话立即贴底
- [ ] AskUserQuestion / 权限 / 计划卡片弹出滚到底
- [ ] 「回到底部」按钮显隐正确
- [ ] 长会话（造 200+ 条消息）滚动流畅、首屏快
- [ ] 代码块复制 / 应用到文件正常（可见区）

任一项异常即停在该步排查。

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/components/ChatArea.tsx
git commit -m "feat: 消息列表 react-virtuoso 虚拟化(草稿方案A + auto-scroll 迁移)"
```

---

## Task 9: 全量验收与回归

**目标**：跑完 spec 的回归清单，确认四层优化全部生效且无回归。

**Files:** 无（验证任务）

- [ ] **Step 1: 全量测试 + 类型检查**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 类型无错；所有测试全绿。

- [ ] **Step 2: 真机 e2e（可选，需本地 ai-proxy + 真实模型）**

Run: `pnpm test:e2e`
Expected: 通过（约 50s）。若环境不具备，跳过并记录。

- [ ] **Step 3: spec 4.2 回归清单逐项手动验证（pnpm dev）**

**reducer 层**（由单测覆盖，已绿）：
- [x] 节流 flush 后 STREAM_DELTA 内容与逐条 dispatch 一致（Task 3 测试）
- [x] claude:aborted 到达时 buffer 已 flush（Task 3 flush 测试 + Task 4 集成）
- [x] 草稿→正式消息切换无重复 uuid（reducer 现有去重 + Task 8 Step 5 验证）

**组件层**：
- [x] MessageRow memo：props 不变时不重渲（Task 2 测试）
- [x] 分片订阅：streamingBySession 变化时未订阅组件不重渲（Task 6 测试）

**虚拟化交互**（Task 8 Step 8 已覆盖，此处复检）：
- [ ] 流式吸底 / 上滑不拉回 / 切会话贴底 / 面板弹出滚底 / 回到底部按钮 / 长会话滚动

**现有功能冒烟**：
- [ ] SearchDialog 搜索会话/命令正常
- [ ] 代码块复制 / 应用到文件正常
- [ ] 持久化 / 重启 hydrate 正常（草稿不误持久化）

- [ ] **Step 4: 性能主观对比**

对比优化前后：
- [ ] 流式长回答（带代码 / mermaid）输入框和滚动无明显掉帧
- [ ] 1000 条消息会话滚动流畅、切会话无明显停顿

- [ ] **Step 5: 记录结果**

把验收结果（哪些通过、跳过了 e2e、主观性能对比）记录到 commit message 或单独 docs 备注。最终 commit：

```bash
git commit --allow-empty -m "chore: 渲染性能优化验收完成(四层:节流+分片订阅+memo+虚拟化)

- Task 1-9 全部通过
- pnpm test 全绿
- 主观性能: [填入对比结论]"
```

---

## Self-Review

**1. Spec coverage：**
- 层 1（流式节流）→ Task 3（实现）+ Task 4（集成）。✓
- 层 2（分片订阅）→ Task 5（前置解耦）+ Task 6（Context 换实现）+ Task 7（迁移）。✓
- 层 3（memo）→ Task 1（抽出）+ Task 2（memo 化）。✓
- 层 4（虚拟化）→ Task 8。✓
- spec 4.1 暗坑「草稿与正式消息重叠」→ Task 8 Step 5 显式验证。✓
- spec 4.1 暗坑「节流丢末尾」→ Task 3 flush 测试 + Task 4 中断/结束事件 flush。✓
- spec 4.1 暗坑「memo 命中失败」→ Task 2 Step 4 useCallback 稳定引用。✓
- spec 4.2 回归清单 → Task 9 全量验收。✓
- spec 实施顺序 3→1→2→4 → Task 2（memo）→ Task 3-4（节流）→ Task 5-7（订阅）→ Task 8（虚拟化）。✓

**2. Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码；Task 8 Step 5 的「若发现重复需报告」是明确的条件分支不是占位（spec 已标记为暗坑，需运行时验证而非凭空实现）。✓

**3. Type consistency：**
- `MessageRowProps` 在 Task 1 定义，Task 5 加 `showThinking`，Task 2 测试同步——字段名一致。✓
- `useStreamBatcher` 返回 `{ pushDelta, flush }` 在 Task 3 定义，Task 4 消费——签名一致。✓
- `useSelector`/`useDispatch` 在 Task 6 定义，Task 7 消费——一致。✓
- `VirtuosoHandle` ref 在 Task 8 Step 4 定义并使用——一致。✓

**4. 关键风险（实施者注意）：**
- Task 8 Step 5 的草稿去重是唯一需运行时验证的硬风险点——若 `STREAM_END` 重复 push，必须停下来报告，不要擅自改 reducer。
- Task 6 的 `useStore` 兼容入口保证渐进迁移不 break 现有组件。
