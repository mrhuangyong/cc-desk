# 对话区事件全量处理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让对话区正确处理 Claude Agent SDK 的所有事件——消息存为结构化 content blocks（文本/思考/工具调用/工具结果/图片），主进程归一化全部 message type，并接入 AskUserQuestion 交互（底部答题面板）。

**Architecture:** 分层归一化。主进程把所有 SDK message 归一化为 5 种 IPC 载荷（delta/blocks/notice/system/result）+ 交互载荷（dialog-request/dialog-response）。渲染端只认 ContentBlock/SystemNotice，reducer 实时拼接流式 blocks，结束時固化成 Message。AskUserQuestion 通过 `onUserDialog` 回调桥接为请求-响应 IPC，底部 InputDock 双态切换。

**Tech Stack:** Electron + React + TypeScript、@anthropic-ai/claude-agent-sdk、vitest。状态管理用现有 useReducer（`src/renderer/state/`）。

**Spec:** `docs/superpowers/specs/2026-06-17-chat-events-full-design.md`

---

## File Structure

**新建：**
- `src/main/claude-normalize.ts` — 主进程归一化纯函数（normalizeBetaBlocks / extractToolResults / mkNotice / 各 *Text）。独立文件，可单测。
- `src/renderer/components/blocks/` — block 渲染组件目录：
  - `TextBlock.tsx`、`ThinkingBlock.tsx`、`ToolUseCard.tsx`、`ImageBlock.tsx`、`BlockRenderer.tsx`（按 type 分发）
- `src/renderer/components/Notices.tsx` — 状态型 notice 行
- `src/renderer/components/InputDock.tsx` — 底部容器，双态切换 InputBar / AnswerPanel
- `src/renderer/components/AnswerPanel.tsx` — AskUserQuestion 答题面板
- `tests/claude-normalize.test.ts` — 归一化纯函数单测
- `tests/blocks-reducer.test.ts` — 流式 blocks 拼接单测

**修改：**
- `src/renderer/types.ts` — Message.content 改 ContentBlock[]；新增 SystemNotice、ContentBlock、ToolResult、pendingDialog 相关类型
- `src/renderer/state/actions.ts` — 新增流式/dialog actions
- `src/renderer/state/reducer.ts` — streamingBySession 改 blocks/notices 结构；流式拼接规约；STREAM_END 固化；新增 dialog reducer； SEND_MESSAGE/STREAM_START 等适配
- `src/renderer/state/store.tsx` — AppState 加 pendingDialog；初始值
- `src/renderer/components/ChatArea.tsx` — 监听新通道；按 block 渲染；notice 行；元数据；用 InputDock
- `src/renderer/components/InputBar.tsx` — 移除已废调试日志；doSend 维持（不再改）
- `src/main/claude-service.ts` — 重写 for-await 为归一化 switch；挂 onUserDialog；dialog 桥接器
- `src/main/index.ts` — 新增 `claude:dialog-response` handler；清理调试日志（保留节点4）
- `src/preload/index.ts` — 替换为新 6+2 通道
- `tests/reducer.test.ts` — 适配新 content 结构（见 Task 2 说明）
- `tests/fixtures.ts` — seedProjects 的 message content 适配为 blocks

**旧数据策略：** Message.content 改为 blocks，旧 snapshot 不兼容——Task 1 在 projects-store 加载处清掉旧消息（用户已确认）。

---

## Task 1: 数据模型与类型（types.ts）

**Files:**
- Modify: `src/renderer/types.ts`

- [ ] **Step 1: 替换 Message 类型并新增 block/notice 类型**

把 `src/renderer/types.ts` 里的 `Message` interface 替换为：

```ts
// ===== 对话内容 block =====
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: any
      status: 'running' | 'completed' | 'error'
      result?: ToolResult
    }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'image'; source: string }

export interface ToolResult {
  content: string
  isError: boolean
}

// 状态型提示（权限拒绝/API重试/status 等），固化进历史消息
export interface SystemNotice {
  id: string
  kind:
    | 'permission_denied' | 'api_retry' | 'status' | 'hook_progress'
    | 'task' | 'error' | 'info' | 'compact' | 'auth'
  text: string
  level: 'info' | 'warn' | 'error'
}

// 消息：对话流中的一条
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[]
  attachment?: PickedElement
  notices?: SystemNotice[]
  costUSD?: number
  durationMs?: number
  turns?: number
  isError?: boolean
}
```

- [ ] **Step 2: 运行类型检查，预期大面积报错（reducer/fixtures/ChatArea 引用 content 当 string）**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 多处 `Property 'content' does not exist on type 'never'` 或 string/blocks 不兼容错误——这些会在后续 task 修复。**此步只确认 types.ts 自身无语法错误。**

- [ ] **Step 3: Commit**

```bash
git add src/renderer/types.ts
git commit -m "refactor(types): Message.content 改为 ContentBlock[]，新增 SystemNotice/block 类型"
```

---

## Task 2: reducer 与 fixtures 适配新 content 结构（基础形态）

本 task 只把现有 reducer/fixtures 从 `content: string` 适配到 `content: ContentBlock[]`，**先不做流式 blocks 拼接**（下一 task 做）。目标是让类型检查和现有测试重新通过。

**Files:**
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`
- Modify: `tests/fixtures.ts`
- Modify: `tests/reducer.test.ts`

- [ ] **Step 1: 适配 fixtures.ts 的 seed message content 为 blocks**

读 `tests/fixtures.ts`，把所有 message 的 `content: '某字符串'` 改为 `content: [{ type: 'text', text: '某字符串' }]`。例如：

```ts
// 改前
{ id: 'm1', role: 'user', content: '你好' }
// 改后
{ id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }] }
```

- [ ] **Step 2: reducer.ts 里 SEND_MESSAGE 用 blocks 存用户消息**

在 `reducer.ts` 找到 `SEND_MESSAGE` case，把追加用户消息处的 `content: <string>` 改为 blocks。原来若为 `content: draftText`，改为：

```ts
messages: [...s.messages, {
  id: `m${Date.now()}`,
  role: 'user' as const,
  content: [{ type: 'text' as const, text: draftText }],
  ...(draft.attachment ? { attachment: draft.attachment } : {}),
}]
```

（具体变量名以现有代码为准。）

- [ ] **Step 3: reducer.ts 里 STREAM_END 适配（临时：仍从 streaming.currentText 取，下个 task 重写）**

当前 STREAM_END 用 `streamingRef.current` 文本生成 assistant 消息。临时改为：

```ts
case 'STREAM_END': {
  const stream = state.streamingBySession[action.sessionId]
  const text = stream?.blocks?.find((b: any) => b.type === 'text')?.text ?? ''
  const projects = state.projects.map(p => ({
    ...p,
    sessions: p.sessions.map(s =>
      s.id === action.sessionId
        ? { ...s, messages: [...s.messages, {
            id: `m${Date.now()}`, role: 'assistant' as const,
            content: [{ type: 'text' as const, text }],
          }] }
        : s
    )
  }))
  const { [action.sessionId]: _, ...rest } = state.streamingBySession
  return { ...state, projects, streamingBySession: rest }
}
```

注意：此步先让 streamingBySession 结构过渡——把现有 `{ isStreaming, currentText, thinking, tools, error }` 暂时保留，下个 task 才改为 `{ blocks, notices, error }`。**为避免类型错误，本 task 先把 streamingBySession 的类型注释里的字段保持原样，仅让 content 适配。**

> 实操提示：因为下个 task 会重写 streaming 结构，本 task 的 STREAM_END 是临时代码。重点是让 `tsc` 和现有测试通过。

- [ ] **Step 4: ChatArea.tsx 读消息 content 改为渲染 blocks 里的 text**

ChatArea 当前 `{m.content && <div>{m.content}</div>}`（content 是 string）。临时改为取 text block：

```tsx
{(() => {
  const text = m.content.filter(b => b.type === 'text').map((b:any) => b.text).join('')
  return text && <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
})()}
```

- [ ] **Step 5: 运行类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS（0 错误）

- [ ] **Step 6: 运行测试**

Run: `npm test -- --run`
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
git add src/renderer/state/reducer.ts src/renderer/components/ChatArea.tsx tests/fixtures.ts tests/reducer.test.ts
git commit -m "refactor: 适配 Message.content 为 blocks，过渡形态保持功能不变"
```

---

## Task 3: 流式 blocks 拼接 reducer（TDD）

本 task 重写 streamingBySession 为 `{ blocks, notices, error }`，实现流式拼接规约。**先写测试。**

**Files:**
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`
- Create: `tests/blocks-reducer.test.ts`

- [ ] **Step 1: 在 actions.ts 新增流式 actions 类型**

在 `src/renderer/state/actions.ts` 加（替换/新增对应 case）：

```ts
import type { ContentBlock, SystemNotice, ToolResult } from '../types'

export type Action =
  // ... 保留原有 ...
  | { type: 'STREAM_START'; sessionId: string }
  | { type: 'STREAM_DELTA'; sessionId: string; kind: 'text' | 'thinking'; delta: string }
  | { type: 'STREAM_TOOL_USE_START'; sessionId: string; block: Extract<ContentBlock, { type: 'tool_use' }> }
  | { type: 'STREAM_TOOL_RESULT'; sessionId: string; toolUseId: string; result: ToolResult }
  | { type: 'STREAM_ASSISTANT_BLOCKS'; sessionId: string; blocks: ContentBlock[]; uuid: string }
  | { type: 'STREAM_NOTICE'; sessionId: string; notice: SystemNotice }
  | { type: 'STREAM_ERROR'; sessionId: string; error: string }
  | { type: 'STREAM_ABORTED'; sessionId: string }
  | { type: 'STREAM_END'; sessionId: string; costUSD?: number; durationMs?: number; turns?: number; isError?: boolean }
```

删除旧 `STREAM_DELTA`（旧签名）/STREAM_THINKING/STREAM_TOOL_USE 的旧定义（若存在），统一为新签名。`STREAM_END` 去掉 content 字段。

- [ ] **Step 2: 写失败测试 — text delta append**

Create `tests/blocks-reducer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'
import type { AppState } from '../src/renderer/state/reducer'

function initialState(): AppState {
  return {
    projects: structuredClone(seedProjects),
    activeSessionId: 's1',
    tabsBySession: { s1: [] },
    activeTabIdBySession: { s1: null },
    theme: 'codex-light',
    draft: { text: '' },
    currentView: 'workspace',
    activeSettingsSection: 'general',
    streamingBySession: {},
    settings: {
      apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, queueMode: 'queue',
      showThinking: false, showTodo: false, autoArchive: true, archiveDays: '7', dataPath: '',
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
    claudeSessionMap: {},
    pendingDialog: null,
  }
}

describe('streaming blocks reducer', () => {
  beforeEach(() => setIdCounter(100))

  it('STREAM_DELTA text 追加到末尾 text block', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '你好' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '世界' })
    const blocks = s.streamingBySession['s1'].blocks
    expect(blocks.length).toBe(1)
    expect(blocks[0]).toEqual({ type: 'text', text: '你好世界' })
  })

  it('STREAM_DELTA thinking 与 text 分属不同 block', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'A' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'thinking', delta: 'B' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'C' })
    const blocks = s.streamingBySession['s1'].blocks
    expect(blocks.map(b => b.type)).toEqual(['text', 'thinking', 'text'])
    expect((blocks[0] as any).text).toBe('AC')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/blocks-reducer.test.ts`
Expected: FAIL（STREAM_DELTA 新签名未实现 / streamingBySession 无 blocks 字段）

- [ ] **Step 4: store.tsx 加 pendingDialog 初始值 + streaming 类型改 blocks**

`src/renderer/state/store.tsx` 初始 state 加 `pendingDialog: null`；`streamingBySession` 初始仍 `{}`。

reducer.ts 顶部 `streamingBySession` 类型定义改为：

```ts
streamingBySession: Record<string, {
  blocks: ContentBlock[]
  notices: SystemNotice[]
  error?: string
}>
```

AppState interface 加 `pendingDialog: { reqId: string; dialogKind: string; payload: any; toolUseId?: string } | null`。

- [ ] **Step 5: 实现 STREAM_START / STREAM_DELTA**

reducer.ts:

```ts
case 'STREAM_START': {
  return {
    ...state,
    streamingBySession: {
      ...state.streamingBySession,
      [action.sessionId]: { blocks: [], notices: [] },
    },
  }
}
case 'STREAM_DELTA': {
  const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
  const blocks = [...prev.blocks]
  const last = blocks[blocks.length - 1]
  const blockType = action.kind === 'text' ? 'text' : 'thinking'
  if (last && last.type === blockType) {
    blocks[blocks.length - 1] = { ...last, text: (last as any).text + action.delta }
  } else {
    blocks.push({ type: blockType, text: action.delta } as ContentBlock)
  }
  return {
    ...state,
    streamingBySession: {
      ...state.streamingBySession,
      [action.sessionId]: { ...prev, blocks },
    },
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/blocks-reducer.test.ts`
Expected: PASS（2 个）

- [ ] **Step 7: 写失败测试 — tool_use 生命周期**

追加到 `tests/blocks-reducer.test.ts`：

```ts
describe('tool_use 生命周期', () => {
  beforeEach(() => setIdCounter(100))

  it('START 创建 running block；RESULT 回填 result 并置 completed', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, {
      type: 'STREAM_TOOL_USE_START', sessionId: 's1',
      block: { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.txt' }, status: 'running' },
    })
    let blocks = s.streamingBySession['s1'].blocks
    expect(blocks[0]).toMatchObject({ type: 'tool_use', id: 'tu1', status: 'running' })

    s = reducer(s, {
      type: 'STREAM_TOOL_RESULT', sessionId: 's1', toolUseId: 'tu1',
      result: { content: '文件内容', isError: false },
    })
    blocks = s.streamingBySession['s1'].blocks
    expect((blocks[0] as any).status).toBe('completed')
    expect((blocks[0] as any).result).toEqual({ content: '文件内容', isError: false })
  })

  it('RESULT isError=true 置 error', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, {
      type: 'STREAM_TOOL_USE_START', sessionId: 's1',
      block: { type: 'tool_use', id: 'tu1', name: 'Bash', input: {}, status: 'running' },
    })
    s = reducer(s, {
      type: 'STREAM_TOOL_RESULT', sessionId: 's1', toolUseId: 'tu1',
      result: { content: '命令失败', isError: true },
    })
    expect((s.streamingBySession['s1'].blocks[0] as any).status).toBe('error')
  })
})
```

- [ ] **Step 8: 运行确认失败**

Run: `npx vitest run tests/blocks-reducer.test.ts`
Expected: FAIL（STREAM_TOOL_USE_START / STREAM_TOOL_RESULT 未实现）

- [ ] **Step 9: 实现 STREAM_TOOL_USE_START / STREAM_TOOL_RESULT**

reducer.ts:

```ts
case 'STREAM_TOOL_USE_START': {
  const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
  return {
    ...state,
    streamingBySession: {
      ...state.streamingBySession,
      [action.sessionId]: { ...prev, blocks: [...prev.blocks, action.block] },
    },
  }
}
case 'STREAM_TOOL_RESULT': {
  const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
  const blocks = prev.blocks.map(b =>
    b.type === 'tool_use' && b.id === action.toolUseId
      ? { ...b, result: action.result, status: action.result.isError ? 'error' as const : 'completed' as const }
      : b
  )
  return {
    ...state,
    streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, blocks } },
  }
}
```

- [ ] **Step 10: 运行确认通过**

Run: `npx vitest run tests/blocks-reducer.test.ts`
Expected: PASS（全部）

- [ ] **Step 11: 写并实现 STREAM_NOTICE / STREAM_ERROR / STREAM_ASSISTANT_BLOCKS / STREAM_END / STREAM_ABORTED**

先写测试（追加到 blocks-reducer.test.ts）：

```ts
describe('notice / error / end', () => {
  beforeEach(() => setIdCounter(100))

  it('STREAM_NOTICE 累积到 notices', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_NOTICE', sessionId: 's1', notice: { id: 'n1', kind: 'status', text: '运行中', level: 'info' } })
    expect(s.streamingBySession['s1'].notices.length).toBe(1)
  })

  it('STREAM_ERROR 只标记不结束流', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_ERROR', sessionId: 's1', error: 'boom' })
    expect(s.streamingBySession['s1'].error).toBe('boom')
    expect(s.streamingBySession['s1']).toBeDefined() // 流仍在
  })

  it('STREAM_END 固化成 assistant 消息（含 blocks/notices/cost）并清理 streaming', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: '回复' })
    s = reducer(s, { type: 'STREAM_NOTICE', sessionId: 's1', notice: { id: 'n1', kind: 'status', text: 'ok', level: 'info' } })
    s = reducer(s, { type: 'STREAM_END', sessionId: 's1', costUSD: 0.01, durationMs: 500 })
    expect(s.streamingBySession['s1']).toBeUndefined()
    const sess = s.projects.flatMap(p => p.sessions).find(x => x.id === 's1')!
    const last = sess.messages[sess.messages.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toEqual([{ type: 'text', text: '回复' }])
    expect(last.notices?.length).toBe(1)
    expect(last.costUSD).toBe(0.01)
  })

  it('STREAM_ASSISTANT_BLOCKS 按 uuid 去重', () => {
    let s = initialState()
    s = reducer(s, { type: 'STREAM_START', sessionId: 's1' })
    s = reducer(s, { type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1', blocks: [{ type: 'text', text: 'A' }] })
    s = reducer(s, { type: 'STREAM_ASSISTANT_BLOCKS', sessionId: 's1', uuid: 'u1', blocks: [{ type: 'text', text: 'A2' }] })
    // 同 uuid 不重复追加
    expect(s.streamingBySession['s1'].blocks.length).toBe(1)
  })
})
```

实现：

```ts
case 'STREAM_NOTICE': {
  const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
  return {
    ...state,
    streamingBySession: {
      ...state.streamingBySession,
      [action.sessionId]: { ...prev, notices: [...prev.notices, action.notice] },
    },
  }
}
case 'STREAM_ERROR': {
  const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
  return {
    ...state,
    streamingBySession: { ...state.streamingBySession, [action.sessionId]: { ...prev, error: action.error } },
  }
}
case 'STREAM_ASSISTANT_BLOCKS': {
  const prev = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
  const seen = (prev as any)._seenUuids as string[] | undefined
  if (seen?.includes(action.uuid)) {
    return state // 同 uuid 已校正过，跳过
  }
  // 合并：已存在的 tool_use 按 id 合并 input，其余追加
  const merged = [...prev.blocks]
  for (const nb of action.blocks) {
    if (nb.type === 'tool_use') {
      const idx = merged.findIndex(b => b.type === 'tool_use' && b.id === nb.id)
      if (idx >= 0) merged[idx] = { ...merged[idx], ...nb } as ContentBlock
      else merged.push(nb)
    } else {
      merged.push(nb)
    }
  }
  return {
    ...state,
    streamingBySession: {
      ...state.streamingBySession,
      [action.sessionId]: { ...prev, blocks: merged, _seenUuids: [...(seen || []), action.uuid] } as any,
    },
  }
}
case 'STREAM_END': {
  const stream = state.streamingBySession[action.sessionId] || { blocks: [], notices: [] }
  const assistantMsg = {
    id: `m${Date.now()}`,
    role: 'assistant' as const,
    content: stream.blocks.length ? stream.blocks : [{ type: 'text' as const, text: '' }],
    ...(stream.notices.length ? { notices: stream.notices } : {}),
    ...(action.costUSD != null ? { costUSD: action.costUSD } : {}),
    ...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
    ...(action.turns != null ? { turns: action.turns } : {}),
    ...(action.isError ? { isError: true } : {}),
  }
  const projects = state.projects.map(p => ({
    ...p,
    sessions: p.sessions.map(s => s.id === action.sessionId ? { ...s, messages: [...s.messages, assistantMsg] } : s),
  }))
  const { [action.sessionId]: _, ...rest } = state.streamingBySession
  return { ...state, projects, streamingBySession: rest }
}
case 'STREAM_ABORTED': {
  const { [action.sessionId]: _, ...rest } = state.streamingBySession
  return { ...state, streamingBySession: rest }
}
```

> 注：`_seenUuids` 用 `as any` 临时挂在 streaming 对象上做去重，避免侵入类型；如需干净可在 streaming 类型里加可选字段。

- [ ] **Step 12: 运行全部测试 + 类型检查**

Run: `npm test -- --run && npx tsc --noEmit -p tsconfig.json`
Expected: 全部 PASS / 0 错误

- [ ] **Step 13: Commit**

```bash
git add src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/state/store.tsx tests/blocks-reducer.test.ts tests/reducer.test.ts tests/fixtures.ts
git commit -m "feat(reducer): 流式 blocks 拼接（text/thinking/tool_use/notice/end）+ 待 dialog 状态"
```

---

## Task 4: 主进程归一化纯函数（TDD）

**Files:**
- Create: `src/main/claude-normalize.ts`
- Create: `tests/claude-normalize.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/claude-normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeBetaBlocks, extractToolResults, mkNotice } from '../src/main/claude-normalize'

describe('normalizeBetaBlocks', () => {
  it('把 BetaMessage content blocks 映射为 ContentBlock[]', () => {
    const input = [
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a' } },
    ]
    const out = normalizeBetaBlocks(input as any)
    expect(out[0]).toEqual({ type: 'text', text: 'hello' })
    expect(out[1]).toEqual({ type: 'thinking', text: 'hmm' })
    expect(out[2]).toMatchObject({ type: 'tool_use', id: 'tu1', name: 'Read', status: 'running' })
  })
})

describe('extractToolResults', () => {
  it('从 user message content 提取 tool_result', () => {
    const input = [
      { type: 'tool_result', tool_use_id: 'tu1', content: '内容', is_error: false },
      { type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: '块内容' }], is_error: true },
    ]
    const out = extractToolResults(input as any)
    expect(out).toEqual([
      { toolUseId: 'tu1', content: '内容', isError: false },
      { toolUseId: 'tu2', content: '块内容', isError: true },
    ])
  })
})

describe('mkNotice', () => {
  it('构造带 id 的 notice', () => {
    const n = mkNotice('status', '运行中', 'info')
    expect(n.kind).toBe('status')
    expect(n.text).toBe('运行中')
    expect(n.level).toBe('info')
    expect(typeof n.id).toBe('string')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/claude-normalize.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 claude-normalize.ts**

Create `src/main/claude-normalize.ts`:

```ts
// 主进程：把 SDK message 的结构拍平为渲染端用的 ContentBlock / SystemNotice。

export interface NormToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: any
  status: 'running' | 'completed' | 'error'
  result?: { content: string; isError: boolean }
}
export interface NormBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image'
  [k: string]: any
}
export interface SystemNotice {
  id: string
  kind: string
  text: string
  level: 'info' | 'warn' | 'error'
}

let _id = 0
function nextId(prefix: string): string {
  _id += 1
  return `${prefix}${_id}`
}

export function mkNotice(kind: SystemNotice['kind'], text: string, level: SystemNotice['level']): SystemNotice {
  return { id: nextId('n'), kind, text, level }
}

// BetaMessage.content → ContentBlock[]（tool_use 默认 running，结果由 tool_result 回填）
export function normalizeBetaBlocks(content: any[]): NormBlock[] {
  if (!Array.isArray(content)) return []
  return content.map((b: any): NormBlock => {
    switch (b.type) {
      case 'text': return { type: 'text', text: b.text ?? '' }
      case 'thinking': return { type: 'thinking', text: b.thinking ?? '' }
      case 'tool_use': return { type: 'tool_use', id: b.id, name: b.name, input: b.input, status: 'running' as const }
      case 'image': return { type: 'image', source: b.source?.data ?? '' }
      default: return { type: 'text', text: JSON.stringify(b) }
    }
  })
}

// user message.content（含 tool_result）→ 提取可读结果
export function extractToolResults(content: any[]): { toolUseId: string; content: string; isError: boolean }[] {
  if (!Array.isArray(content)) return []
  return content
    .filter((b: any) => b.type === 'tool_result')
    .map((b: any) => {
      let text = ''
      if (typeof b.content === 'string') text = b.content
      else if (Array.isArray(b.content)) text = b.content.map((c: any) => c?.text ?? '').join('')
      else text = JSON.stringify(b.content ?? '')
      return { toolUseId: b.tool_use_id, content: text, isError: !!b.is_error }
    })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/claude-normalize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/claude-normalize.ts tests/claude-normalize.test.ts
git commit -m "feat(main): SDK message 归一化纯函数（blocks/tool_results/notice）"
```

---

## Task 5: 主进程 ClaudeService 归一化 switch + preload 通道

**Files:**
- Modify: `src/main/claude-service.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: preload 替换为新通道**

`src/preload/index.ts` 的 `claude` 命名空间替换为：

```ts
claude: {
  send: (opts: any) => ipcRenderer.invoke('claude:send', opts),
  stop: () => ipcRenderer.invoke('claude:stop'),
  onSystem: (cb: (data: any) => void) => { ipcRenderer.on('claude:system', (_, data) => cb(data)) },
  onDelta: (cb: (data: { kind: 'text' | 'thinking'; delta: string }) => void) => { ipcRenderer.on('claude:delta', (_, data) => cb(data)) },
  onBlocks: (cb: (data: any) => void) => { ipcRenderer.on('claude:blocks', (_, data) => cb(data)) },
  onNotice: (cb: (data: any) => void) => { ipcRenderer.on('claude:notice', (_, data) => cb(data)) },
  onResult: (cb: (data: any) => void) => { ipcRenderer.on('claude:result', (_, data) => cb(data)) },
  onError: (cb: (data: { error: string }) => void) => { ipcRenderer.on('claude:error', (_, data) => cb(data)) },
  onAborted: (cb: () => void) => { ipcRenderer.on('claude:aborted', () => cb()) },
  onDialogRequest: (cb: (data: any) => void) => { ipcRenderer.on('claude:dialog-request', (_, data) => cb(data)) },
  dialogResponse: (payload: { reqId: string; result: any }) => ipcRenderer.invoke('claude:dialog-response', payload),
  removeAllListeners: () => {
    ['claude:system', 'claude:delta', 'claude:blocks', 'claude:notice', 'claude:result', 'claude:error', 'claude:aborted', 'claude:dialog-request']
      .forEach(ch => ipcRenderer.removeAllListeners(ch))
  },
},
```

- [ ] **Step 2: 重写 claude-service.ts 的 for-await 为归一化 switch**

`src/main/claude-service.ts` 顶部加 import：

```ts
import { normalizeBetaBlocks, extractToolResults, mkNotice } from './claude-normalize'
```

替换 `for await (const message of stream) { ... }` 整段为：

```ts
for await (const message of stream) {
  console.log('[cc-stream] [4] message', message.type, (message as any).subtype ?? '')
  switch (message.type) {
    case 'system': {
      const sys = message as any
      if (sys.subtype === 'init') {
        webContents.send('claude:system', { sessionId: sys.session_id, model: sys.model, tools: sys.tools })
      } else if (sys.subtype === 'status') {
        webContents.send('claude:notice', mkNotice('status', `状态：${sys.status}`, 'info'))
      } else if (sys.subtype === 'permission_denied') {
        webContents.send('claude:notice', mkNotice('permission_denied', `权限拒绝：${sys.tool_name}`, 'warn'))
      } else if (sys.subtype && String(sys.subtype).startsWith('compact')) {
        webContents.send('claude:notice', mkNotice('compact', `压缩：${sys.subtype}`, 'info'))
      } else {
        webContents.send('claude:notice', mkNotice('info', `system.${sys.subtype}`, 'info'))
      }
      break
    }
    case 'stream_event': {
      const evt = (message as any).event
      if (evt?.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta') webContents.send('claude:delta', { kind: 'text', delta: evt.delta.text })
        else if (evt.delta?.type === 'thinking_delta') webContents.send('claude:delta', { kind: 'thinking', delta: evt.delta.thinking })
      } else if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        const tb = evt.content_block
        webContents.send('claude:blocks', { op: 'tool_use_start', block: { type: 'tool_use', id: tb.id, name: tb.name, input: tb.input, status: 'running' } })
      }
      break
    }
    case 'assistant': {
      const blocks = normalizeBetaBlocks((message as any).message?.content || [])
      webContents.send('claude:blocks', { op: 'assistant_blocks', blocks, uuid: (message as any).uuid })
      break
    }
    case 'user': {
      const results = extractToolResults((message as any).message?.content || [])
      for (const r of results) {
        webContents.send('claude:blocks', { op: 'tool_result', toolUseId: r.toolUseId, result: { content: r.content, isError: r.isError } })
      }
      break
    }
    case 'result': {
      const r = message as any
      webContents.send('claude:result', {
        sessionId: r.session_id, subtype: r.subtype, isError: !!r.is_error,
        costUSD: r.total_cost_usd, durationMs: r.duration_ms, turns: r.num_turns,
      })
      if (r.is_error) webContents.send('claude:notice', mkNotice('error', `任务出错（${r.subtype}）`, 'error'))
      break
    }
    case 'api_retry':
      webContents.send('claude:notice', mkNotice('api_retry', 'API 重试中', 'warn')); break
    case 'auth_status':
      webContents.send('claude:notice', mkNotice('auth', `认证：${(message as any).is_authenticated ? '已认证' : '未认证'}`, 'info')); break
    case 'task_started':
    case 'task_updated':
    case 'task_progress':
    case 'task_notification':
      webContents.send('claude:notice', mkNotice('task', `任务事件：${message.type}`, 'info')); break
    case 'keep_alive':
    case 'worker_shutting_down':
    case 'commands_changed':
      console.log('[cc-stream] protocol event ignored', message.type); break
    default:
      webContents.send('claude:notice', mkNotice('info', `未分类事件：${message.type}`, 'info'))
  }
}
```

保留外层 try/catch/finally（catch 里发 aborted/error，finally 清 abortController）。删除旧的 `[cc-stream] [2/3]/[5]/[6]` 日志，仅保留 `[4]`。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 4: 运行全部测试**

Run: `npm test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/claude-service.ts src/preload/index.ts
git commit -m "feat(main): 归一化全部 SDK message type 为 5 种 IPC 载荷"
```

---

## Task 6: 渲染端接入新通道（ChatArea 监听）

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx`

- [ ] **Step 1: 把 ChatArea 的 on* 监听改为新通道**

ChatArea 的 IPC effect（注册监听那段）替换为：

```ts
api.onSystem((data) => {
  if (data?.sessionId) {
    dispatch({ type: 'SET_CLAUDE_SESSION_ID', localSessionId: activeSessionIdRef.current, claudeSessionId: data.sessionId })
  }
})
api.onDelta(({ kind, delta }) => {
  dispatch({ type: 'STREAM_DELTA', sessionId: activeSessionIdRef.current, kind, delta })
})
api.onBlocks((data) => {
  const sid = activeSessionIdRef.current
  if (data.op === 'tool_use_start') dispatch({ type: 'STREAM_TOOL_USE_START', sessionId: sid, block: data.block })
  else if (data.op === 'tool_result') dispatch({ type: 'STREAM_TOOL_RESULT', sessionId: sid, toolUseId: data.toolUseId, result: data.result })
  else if (data.op === 'assistant_blocks') dispatch({ type: 'STREAM_ASSISTANT_BLOCKS', sessionId: sid, blocks: data.blocks, uuid: data.uuid })
})
api.onNotice((notice) => {
  dispatch({ type: 'STREAM_NOTICE', sessionId: activeSessionIdRef.current, notice })
})
api.onResult((data) => {
  dispatch({
    type: 'STREAM_END', sessionId: activeSessionIdRef.current,
    costUSD: data.costUSD, durationMs: data.durationMs, turns: data.turns, isError: data.isError,
  })
  // 任务完成通知（保留原逻辑）
  const s = settingsRef.current
  if (s.taskNotify && 'Notification' in window) {
    const n = new Notification(t('chat.taskDone'), { body: t('chat.taskDoneBody'), silent: !s.notifySound })
    n.onclick = () => window.focus()
  }
})
api.onError(({ error }) => dispatch({ type: 'STREAM_ERROR', sessionId: activeSessionIdRef.current, error }))
api.onAborted(() => dispatch({ type: 'STREAM_ABORTED', sessionId: activeSessionIdRef.current }))
```

> 注意：`STREAM_END` 不再依赖 streamingRef（blocks 已在 reducer 实时拼好）。删除 streamingRef 相关代码（streamingRef/useEffect）。

- [ ] **Step 2: 类型检查 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- --run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ChatArea.tsx
git commit -m "feat(chat): ChatArea 监听归一化后的新 IPC 通道"
```

---

## Task 7: block 渲染组件

**Files:**
- Create: `src/renderer/components/blocks/TextBlock.tsx`
- Create: `src/renderer/components/blocks/ThinkingBlock.tsx`
- Create: `src/renderer/components/blocks/ToolUseCard.tsx`
- Create: `src/renderer/components/blocks/ImageBlock.tsx`
- Create: `src/renderer/components/blocks/BlockRenderer.tsx`

- [ ] **Step 1: TextBlock.tsx**

```tsx
export function TextBlock({ text }: { text: string }) {
  if (!text) return null
  return <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
}
```

- [ ] **Step 2: ThinkingBlock.tsx（默认折叠）**

```tsx
import { useState } from 'react'

export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ color: 'var(--text-muted)', fontSize: 12, borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
      <summary style={{ cursor: 'pointer' }}>思考过程</summary>
      <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{text}</div>
    </details>
  )
}
```

- [ ] **Step 3: ToolUseCard.tsx（默认折叠 + 结果超长截断）**

```tsx
import { useState } from 'react'

const TRUNC_LINES = 30
const TRUNC_CHARS = 2000

export function ToolUseCard({ block }: {
  block: { type: 'tool_use'; id: string; name: string; input: any; status: string; result?: { content: string; isError: boolean } }
}) {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const resultText = block.result?.content ?? ''
  const overLong = resultText.length > TRUNC_CHARS || resultText.split('\n').length > TRUNC_LINES
  const shown = !full && overLong ? resultText.split('\n').slice(0, TRUNC_LINES).join('\n') + '\n…' : resultText
  const summary = `${block.name} ${typeof block.input === 'object' ? JSON.stringify(block.input).slice(0, 60) : ''}`
  const dot = block.status === 'running' ? '🟡' : block.status === 'error' ? '🔴' : '🟢'
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
      <summary style={{ cursor: 'pointer' }}>{dot} {summary}</summary>
      <div style={{ marginTop: 6 }}>
        <div style={{ color: 'var(--text-muted)' }}>输入：{JSON.stringify(block.input, null, 2)}</div>
        {block.result && (
          <pre style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: block.result.isError ? '#ef4444' : 'var(--text)' }}>{shown}</pre>
        )}
        {overLong && !full && (
          <button onClick={() => setFull(true)} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>展开查看全部</button>
        )}
      </div>
    </details>
  )
}
```

- [ ] **Step 4: ImageBlock.tsx**

```tsx
export function ImageBlock({ source }: { source: string }) {
  if (!source) return null
  const src = source.startsWith('data:') || source.startsWith('http') ? source : `data:image/png;base64,${source}`
  return <img src={src} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} />
}
```

- [ ] **Step 5: BlockRenderer.tsx（按 type 分发）**

```tsx
import type { ContentBlock } from '../../types'
import { TextBlock } from './TextBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseCard } from './ToolUseCard'
import { ImageBlock } from './ImageBlock'

export function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text': return <TextBlock text={block.text} />
    case 'thinking': return <ThinkingBlock text={block.text} />
    case 'tool_use': return <ToolUseCard block={block} />
    case 'tool_result': return null  // tool_result 已并入 tool_use 卡片，不单独渲染
    case 'image': return <ImageBlock source={block.source} />
    default: return null
  }
}
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/blocks/
git commit -m "feat(chat): content block 渲染组件（文本/思考/工具卡片/图片）"
```

---

## Task 8: ChatArea 用 BlockRenderer + notice 行 + 元数据

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx`
- Create: `src/renderer/components/Notices.tsx`

- [ ] **Step 1: Notices.tsx**

```tsx
import type { SystemNotice } from '../types'

const LEVEL_COLOR: Record<string, string> = {
  info: 'var(--text-muted)', warn: '#d97706', error: '#ef4444',
}

export function Notices({ notices }: { notices: SystemNotice[] }) {
  if (!notices?.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
      {notices.map(n => (
        <div key={n.id} style={{ fontSize: 11, color: LEVEL_COLOR[n.level] ?? 'var(--text-muted)' }}>{n.text}</div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: ChatArea 消息渲染改用 BlockRenderer + Notices + 元数据**

消息 map 部分（assistant 与 user 两分支）改为：先渲染 `<Notices notices={m.notices} />`，再遍历 `m.content` 用 `<BlockRenderer block={...} />`。assistant 末尾加元数据行。例：

```tsx
m.role === 'assistant' ? (
  <div key={m.id} style={{ maxWidth: '80%', alignSelf: 'flex-start', color: 'var(--text)',
    display: 'flex', flexDirection: 'column', gap: 6, userSelect: 'text', cursor: 'text' }}>
    {m.attachment && <AttachmentChip attachment={m.attachment} />}
    <Notices notices={m.notices ?? []} />
    {m.content.map((b, i) => <BlockRenderer key={i} block={b} />)}
    {(m.costUSD != null || m.durationMs != null) && (
      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        {m.costUSD != null && `$${m.costUSD.toFixed(4)} `}
        {m.durationMs != null && `${(m.durationMs / 1000).toFixed(1)}s`}
        {m.turns != null && ` · ${m.turns} 轮`}
      </div>
    )}
  </div>
) : (
  <div key={m.id} style={{ maxWidth: '80%', alignSelf: 'flex-end', background: 'var(--bg-hover)',
    borderRadius: 10, padding: '9px 13px', color: 'var(--text)',
    display: 'flex', flexDirection: 'column', gap: 6, userSelect: 'text', cursor: 'text' }}>
    {m.attachment && <AttachmentChip attachment={m.attachment} />}
    {m.content.map((b, i) => <BlockRenderer key={i} block={b} />)}
  </div>
)
```

顶部加 import：`import { BlockRenderer } from './blocks/BlockRenderer'` 与 `import { Notices } from './Notices'`。

- [ ] **Step 3: 流式区也用 BlockRenderer**

流式区（`streaming?.isStreaming` 那段）替换为：渲染 `stream.notices`（Notices）+ `stream.blocks`（BlockRenderer）+ error 条 + 闪烁光标。注意 `streaming` 现在结构是 `{ blocks, notices, error }`，无 `isStreaming` 字段——用 `const stream = state.streamingBySession[state.activeSessionId]` 是否存在判断。

```tsx
{stream && (
  <div style={{ color: 'var(--text)', fontSize: 14, lineHeight: 1.6, padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'text' }}>
    <Notices notices={stream.notices} />
    {stream.blocks.map((b, i) => <BlockRenderer key={i} block={b} />)}
    {stream.error && <div style={{ color: '#ef4444', fontSize: 13 }}>❌ {stream.error}</div>}
    <span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>
  </div>
)}
```

更新文件顶部 `const streaming = state.streamingBySession[state.activeSessionId]` 的引用（用 `stream` 别名或保留 streaming 名字但改用 `.blocks`）。

- [ ] **Step 4: 类型检查 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ChatArea.tsx src/renderer/components/Notices.tsx
git commit -m "feat(chat): 按 block 渲染消息 + notice 状态行 + cost/时长元数据"
```

---

## Task 9: AskUserQuestion — 主进程 onUserDialog 桥接 + dialog IPC

**Files:**
- Modify: `src/main/claude-service.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: ClaudeService 加 dialog 桥接器 + onUserDialog/supportedDialogKinds**

`src/main/claude-service.ts`：

类内加字段与方法：

```ts
private dialogResolvers = new Map<string, (r: { behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }) => void>()

async askUserDialog(webContents: WebContents, request: { dialogKind: string; payload: any; toolUseID?: string }, signal: AbortSignal) {
  const reqId = `dlg${Date.now()}_${Math.floor(performance.now())}`
  console.log('[cc-stream] onUserDialog', request.dialogKind, JSON.stringify(request.payload)?.slice(0, 200))
  webContents.send('claude:dialog-request', { reqId, dialogKind: request.dialogKind, payload: request.payload, toolUseId: request.toolUseID })
  return new Promise<{ behavior: 'completed'; result: unknown } | { behavior: 'cancelled' }>((resolve) => {
    this.dialogResolvers.set(reqId, resolve)
    signal.addEventListener('abort', () => {
      if (this.dialogResolvers.has(reqId)) {
        this.dialogResolvers.delete(reqId)
        resolve({ behavior: 'cancelled' })
      }
    })
  })
}

resolveDialog(reqId: string, result: any) {
  const fn = this.dialogResolvers.get(reqId)
  if (fn) { this.dialogResolvers.delete(reqId); fn(result) }
}
```

`query()` options 内加（紧跟现有 options 字段）：

```ts
supportedDialogKinds: ['refusal_fallback_prompt'],
onUserDialog: async (request: any, { signal }: { signal: AbortSignal }) => {
  return this.askUserDialog(webContents, { dialogKind: request.dialogKind, payload: request.payload, toolUseID: request.toolUseID }, signal)
},
```

> 实现期观察：第一次 AskUserQuestion 触发时，`[cc-stream] onUserDialog` 日志会打印真实 dialogKind/payload。若 kind 不在 supportedDialogKinds 里，SDK 不会下发——届时据日志把真实 kind 加入数组。

- [ ] **Step 2: index.ts 加 dialog-response handler**

`src/main/index.ts` 在 claude:stop 之后加：

```ts
ipcMain.handle('claude:dialog-response', (_e, { reqId, result }) => {
  claude.resolveDialog(reqId, result)
})
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/claude-service.ts src/main/index.ts
git commit -m "feat(main): onUserDialog 桥接 + claude:dialog-request/response IPC"
```

---

## Task 10: AskUserQuestion — 渲染端 reducer + InputDock + AnswerPanel

**Files:**
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/components/ChatArea.tsx`
- Create: `src/renderer/components/AnswerPanel.tsx`
- Create: `src/renderer/components/InputDock.tsx`

- [ ] **Step 1: actions 加 SHOW_DIALOG / ANSWER_DIALOG**

actions.ts 加：

```ts
| { type: 'SHOW_DIALOG'; reqId: string; dialogKind: string; payload: any; toolUseId?: string }
| { type: 'ANSWER_DIALOG' }
```

- [ ] **Step 2: reducer 加 dialog 处理**

reducer.ts：

```ts
case 'SHOW_DIALOG':
  return { ...state, pendingDialog: { reqId: action.reqId, dialogKind: action.dialogKind, payload: action.payload, toolUseId: action.toolUseId } }
case 'ANSWER_DIALOG':
  return { ...state, pendingDialog: null }
```

- [ ] **Step 3: ChatArea 监听 dialog-request**

ChatArea 的 IPC effect 加：

```ts
api.onDialogRequest((data) => {
  dispatch({ type: 'SHOW_DIALOG', reqId: data.reqId, dialogKind: data.dialogKind, payload: data.payload, toolUseId: data.toolUseId })
})
```

并把底部 `<InputBar />` 替换为 `<InputDock />`。

- [ ] **Step 4: AnswerPanel.tsx**

```tsx
import { useState } from 'react'
import { useStore } from '../state/store'

// AskUserQuestion 形态：payload.questions = [{ question, header, options:[{label,description,preview?}], multiSelect? }]
export function AnswerPanel() {
  const { state, dispatch } = useStore()
  const dialog = state.pendingDialog
  const questions: any[] = dialog?.payload?.questions ?? []
  const [answers, setAnswers] = useState<Record<number, any>>({})
  if (!dialog) return null

  const submit = (results: Record<number, any>) => {
    const userAnswers = Object.entries(results).map(([qi, v]) => ({ questionIndex: Number(qi), ...(typeof v === 'string' ? { other: v } : { selected: v }) }))
    window.api?.claude?.dialogResponse({ reqId: dialog.reqId, result: { behavior: 'completed', result: { answers: userAnswers } } })
    dispatch({ type: 'ANSWER_DIALOG' })
  }
  const cancel = () => {
    window.api?.claude?.dialogResponse({ reqId: dialog.reqId, result: { behavior: 'cancelled' } })
    dispatch({ type: 'ANSWER_DIALOG' })
  }

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-float)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {questions.map((q, qi) => (
        <div key={qi}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>{q.header}</span>
            <span style={{ fontSize: 13 }}>{q.question}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(q.options ?? []).map((opt: any, oi: number) => (
              <label key={oi} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: answers[qi]?.index === oi ? 'var(--bg-hover)' : 'transparent' }}>
                <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`q${qi}`} onChange={() => setAnswers(a => ({ ...a, [qi]: { index: oi, label: opt.label } }))} />
                <span>
                  <div>{opt.label}</div>
                  {opt.description && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{opt.description}</div>}
                </span>
              </label>
            ))}
            {/* Other 自定义 */}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer', padding: '4px 6px' }}>
              <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`q${qi}`} onChange={() => setAnswers(a => ({ ...a, [qi]: { other: true } }))} />
              <span>Other…</span>
            </label>
            {answers[qi]?.other && (
              <input type="text" placeholder="自定义回答" onChange={e => setAnswers(a => ({ ...a, [qi]: { other: true, text: e.target.value } }))}
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
            )}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={cancel} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>取消</button>
        <button onClick={() => submit(answers)} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer' }}>提交</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: InputDock.tsx（双态切换）**

```tsx
import { useStore } from '../state/store'
import { InputBar } from './InputBar'
import { AnswerPanel } from './AnswerPanel'

export function InputDock() {
  const { state } = useStore()
  return state.pendingDialog ? <AnswerPanel /> : <InputBar />
}
```

- [ ] **Step 6: 类型检查 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- --run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/components/ChatArea.tsx src/renderer/components/AnswerPanel.tsx src/renderer/components/InputDock.tsx
git commit -m "feat(chat): AskUserQuestion 底部答题面板（InputDock 双态 + AnswerPanel）"
```

---

## Task 11: 旧数据清理 + 端到端验证 + 日志清理

**Files:**
- Modify: `src/main/projects-store.ts`
- Modify: `src/renderer/components/InputBar.tsx`（清理调试日志）

- [ ] **Step 1: projects-store 加载时清掉旧 string-content 消息**

读 `src/main/projects-store.ts` 的加载函数（`getProjectsSnapshot` 或类似）。在返回前过滤/重置：若任何 message.content 不是数组，清空该 session 的 messages（旧数据不兼容，用户已确认）。

```ts
// 在 getProjectsSnapshot 返回 snap 之前
for (const p of snap.projects) {
  for (const s of p.sessions) {
    if (s.messages.some((m: any) => typeof m.content === 'string')) {
      s.messages = []  // 旧格式 content，清空
    }
  }
}
```

- [ ] **Step 2: 清理 InputBar.tsx 残留调试日志**

删除 InputBar.tsx 里 `doSend` 中的 `[cc-stream] [1]` 日志行（console.log 与 .then/.catch 的日志）。保留功能。

- [ ] **Step 3: 全量类型检查 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json && npm test -- --run`
Expected: PASS / 全部测试通过

- [ ] **Step 4: 端到端手动验证（npm run dev）**

逐项确认：
1. 文本对话：发送消息，AI 回复正常显示为文本 block，末尾有 cost/时长。
2. 工具调用：让 AI 读文件/跑命令，看到 tool_use 卡片（默认折叠），展开看 input + result；长输出截断有"展开查看全部"。
3. AskUserQuestion：触发后底部弹出答题面板（先看 `[cc-stream] onUserDialog` 日志确认 dialogKind；若 kind 未在 supportedDialogKinds，据日志加入 claude-service.ts 的数组重启）。提交后面板收起、AI 继续。
4. notice：权限拒绝/api_retry 等以状态行显示。
5. 回归：流式期间切设置不卡死；连续发多条消息正常。

- [ ] **Step 5: Commit**

```bash
git add src/main/projects-store.ts src/renderer/components/InputBar.tsx
git commit -m "chore: 清理旧 string-content 数据 + 移除调试日志"
```

---

## Self-Review 结论

**Spec 覆盖**：① 数据模型→Task1 ② reducer 流式→Task3 ③ 主进程归一化→Task4/5 ④ preload→Task5 ⑤ ChatArea 渲染→Task6/7/8 ⑥ AskUserQuestion→Task9/10 ⑦ 旧数据→Task11。全部映射。
**Placeholder**：无 TODO/TBD；dialogKind 的实现期观察已给出明确日志与修改点，非占位。
**类型一致**：ContentBlock / SystemNotice / ToolResult 全程同名；actions 名（STREAM_DELTA/STREAM_TOOL_USE_START/STREAM_TOOL_RESULT/STREAM_ASSISTANT_BLOCKS/STREAM_NOTICE/STREAM_END/SHOW_DIALOG/ANSWER_DIALOG）在 actions/reducer/ChatArea 一致。
