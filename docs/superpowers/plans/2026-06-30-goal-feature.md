# /goal 能力实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Claude Code 官方 `/goal` 命令——设置完成条件，Claude 跨轮持续工作直到条件满足（Haiku 评估），完整对齐官方行为。

**Architecture:** 会话级 prompt-based Stop hook。命令层（内置命令三态）→ 核心层（SDK Stop hook + Haiku 评估器 + additionalContext 续轮）→ 状态层（goalBySession 分片）。Stop hook 用 SDK 提供的 `last_assistant_message` 评估（不读 transcript），评估复用现有 `runSideQuery`(Haiku)。

**Tech Stack:** Electron + React 18 + TypeScript, @anthropic-ai/claude-agent-sdk 0.3.178（Stop hook）, vitest。

**对应设计文档:** `docs/superpowers/specs/2026-06-30-goal-feature-design.md`

## Global Constraints

- **不动现有流式/权限/compact 逻辑**：Stop hook 在 buildQuery 的 hooks 上**追加**（不替换现有 PreToolUse）；reducer 现有 action 语义不变，只新增 goal 相关 + CLEAR_SESSION_MESSAGES 顺带清 goal。
- **评估失败策略（A3）**：Haiku 调用失败/JSON 解析失败 → 默认 `met=false`（继续轮），不强制停 goal。
- **续轮上限（B2）**：不加硬上限，纯靠条件里的 turn 子句；UI 层做软阈值兜底（>30 轮温和提示，不干预逻辑）。
- **TDD 约定**：reducer 测试用 `tests/fixtures.ts` 的 `seedProjects` + `initialState()` 工厂（见 `tests/blocks-reducer.test.ts`）；不另造 mock。
- **类型检查**：`npx tsc --noEmit` 必须干净（无 lint 脚本）。
- **commit 规范**：Conventional Commits（`feat:`/`fix:`/`refactor:`），body 末尾空行 + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **clear 别名**：`stop`/`off`/`reset`/`none`/`cancel` 都等价 `clear`（官方）。
- **测试隔离**：reducer 测试直接调 `reducer(state, action)`（纯函数，不碰模块级 store）。

---

## 关键背景（实施者必读）

### runSideQuery（评估器复用，已存在）

`src/main/claude-service.ts:1213` 已有 `private async runSideQuery(prompt: string, cwd?: string): Promise<string>` —— 用激活供应商的模型跑一次旁路 query，返回 assistant 的 text 块拼接字符串（compact 已用它）。goal 评估器复用它（Haiku 角色模型）。

### buildQuery 的 hooks（Stop hook 追加点）

`src/main/claude-service.ts:471` 的 `query({ options: { ..., hooks: { PreToolUse: [...] } } })`。本计划在 hooks 上**追加** `Stop`。

### InputBar 的 hostBuiltin（命令解析参照）

`src/renderer/components/InputBar.tsx:254` 的 `doSend` 里有 hostBuiltin 精确匹配（`trimmed === it.name`，无参命令如 `/export`）。`/goal` 有参数，需用前缀匹配 `/goal ` + 参数解析（Task 3）。

### PlanCard（GoalCard 参照）

`src/renderer/components/PlanCard.tsx` —— 同级的卡片组件，走 pendingDialog 通道。GoalCard 借鉴其形态但不走 dialog 通道（goal 状态是持续的，不是一次性 dialog）。

---

## 文件结构

**新建：**
- `src/renderer/components/GoalIndicator.tsx` — `◎ /goal active` 常驻指示条
- `src/renderer/components/GoalCard.tsx` — 独立状态卡片（详情 + 清除/关闭）
- `tests/goal-reducer.test.ts` — goal 状态转换测试
- `tests/goal-evaluator.test.ts` — evaluateGoal + parseGoalVerdict 容错测试
- `tests/goal-parse.test.ts` — `/goal` 三态命令解析测试

**修改：**
- `src/renderer/types.ts` — 加 `GoalState` 类型
- `src/renderer/state/actions.ts` — 加 goal 相关 Action
- `src/renderer/state/reducer.ts` — 加 goalBySession + goal actions 处理 + CLEAR 联动
- `src/renderer/state/store.tsx` — makeInitialState 加 `goalBySession: {}`
- `src/main/builtin-commands.ts` — 注册 `/goal` 命令
- `src/renderer/components/InputBar.tsx` — doSend 加 `/goal` 三态解析
- `src/main/claude-service.ts` — goalStore + evaluateGoal + Stop hook + goal IPC
- `src/preload/index.ts` — 注册 goal IPC 通道（goal:evaluated/goal:achieved 监听 + set-goal/clear-goal 调用）
- `src/renderer/App.tsx` — 订阅 goal IPC + resume 恢复 goal
- `src/renderer/components/ChatArea.tsx` — 插入 GoalIndicator + GoalCard
- `src/main/remote-bridge.ts`（或 dispatcher）— remote goal 命令分发

---

## Task 1: goal 状态类型 + reducer 基础

**目标**：定义 GoalState 类型 + goalBySession 分片 + SET_GOAL/CLEAR_GOAL/GOAL_EVALUATED/GOAL_ACHIEVED 四个 action 的 reducer 处理。这是所有后续 task 的状态基础。

**Files:**
- Modify: `src/renderer/types.ts`
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`
- Test: `tests/goal-reducer.test.ts`

**Interfaces:**
- Produces: `GoalState` 类型、`goalBySession` 在 AppState、4 个 Action（SET_GOAL/CLEAR_GOAL/GOAL_EVALUATED/GOAL_ACHIEVED）

- [ ] **Step 1: 在 types.ts 加 GoalState 类型**

`src/renderer/types.ts` 末尾加：

```ts
// /goal: 会话级目标条件,Stop hook 每轮评估,未满足续轮、满足清除。
export interface GoalState {
  condition: string        // 目标条件文本(<=4000 字符,官方限制)
  startedAt: number        // 启动时间戳(ms,用于"已运行 Xm")
  turns: number            // 已评估轮数
  tokensBaseline: number   // 启动时 token 基线(用于计算花费,首版可记 0)
  lastReason: string       // 评估器最近一次理由
  status: 'active' | 'achieved' | 'cleared'
}
```

- [ ] **Step 2: 在 actions.ts 加 4 个 Action**

`src/renderer/state/actions.ts`，在 STREAM_END 附近（或文件末尾的 Action 联合里）加：

```ts
  // /goal: 会话级目标(Stop hook 每轮评估)
  | { type: 'SET_GOAL'; sessionId: string; condition: string }
  | { type: 'CLEAR_GOAL'; sessionId: string }
  | { type: 'GOAL_EVALUATED'; sessionId: string; reason: string; turns: number }
  | { type: 'GOAL_ACHIEVED'; sessionId: string }
  | { type: 'SHOW_GOAL_STATUS'; sessionId: string }
```

- [ ] **Step 3: 在 reducer.ts 的 AppState 加 goalBySession**

`src/renderer/state/reducer.ts`，AppState 接口（约第 27 行 `streamingBySession` 附近）加：

```ts
  goalBySession: Record<string, import('../types').GoalState>
```

- [ ] **Step 4: store.tsx makeInitialState 加 goalBySession: {}**

`src/renderer/state/store.tsx` 的 `makeInitialState` base 对象（`streamingBySession: {}` 附近）加：

```ts
    goalBySession: {},
```

- [ ] **Step 5: 写失败测试 — goal 状态转换**

`tests/goal-reducer.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { reducer, setIdCounter } from '../src/renderer/state/reducer'
import { seedProjects } from './fixtures'
import type { AppState } from '../src/renderer/state/reducer'

function initialState(): AppState {
  return {
    projects: structuredClone(seedProjects), activeSessionId: 's1',
    tabsBySession: { s1: [] }, activeTabIdBySession: { s1: null },
    theme: 'codex-light', draft: { doc: null, attachments: [] },
    currentView: 'workspace', activeSettingsSection: 'general', streamingBySession: {},
    settings: { apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {}, theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', chatWidth: 'wide', proxy: '', inheritTerminal: true, terminalFont: 'x', taskNotify: true, notifySound: true, notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true, queueMode: 'queue', showThinking: true, showTodo: true, showBackendTask: true, rememberPanelPosition: true, autoArchive: true, archiveDays: '7', devTools: false, codePreview: { lightTheme: '', darkTheme: '', showLineNumbers: true, wordWrap: false, fontSize: 12 }, skills: [], mcpServers: [], plugins: [], commands: [], hooks: [] },
    claudeSessionMap: {}, pendingDialog: null, dirtyTabIds: {}, lastFileOpenedSeq: 0,
    queueBySession: {}, tasksBySession: {}, backendTasksBySession: {}, panelFold: { root: false }, panelPosition: { x: 0, y: 0 }, subagentOutputBySession: {}, planBySession: {}, abortedBySession: {}, contextUsageBySession: {}, goalBySession: {},
    editingMessageId: null, editingQueueId: null, updateStatus: { state: 'idle' }, reviewByProject: {},
  }
}

describe('goal reducer', () => {
  beforeEach(() => setIdCounter(100))

  it('SET_GOAL 设置 active goal,重置计数器', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'all tests pass' })
    const g = s.goalBySession['s1']
    expect(g).toBeDefined()
    expect(g.status).toBe('active')
    expect(g.condition).toBe('all tests pass')
    expect(g.turns).toBe(0)
    expect(g.startedAt).toBeGreaterThan(0)
  })

  it('SET_GOAL 替换已有 goal', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'A' })
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'B' })
    expect(s.goalBySession['s1'].condition).toBe('B')
    expect(s.goalBySession['s1'].turns).toBe(0)  // 计数器重置
  })

  it('GOAL_EVALUATED 累加 turns + 更新 reason', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'X' })
    s = reducer(s, { type: 'GOAL_EVALUATED', sessionId: 's1', reason: '还差 2 个', turns: 1 })
    expect(s.goalBySession['s1'].turns).toBe(1)
    expect(s.goalBySession['s1'].lastReason).toBe('还差 2 个')
  })

  it('GOAL_ACHIEVED 置 achieved(保留条件/耗时作记录)', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'X' })
    s = reducer(s, { type: 'GOAL_ACHIEVED', sessionId: 's1' })
    expect(s.goalBySession['s1'].status).toBe('achieved')
    expect(s.goalBySession['s1'].condition).toBe('X')  // 保留
  })

  it('CLEAR_GOAL 移除 goal', () => {
    let s = initialState()
    s = reducer(s, { type: 'SET_GOAL', sessionId: 's1', condition: 'X' })
    s = reducer(s, { type: 'CLEAR_GOAL', sessionId: 's1' })
    expect(s.goalBySession['s1']).toBeUndefined()
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx vitest run tests/goal-reducer.test.ts`
Expected: FAIL（reducer 不识别 SET_GOAL 等 action，返回原 state，断言失败）。

- [ ] **Step 7: reducer 加 goal action 处理**

`src/renderer/state/reducer.ts`，在 `switch (action.type)` 里（STREAM_END 之后合适位置）加：

```ts
    case 'SET_GOAL': {
      const goal = {
        condition: action.condition.slice(0, 4000),  // 官方 4000 字符上限
        startedAt: Date.now(),
        turns: 0,
        tokensBaseline: 0,
        lastReason: '',
        status: 'active' as const,
      }
      return { ...state, goalBySession: { ...state.goalBySession, [action.sessionId]: goal } }
    }
    case 'GOAL_EVALUATED': {
      const prev = state.goalBySession[action.sessionId]
      if (!prev) return state
      return {
        ...state,
        goalBySession: {
          ...state.goalBySession,
          [action.sessionId]: { ...prev, turns: action.turns, lastReason: action.reason },
        },
      }
    }
    case 'GOAL_ACHIEVED': {
      const prev = state.goalBySession[action.sessionId]
      if (!prev) return state
      return {
        ...state,
        goalBySession: {
          ...state.goalBySession,
          [action.sessionId]: { ...prev, status: 'achieved' as const },
        },
      }
    }
    case 'CLEAR_GOAL': {
      const { [action.sessionId]: _g, ...rest } = state.goalBySession
      return { ...state, goalBySession: rest }
    }
    case 'SHOW_GOAL_STATUS': {
      // UI state: 复用现有机制(Task 7 处理),reducer 此处 no-op
      return state
    }
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run tests/goal-reducer.test.ts`
Expected: 5/5 PASS。

- [ ] **Step 9: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿（baseline 预存的 2 个失败除外）。

- [ ] **Step 10: Commit**

```bash
git add src/renderer/types.ts src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/state/store.tsx tests/goal-reducer.test.ts
git commit -m "$(cat <<'EOF'
feat(goal): goal 状态层(GoalState + goalBySession + 4 reducer actions)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 注册 /goal 内置命令 + 三态解析

**目标**：在 builtin-commands 注册 `/goal`（引用型，选中插 `/goal ` 文本）；在 InputBar doSend 加三态解析（set/check/clear + 别名）。

**Files:**
- Modify: `src/main/builtin-commands.ts`
- Modify: `src/renderer/components/InputBar.tsx`
- Test: `tests/goal-parse.test.ts`

**Interfaces:**
- Consumes: Task 1 的 SET_GOAL/CLEAR_GOAL/SHOW_GOAL_STATUS actions
- Produces: `parseGoalCommand(prompt)` 纯函数（set/check/clear 三态解析），供 InputBar 和 remote 复用

- [ ] **Step 1: 写失败测试 — 三态解析**

`tests/goal-parse.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseGoalCommand } from '../src/renderer/editor/goalParse'

describe('parseGoalCommand', () => {
  it('/goal <条件> → set', () => {
    expect(parseGoalCommand('/goal all tests pass')).toEqual({ kind: 'set', condition: 'all tests pass' })
  })
  it('/goal(精确无参) → check', () => {
    expect(parseGoalCommand('/goal')).toEqual({ kind: 'check' })
    expect(parseGoalCommand('/goal   ')).toEqual({ kind: 'check' })  // 尾随空格
  })
  it('/goal clear → clear', () => {
    expect(parseGoalCommand('/goal clear')).toEqual({ kind: 'clear' })
  })
  it('/goal 别名 → clear', () => {
    for (const alias of ['stop', 'off', 'reset', 'none', 'cancel']) {
      expect(parseGoalCommand(`/goal ${alias}`)).toEqual({ kind: 'clear' })
    }
  })
  it('非 /goal 开头 → null', () => {
    expect(parseGoalCommand('hello')).toBeNull()
    expect(parseGoalCommand('/init')).toBeNull()
  })
  it('条件保留多文本(含空格)', () => {
    expect(parseGoalCommand('/goal npm test exits 0 and git status is clean'))
      .toEqual({ kind: 'set', condition: 'npm test exits 0 and git status is clean' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/goal-parse.test.ts`
Expected: FAIL（`goalParse` 模块不存在）。

- [ ] **Step 3: 创建 goalParse.ts 纯函数**

`src/renderer/editor/goalParse.ts`：

```ts
// src/renderer/editor/goalParse.ts
// /goal 命令三态解析(纯函数):set/check/clear。
// 供 InputBar doSend 和 remote dispatcher 复用,保证两端口径一致。

const CLEAR_ALIASES = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])

export type GoalCommand =
  | { kind: 'set'; condition: string }
  | { kind: 'check' }
  | { kind: 'clear' }

// 解析 /goal 命令。非 /goal 开头返回 null。
// - '/goal' 或 '/goal  '(仅空白) → check
// - '/goal clear' / '/goal stop' / ... 别名 → clear
// - '/goal <条件>' → set(条件为 clear 别名时不视作 set,优先 clear)
export function parseGoalCommand(input: string): GoalCommand | null {
  const trimmed = input.trim()
  if (trimmed !== '/goal' && !trimmed.startsWith('/goal ')) return null
  // 提取 /goal 之后的参数
  const arg = trimmed.slice('/goal'.length).trim()
  if (arg === '') return { kind: 'check' }
  if (CLEAR_ALIASES.has(arg.toLowerCase())) return { kind: 'clear' }
  return { kind: 'set', condition: arg }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/goal-parse.test.ts`
Expected: 6/6 PASS。

- [ ] **Step 5: 在 builtin-commands.ts 注册 /goal**

`src/main/builtin-commands.ts`，在 `/resume` 附近加（引用型命令，builtinAction type 标记 `goal`，但实际由 InputBar 解析参数，不走 onBuiltinRun 即时执行）：

```ts
  { kind: 'builtin', id: 'builtin:goal', name: '/goal', desc: '设定目标,Claude 持续工作直到完成', builtinAction: { type: 'goal' } },
```

注：`/goal` 是引用型——SlashSuggestion 的 isReferableBuiltin 需要把 `goal` 加入 REFERABLE_BUILTIN_ACTIONS，让选中时插 `/goal ` 文本（Task 5 步骤会处理 SlashSuggestion，本 task 先注册命令项）。

- [ ] **Step 6: SlashSuggestion 把 goal 加入引用型**

`src/renderer/editor/SlashSuggestion.tsx`，第 18 行 `REFERABLE_BUILTIN_ACTIONS`：

```ts
const REFERABLE_BUILTIN_ACTIONS = new Set(['init-project', 'export-session', 'add-dir', 'goal'])
```

- [ ] **Step 7: InputBar doSend 加 /goal 解析**

`src/renderer/components/InputBar.tsx`，在 `doSend` 的 hostBuiltin 查找**之前**（约第 258 行，`const trimmed = prompt.trim()` 之后）插入 /goal 解析。先在文件顶部加 import：

```tsx
import { parseGoalCommand } from '../editor/goalParse'
```

然后在 doSend 里，hostBuiltin 之前加：

```tsx
    const trimmed = prompt.trim()
    // /goal 三态:set 立即发条件启动 + 记 goal;check 弹状态卡片;clear 清 goal + 中断。
    const goalCmd = parseGoalCommand(trimmed)
    if (goalCmd) {
      if (goalCmd.kind === 'check') {
        dispatch({ type: 'SHOW_GOAL_STATUS', sessionId: state.activeSessionId })
        clearLocalDraft()
        return
      }
      if (goalCmd.kind === 'clear') {
        dispatch({ type: 'CLEAR_GOAL', sessionId: state.activeSessionId })
        window.api?.claude?.stop(state.activeSessionId)
        clearLocalDraft()
        return
      }
      // set: 记 goal + 立即把条件作为 prompt 发给 Claude 启动第一轮
      dispatch({ type: 'SET_GOAL', sessionId: state.activeSessionId, condition: goalCmd.condition })
      // 走下面的标准发送流程(条件文本作为 prompt)。先标记,再落到通用 send。
      // 不 return —— 让下方 dispatch SEND_MESSAGE_WITH_DRAFT + send 走完。
    }
    const hostBuiltin = allSlashItems.find(/* 现有不变 */)
```

注意：set 分支不 return，让下方通用发送流程把"条件文本"作为 prompt 发出去（官方"条件作为 directive"）。SET_GOAL 已先 dispatch。

- [ ] **Step 8: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿（baseline 2 个失败除外）。

- [ ] **Step 9: Commit**

```bash
git add src/main/builtin-commands.ts src/renderer/editor/SlashSuggestion.tsx src/renderer/editor/goalParse.ts src/renderer/components/InputBar.tsx tests/goal-parse.test.ts
git commit -m "$(cat <<'EOF'
feat(goal): 注册 /goal 命令 + 三态解析(set/check/clear)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 评估器 evaluateGoal + parseGoalVerdict（纯函数 + 容错）

**目标**：实现 Haiku 评估逻辑（条件 + last_assistant_message → met/reason）+ JSON 解析容错（A3：失败默认 met=false）。

**Files:**
- Modify: `src/main/claude-service.ts`
- Test: `tests/goal-evaluator.test.ts`

**Interfaces:**
- Consumes: `runSideQuery(prompt, cwd?)`（claude-service.ts:1213，返回 string）
- Produces: `ClaudeService.evaluateGoal(condition, lastAssistantMsg)` 返回 `Promise<{met: boolean; reason: string}>`；模块导出 `parseGoalVerdict(raw)` 纯函数（供测试）

- [ ] **Step 1: 写失败测试 — parseGoalVerdict 容错**

`tests/goal-evaluator.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseGoalVerdict } from '../src/main/goal-verdict'

describe('parseGoalVerdict', () => {
  it('合法 JSON met=true → 解析', () => {
    expect(parseGoalVerdict('{"met": true, "reason": "所有测试通过"}'))
      .toEqual({ met: true, reason: '所有测试通过' })
  })
  it('合法 JSON met=false → 解析', () => {
    expect(parseGoalVerdict('{"met": false, "reason": "还有 2 个失败"}'))
      .toEqual({ met: false, reason: '还有 2 个失败' })
  })
  it('JSON 被 markdown 代码块包裹 → 提取', () => {
    expect(parseGoalVerdict('```json\n{"met": true, "reason": "ok"}\n```'))
      .toEqual({ met: true, reason: 'ok' })
  })
  it('JSON 前后有多余文本 → 提取首个 JSON 对象', () => {
    expect(parseGoalVerdict('评估结果是:{"met": false, "reason": "未完成"} 谢谢'))
      .toEqual({ met: false, reason: '未完成' })
  })
  it('非法 JSON → A3 默认 met=false(继续轮) + reason 标注', () => {
    const r = parseGoalVerdict('乱码非JSON')
    expect(r.met).toBe(false)
    expect(r.reason).toMatch(/解析失败|无法解析/)
  })
  it('空响应 → A3 默认 met=false', () => {
    expect(parseGoalVerdict('').met).toBe(false)
    expect(parseGoalVerdict('   ').met).toBe(false)
  })
  it('缺少 reason → reason 兜底空串', () => {
    expect(parseGoalVerdict('{"met": true}')).toEqual({ met: true, reason: '' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/goal-evaluator.test.ts`
Expected: FAIL（`goal-verdict` 模块不存在）。

- [ ] **Step 3: 创建 goal-verdict.ts（纯函数 + 容错）**

`src/main/goal-verdict.ts`：

```ts
// src/main/goal-verdict.ts
// goal 评估结果的 JSON 解析(纯函数)。A3 容错:解析失败默认 met=false(继续轮),
// 避免评估器抖动导致 goal 误判达成而提前停止。

export interface GoalVerdict {
  met: boolean
  reason: string
}

// 从 Haiku 的文本响应解析 {met, reason}。
// 容错:① 代码块包裹 ② 前后多余文本 ③ 非法 JSON → 默认 {met:false, reason:'解析失败'}。
export function parseGoalVerdict(raw: string): GoalVerdict {
  const fallback: GoalVerdict = { met: false, reason: '评估响应解析失败,默认继续' }
  if (!raw || !raw.trim()) return { met: false, reason: '评估响应为空,默认继续' }
  // 提取首个 JSON 对象(容忍代码块包裹 / 前后文本)
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return fallback
  try {
    const obj = JSON.parse(match[0])
    if (typeof obj.met !== 'boolean') return fallback
    return { met: obj.met, reason: typeof obj.reason === 'string' ? obj.reason : '' }
  } catch {
    return fallback
  }
}

// 构造评估 prompt(给 Haiku)。单独导出便于测试 + 与 evaluateGoal 解耦。
export function buildGoalEvalPrompt(condition: string, lastAssistantMsg: string): string {
  return `你是目标评估器。判断以下对话进展是否满足目标条件。仅根据给定信息判断,不主动查文件/跑命令。

目标条件:
${condition}

最新进展(最后一条助手消息):
${lastAssistantMsg}

返回 JSON(不要代码块包裹): {"met": true/false, "reason": "简短理由(是否达成 + 下一步)"}`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/goal-evaluator.test.ts`
Expected: 7/7 PASS。

- [ ] **Step 5: ClaudeService 加 evaluateGoal 方法**

`src/main/claude-service.ts`，文件顶部加 import：

```ts
import { parseGoalVerdict, buildGoalEvalPrompt, type GoalVerdict } from './goal-verdict'
```

在 `runSideQuery` 附近（class ClaudeService 内）加方法：

```ts
  /**
   * /goal 评估器:用 Haiku 判断"条件 + 最新进展"是否达成。
   * 复用 runSideQuery(激活供应商的模型;Haiku 角色由 modelRoleMap 映射)。
   * A3 容错:runSideQuery 抛错或解析失败 → {met:false}(继续轮)。
   */
  async evaluateGoal(condition: string, lastAssistantMsg: string, cwd?: string): Promise<GoalVerdict> {
    try {
      const raw = await this.runSideQuery(buildGoalEvalPrompt(condition, lastAssistantMsg), cwd)
      return parseGoalVerdict(raw)
    } catch (err) {
      return { met: false, reason: `评估调用失败:${String(err)},默认继续` }
    }
  }
```

- [ ] **Step 6: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿。

- [ ] **Step 7: Commit**

```bash
git add src/main/goal-verdict.ts src/main/claude-service.ts tests/goal-evaluator.test.ts
git commit -m "$(cat <<'EOF'
feat(goal): evaluateGoal 评估器(Haiku + A3 容错)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: goalStore + Stop hook 集成 + goal IPC

**目标**：ClaudeService 维护 goalStore（lsid → condition）；buildQuery 的 hooks 追加 Stop hook（评估 + additionalContext 续轮）；goal 状态变化经 IPC 下发渲染端。这是 /goal 的核心引擎。

**Files:**
- Modify: `src/main/claude-service.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: Task 3 的 `evaluateGoal`；Task 1 的 GOAL_EVALUATED/GOAL_ACHIEVED/CLEAR_GOAL actions
- Produces: IPC 通道 `claude:goal-evaluated`(lsid, reason, turns) / `claude:goal-achieved`(lsid)；`ClaudeService.setGoal(lsid, condition)` / `clearGoal(lsid)`；preload 暴露 `window.api.claude.onGoalEvaluated` / `onGoalAchieved`

- [ ] **Step 1: ClaudeService 加 goalStore + setGoal/clearGoal**

`src/main/claude-service.ts`，class ClaudeService 的字段区（约第 57 行 `private toolUseInputs` 附近）加：

```ts
  // /goal: 每个 session 的当前目标条件(session 级,Stop hook 据此评估)。
  // status='active' 时 Stop hook 评估;否则 hook no-op。一个 session 一个 goal。
  private goalStore = new Map<string, { condition: string; status: 'active' | 'achieved' }>()
  // goal 评估轮数(Stop hook 每评估一次 +1,IPC 下发用于状态展示)
  private goalTurns = new Map<string, number>()
```

class 内加方法：

```ts
  /** 渲染端 SET_GOAL 时经 IPC 调用:记录条件 + 重置轮数,Stop hook 据此激活评估。 */
  setGoal(lsid: string, condition: string): void {
    this.goalStore.set(lsid, { condition, status: 'active' })
    this.goalTurns.set(lsid, 0)
  }

  /** 渲染端 CLEAR_GOAL 时经 IPC 调用:清除 goal,Stop hook 不再评估。 */
  clearGoal(lsid: string): void {
    this.goalStore.delete(lsid)
    this.goalTurns.delete(lsid)
  }
```

- [ ] **Step 2: buildQuery hooks 追加 Stop hook**

`src/main/claude-service.ts`，第 471 行 `hooks: { PreToolUse: [...] }` 改为同时含 Stop：

```ts
          hooks: {
            PreToolUse: [{
              matcher: 'AskUserQuestion|ExitPlanMode',
              hooks: [async () => ({
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'ask' as const,
                },
              })],
            }],
            // /goal: 每轮结束评估条件。未满足返 additionalContext → SDK 自动续轮;
            // 满足 → IPC 通知渲染端清除,不返 context(真正停)。
            Stop: [{
              hooks: [async (input: any) => {
                const goal = this.goalStore.get(lsid)
                if (!goal || goal.status !== 'active') return {}  // 无 goal: 正常停
                // stop_hook_active 兜底:SDK 在"续轮后的下一次 stop"置 true。
                // 若 goal 已被清除(用户 clear)而 stop_hook_active 仍 true,避免无限续。
                if (input.stop_hook_active && !this.goalStore.has(lsid)) return {}
                const turns = (this.goalTurns.get(lsid) ?? 0) + 1
                this.goalTurns.set(lsid, turns)
                const verdict = await this.evaluateGoal(
                  goal.condition,
                  typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '',
                )
                webContents.send('claude:goal-evaluated', { localSessionId: lsid, reason: verdict.reason, turns })
                if (verdict.met) {
                  this.goalStore.delete(lsid)  // 清除,防续轮后又进 hook
                  webContents.send('claude:goal-achieved', { localSessionId: lsid })
                  return {}  // 不返 context → SDK 真正停
                }
                // 未达成:返 context → SDK 自动开下一轮(官方机制)
                return {
                  hookSpecificOutput: {
                    hookEventName: 'Stop' as const,
                    additionalContext: `目标尚未达成:${verdict.reason}。请继续推进。`,
                  },
                }
              }],
            }],
          },
```

- [ ] **Step 3: 主进程 index.ts 注册 set-goal/clear-goal IPC**

`src/main/index.ts`（找到 `ipcMain.handle('claude:running-sessions'` 附近）加：

```ts
  ipcMain.handle('claude:set-goal', (_e, lsid: string, condition: string) => claude.setGoal(lsid, condition))
  ipcMain.handle('claude:clear-goal', (_e, lsid: string) => claude.clearGoal(lsid))
```

- [ ] **Step 4: preload 暴露 goal IPC**

`src/preload/index.ts`，在 `claude:` 的 ipcRender 桥接区（`onSystem`/`onDelta` 附近）加监听 + 调用：

```ts
    onGoalEvaluated: (cb: (data: any) => void) => ipcRenderer.on('claude:goal-evaluated', (_e, data) => cb(data)),
    onGoalAchieved: (cb: (data: any) => void) => ipcRenderer.on('claude:goal-achieved', (_e, data) => cb(data)),
    setGoal: (lsid: string, condition: string) => ipcRenderer.invoke('claude:set-goal', lsid, condition),
    clearGoal: (lsid: string) => ipcRenderer.invoke('claude:clear-goal', lsid),
```

注意：`claude:goal-evaluated`/`goal-achieved` 需加入 preload 的 `removeAllListeners` 清单（若有），避免泄漏。

- [ ] **Step 5: App.tsx 订阅 goal IPC + 联动 reducer**

`src/renderer/App.tsx`，在 `claude:user-message` 订阅附近（约第 265 行）加：

```tsx
    api.onGoalEvaluated?.((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      dispatch({ type: 'GOAL_EVALUATED', sessionId: sid, reason: data.reason, turns: data.turns })
    })
    api.onGoalAchieved?.((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      dispatch({ type: 'GOAL_ACHIEVED', sessionId: sid })
    })
```

- [ ] **Step 6: SET_GOAL/CLEAR_GOAL 时经 IPC 同步主进程 goalStore**

`src/renderer/components/InputBar.tsx`，Task 2 Step 7 加的 /goal 解析里，set/clear 分支补 IPC 调用：

```tsx
      if (goalCmd.kind === 'clear') {
        dispatch({ type: 'CLEAR_GOAL', sessionId: state.activeSessionId })
        window.api?.claude?.clearGoal?.(state.activeSessionId)  // ← 新增:同步主进程
        window.api?.claude?.stop(state.activeSessionId)
        clearLocalDraft()
        return
      }
      if (goalCmd.kind === 'set') {
        dispatch({ type: 'SET_GOAL', sessionId: state.activeSessionId, condition: goalCmd.condition })
        window.api?.claude?.setGoal?.(state.activeSessionId, goalCmd.condition)  // ← 新增
      }
```

- [ ] **Step 7: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿。Stop hook 真实续轮无法 jsdom 测,留手动验证(Task 9)。

- [ ] **Step 8: Commit**

```bash
git add src/main/claude-service.ts src/main/index.ts src/preload/index.ts src/renderer/App.tsx src/renderer/components/InputBar.tsx
git commit -m "$(cat <<'EOF'
feat(goal): Stop hook 评估核心 + goal IPC(set/clear/evaluated/achieved)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: GoalIndicator + GoalCard UI 组件

**目标**：`◎ /goal active` 常驻指示条 + 独立状态卡片（条件/轮数/时长/token/评估理由 + 清除/关闭 + 软阈值提示）。

**Files:**
- Create: `src/renderer/components/GoalIndicator.tsx`
- Create: `src/renderer/components/GoalCard.tsx`
- Modify: `src/renderer/components/ChatArea.tsx`

**Interfaces:**
- Consumes: `useSelector(s => s.goalBySession[activeSessionId])`；CLEAR_GOAL action；`window.api.claude.clearGoal`

- [ ] **Step 1: 创建 GoalIndicator.tsx（指示条）**

`src/renderer/components/GoalIndicator.tsx`：

```tsx
// src/renderer/components/GoalIndicator.tsx
// goal 激活时常驻对话区顶部的指示条:条件简述 + 轮数 + token + 时长。点击展开 GoalCard。
import { useSelector } from '../state/store'
import type { AppState } from '../state/reducer'
import type { GoalState } from '../types'

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

export function GoalIndicator({ onOpen }: { onOpen: () => void }) {
  const sid = useSelector((s: AppState) => s.activeSessionId)
  const goal = useSelector((s: AppState) => s.goalBySession[sid])
  if (!goal || goal.status !== 'active') return null
  const elapsed = Date.now() - goal.startedAt
  const condShort = goal.condition.length > 40 ? goal.condition.slice(0, 40) + '…' : goal.condition
  return (
    <div
      onClick={onOpen}
      title={goal.condition}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 14px', margin: '0 28px 8px',
        background: 'var(--surface-1)', borderRadius: 'var(--radius)',
        border: '1px solid var(--accent)', cursor: 'pointer', fontSize: 12,
        color: 'var(--text)',
      }}
    >
      <span style={{ color: 'var(--accent)' }}>◎ /goal active</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>·</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{condShort}</span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>· 已运行 {goal.turns} 轮 · {fmtDuration(elapsed)}</span>
    </div>
  )
}
```

- [ ] **Step 2: 创建 GoalCard.tsx（状态卡片）**

`src/renderer/components/GoalCard.tsx`：

```tsx
// src/renderer/components/GoalCard.tsx
// /goal 独立状态卡片:条件/状态/最近评估/清除按钮 + 软阈值提示(>30 轮)。
import { useSelector, useDispatch } from '../state/store'
import type { AppState } from '../state/reducer'

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`
}

const SOFT_TURN_THRESHOLD = 30

export function GoalCard({ onClose }: { onClose: () => void }) {
  const sid = useSelector((s: AppState) => s.activeSessionId)
  const goal = useSelector((s: AppState) => s.goalBySession[sid])
  const dispatch = useDispatch()
  if (!goal) return null
  const elapsed = Date.now() - goal.startedAt
  const isAchieved = goal.status === 'achieved'
  const overThreshold = goal.turns > SOFT_TURN_THRESHOLD && goal.status === 'active'

  const handleClear = () => {
    dispatch({ type: 'CLEAR_GOAL', sessionId: sid })
    window.api?.claude?.clearGoal?.(sid)
    window.api?.claude?.stop(sid)
    onClose()
  }

  return (
    <div style={{
      background: 'var(--surface-1)', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-float)', padding: 16, maxWidth: 560, margin: '0 auto',
      border: `1px solid ${isAchieved ? 'var(--success, #22c55e)' : 'var(--accent)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{isAchieved ? '✅' : '🎯'}</span>
        <strong>Goal</strong>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onClose}>✕</span>
      </div>

      <div style={{ fontSize: 13, marginBottom: 6 }}><strong>条件:</strong> {goal.condition}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {isAchieved ? '✓ 已达成' : '● 进行中'}（{goal.turns} 轮 · {fmtDuration(elapsed)}）
      </div>

      {goal.lastReason && (
        <div style={{ fontSize: 12, background: 'var(--bg-hover)', padding: 8, borderRadius: 6, marginBottom: 10, color: 'var(--text-muted)' }}>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>最近评估:</div>
          {goal.lastReason}
        </div>
      )}

      {overThreshold && (
        <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10, padding: 8, background: 'rgba(245,158,11,0.1)', borderRadius: 6 }}>
          ⚠️ 已跑 {goal.turns} 轮,确认要继续?(A3+B2:无硬上限,仅提示)
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {!isAchieved && (
          <button onClick={handleClear} style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)' }}>清除 goal</button>
        )}
        <button onClick={onClose} style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text)' }}>关闭</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: ChatArea 插入 GoalIndicator + GoalCard**

`src/renderer/components/ChatArea.tsx`，import 加：

```tsx
import { GoalIndicator } from './GoalIndicator'
import { GoalCard } from './GoalCard'
```

ChatArea 组件内加状态控制 GoalCard 弹出（SHOW_GOAL_STATUS 触发）：

```tsx
  const [showGoalCard, setShowGoalCard] = useState(false)
  // SHOW_GOAL_STATUS 触发 GoalCard 弹出
  useEffect(() => {
    // 简化:用一个订阅 + 一个 flag。SHOW_GOAL_STATUS 在 reducer 是 no-op,
    // 这里靠监听 goalBySession 变化或独立 signal。本版用 showGoalCard local state + 命令直接 setShowGoalCard。
  }, [])
```

注：SHOW_GOAL_STATUS 的触发链路——InputBar 的 check 分支不能直接改 ChatArea 的 local state。最简方案：InputBar check 分支用一个轻量全局信号。**实现者注意**：把 SHOW_GOAL_STATUS 改为 reducer 维护一个 `goalCardOpen: boolean`（或复用 pendingDialog 模式），ChatArea 据此渲染 GoalCard。最干净做法：

 reducer 加 `goalCardOpenBySession: Record<string, boolean>`（或单一 `goalCardOpen: string | null`），SHOW_GOAL_STATUS 置 true，GoalCard 关闭时 dispatch 一个 `HIDE_GOAL_CARD`。

具体：`src/renderer/state/actions.ts` 加：

```ts
  | { type: 'SHOW_GOAL_STATUS'; sessionId: string }
  | { type: 'HIDE_GOAL_CARD' }
```

`src/renderer/state/reducer.ts`，AppState 加 `goalCardOpen: string | null`，makeInitialState 加 `goalCardOpen: null`，reducer：

```ts
    case 'SHOW_GOAL_STATUS':
      return { ...state, goalCardOpen: action.sessionId }
    case 'HIDE_GOAL_CARD':
      return { ...state, goalCardOpen: null }
```

Task 1 的 SHOW_GOAL_STATUS no-op 占位替换为此实现。

ChatArea 渲染（消息列表上方）：

```tsx
      <GoalIndicator onOpen={() => dispatch({ type: 'SHOW_GOAL_STATUS', sessionId: activeSessionId })} />
      {goalCardOpen === activeSessionId && (
        <div style={{ padding: '0 28px 12px' }}>
          <GoalCard onClose={() => dispatch({ type: 'HIDE_GOAL_CARD' })} />
        </div>
      )}
```

`goalCardOpen` 从 store 订阅：`const goalCardOpen = useSelector((s: AppState) => s.goalCardOpen)`

- [ ] **Step 4: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/GoalIndicator.tsx src/renderer/components/GoalCard.tsx src/renderer/components/ChatArea.tsx src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/state/store.tsx
git commit -m "$(cat <<'EOF'
feat(goal): GoalIndicator 指示条 + GoalCard 状态卡片 UI

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: /clear 联动 + resume 恢复

**目标**：CLEAR_SESSION_MESSAGES 顺带清 goal（E）；刷新/resume 时还原未完成 goal（D）。

**Files:**
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: Task 1 的 goalBySession；现有 CLEAR_SESSION_MESSAGES；现有 HYDRATE + 恢复循环

- [ ] **Step 1: CLEAR_SESSION_MESSAGES 联动清 goal**

`src/renderer/state/reducer.ts`，找到 `case 'CLEAR_SESSION_MESSAGES'`，在其 return 里加 goalBySession 清除。原 return 形如 `return { ...state, projects: ..., streamingBySession: ... }`，追加：

```ts
      // /clear 联动:开新会话清空时顺带清 goal(官方:/clear 清 goal)
      const { [action.sessionId]: _goal, ...goalRest } = state.goalBySession
      return { ...state, projects: /* 现有 */, goalBySession: goalRest }
```

（实现者：读现有 CLEAR_SESSION_MESSAGES 分支,在它的 return 对象里加 `goalBySession: goalRest`,其中 goalRest 是剔除该 session 的副本。)

- [ ] **Step 2: 持久化 goal(active)进 projects.json 快照**

`src/renderer/state/store.tsx` 的 `HYDRATE` 还原（或 `src/renderer/App.tsx` 的 save）：goal 是渲染端 state，需随会话落盘。

最干净：`src/main/projects-store.ts` 的快照结构加 `goalBySession`（只存 active 的）。但 projects.json 是主进程管的快照——实现者评估最小改动：

**推荐做法**：App.tsx 的 `projects:save` 调用处（约第 202 行），把 active goal 随快照存。`getProjectsSnapshot` 扩展含 goalBySession（只 active）。HYDRATE 后还原。

`src/main/projects-store.ts` 的 snapshot 类型加：

```ts
  goalBySession?: Record<string, { condition: string }>
```

`src/renderer/App.tsx` save（第 202 行 `window.api?.projects.save({...})`）加 `goalBySession`（只存 active 的条件）：

```tsx
      window.api?.projects.save({
        projects: state.projects,
        activeSessionId: state.activeSessionId,
        tabsBySession: state.tabsBySession,
        activeTabIdBySession: state.activeTabIdBySession,
        claudeSessionMap: state.claudeSessionMap,
        // /goal: 只持久化 active 的 goal 条件(achieved/cleared 不还原,官方)
        goalBySession: Object.fromEntries(
          Object.entries(state.goalBySession)
            .filter(([, g]) => g.status === 'active')
            .map(([k, g]) => [k, { condition: g.condition }])
        ),
      })
```

- [ ] **Step 3: HYDRATE 还原 goal + resume 时重新挂 Stop hook**

`src/renderer/App.tsx` 的 HYDRATE dispatch 之后（约第 141 行 `dispatch({ type: 'HYDRATE', snapshot: snap })` 之后）加 goal 还原：

```tsx
      // /goal resume:还原未完成(active)的 goal,计数器重置(官方:条件保留,turns/timer 重置)
      const goals = (snap as any).goalBySession || {}
      for (const [gsid, g] of Object.entries(goals)) {
        const condition = (g as any).condition
        if (typeof condition === 'string' && condition) {
          dispatch({ type: 'SET_GOAL', sessionId: gsid, condition })
          // 同步主进程 goalStore,让该 session 的 Stop hook 重新激活评估
          window.api?.claude?.setGoal?.(gsid, condition)
        }
      }
```

注：SET_GOAL 会重置 turns/startedAt（Task 1 已实现），符合官方"计数器重置"。

- [ ] **Step 4: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿。

- [ ] **Step 5: 手动验证 resume(留 Task 9 统一)**

- [ ] **Step 6: Commit**

```bash
git add src/renderer/state/reducer.ts src/renderer/App.tsx src/main/projects-store.ts
git commit -m "$(cat <<'EOF'
feat(goal): /clear 联动清 goal + resume 还原未完成 goal

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Remote Control（手机端 goal 命令）

**目标**：手机端发 /goal 命令经 dispatcher 处理（set/check/clear）；goal 状态变化经 forwarder 下发手机端。

**Files:**
- Modify: `src/main/remote-bridge.ts`（或 remote command dispatcher）
- Modify: `src/main/claude-service.ts`（forwarder 发 goal 事件）

**Interfaces:**
- Consumes: Task 4 的 goalStore + setGoal/clearGoal；现有 dispatcher 命令分发模式

**注意**：remote 实现依赖现有 dispatcher 的命令路由结构。实现者先读 `src/main/remote-bridge.ts` 的入站命令分发（session.message/session.create 等的白名单与处理），按同样模式加 goal 三态。

- [ ] **Step 1: 读 remote-bridge dispatcher 结构**

Run: `grep -nE "session\.message|session\.create|dispatcher|case '|whitelist|inbound" src/main/remote-bridge.ts`
确认入站命令的分发模式（switch/match + handler）。

- [ ] **Step 2: dispatcher 加 goal.set/status/clear 处理**

`src/main/remote-bridge.ts`，在 dispatcher 的命令分发里（参照 session.message 模式）加：

```ts
    // /goal set:手机端发条件 → 等价桌面 SET_GOAL + 发 Claude 启动
    case 'goal.set': {
      const { localSessionId, condition } = payload
      if (localSessionId && typeof condition === 'string') {
        this.claudeService.setGoal(localSessionId, condition)
        // 触发桌面端 dispatch SET_GOAL(经 webContents 推一个事件,或复用现有机制)
        wc.send('claude:goal-set-by-remote', { localSessionId, condition })
        // 启动一轮(条件作为 prompt)
        this.claudeService.send({ localSessionId, prompt: condition } as any)
      }
      return
    }
    case 'goal.status': {
      const { localSessionId } = payload
      const goal = this.claudeService.getGoalStatus(localSessionId)  // 见 Step 3
      wc.send('claude:goal-status-reply', { localSessionId, goal })
      return
    }
    case 'goal.clear': {
      const { localSessionId } = payload
      this.claudeService.clearGoal(localSessionId)
      this.claudeService.interrupt?.(localSessionId)  // 中断当前轮
      wc.send('claude:goal-set-by-remote', { localSessionId, condition: null })  // null=清除
      return
    }
```

- [ ] **Step 3: ClaudeService 加 getGoalStatus（供 remote status 查询）**

`src/main/claude-service.ts`，class 内加：

```ts
  /** remote goal.status 查询:返回 goal 当前状态(条件/status/turns)。 */
  getGoalStatus(lsid: string): { condition: string; status: string; turns: number } | null {
    const g = this.goalStore.get(lsid)
    if (!g) return null
    return { condition: g.condition, status: g.status, turns: this.goalTurns.get(lsid) ?? 0 }
  }
```

- [ ] **Step 4: goal 状态变化经 forwarder 下发手机端**

`src/main/claude-service.ts` 的 Stop hook（Task 4 Step 2）里，评估/达成时已有 `webContents.send('claude:goal-evaluated'/'claude:goal-achieved')`。remote forwarder 旁路转发——在现有 forwarder（旁路 claude:* 给手机端）里把 goal-evaluated/goal-achieved/goal-set-by-remote 也转发。读 forwarder 的转发白名单,加入这三个事件。

- [ ] **Step 5: preload/web 端订阅 goal 事件（桌面端 + 手机 web 端）**

`src/preload/index.ts` 已在 Task 4 暴露 onGoalEvaluated/onGoalAchieved。桌面端 App.tsx 已订阅。**手机 web 端**（web/ PWA）订阅同通道——若 web 端有独立的 IPC 层,按其模式订阅 goal-evaluated/achieved 更新 UI。本 task 只确保主进程下发,web 端 UI 展示属于 web 端范畴(若 web 端暂只读,状态可见即可)。

- [ ] **Step 6: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿。

- [ ] **Step 7: Commit**

```bash
git add src/main/remote-bridge.ts src/main/claude-service.ts
git commit -m "$(cat <<'EOF'
feat(goal): Remote Control 支持(goal.set/status/clear + 状态下发)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 全量验收 + 手动验证

**目标**：跑全量测试 + 真机验证 Stop hook 续轮 / UI / resume / remote（jsdom 测不了的核心闭环）。

**Files:** 无（验证任务）

- [ ] **Step 1: tsc + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 干净；全量绿（baseline 2 个失败除外）。

- [ ] **Step 2: 手动验证 — 核心闭环（pnpm dev）**

启动 `pnpm dev`，验证：
- [ ] 输入 `/goal npm test exits 0`（或类似可证伪条件）→ Claude 开始工作
- [ ] 每轮结束后，GoalIndicator 显示轮数递增 + 评估理由更新
- [ ] 条件未满足时，Claude 自动开下一轮（不需手动提示）
- [ ] 条件满足时，goal 自动清除，GoalIndicator 消失，对话流插"🎯 目标已达成"notice
- [ ] `/goal`（无参）弹出 GoalCard 显示完整状态
- [ ] `/goal clear` 中断 + 清除 goal

- [ ] **Step 3: 手动验证 — 边界 + 联动**

- [ ] `/goal` 在 slash 菜单显示，选中插 `/goal ` 文本
- [ ] `/clear` 清空会话时，goal 一并清除（GoalIndicator 消失）
- [ ] goal 激活期间刷新页面 → goal 条件还原（轮数重置），Stop hook 继续评估
- [ ] 评估失败（模拟：临时让 runSideQuery 报错）→ A3 默认继续轮（不误停）
- [ ] 轮数 > 30 → GoalCard 显示软阈值提示

- [ ] **Step 4: 手动验证 — Remote（若手机端可用）**

- [ ] 手机端发 `/goal xxx` → 桌面/手机都显示 goal active
- [ ] 手机端发 `/goal clear` → 中断 + 清除

- [ ] **Step 5: 记录验收结果**

最终 commit（验收记录）：

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(goal): 验收完成(核心闭环 + 联动 + resume + remote)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- A 命令三态 → Task 2（parseGoalCommand + InputBar 解析 + 注册）✓
- B 核心（Stop hook + 评估 + 续轮 + A3/B2）→ Task 3（评估器）+ Task 4（Stop hook）✓
- C 状态层 → Task 1（reducer）+ Task 5（goalCardOpen）✓
- D resume → Task 6 ✓
- E /clear 联动 → Task 6 ✓
- F remote → Task 7 ✓
- UI（指示条 + GoalCard + 软阈值）→ Task 5 ✓

**2. Placeholder scan:** 
- Task 5 Step 3 的 `goalCardOpen` 机制从"local state"演化为"reducer state"，已在同 step 给出完整实现（actions + reducer + AppState 字段），非占位。
- Task 6 Step 1 的 `goalRest` 在 return 里，实现者需读现有 CLEAR_SESSION_MESSAGES 分支整合——给了明确模式但未给完整 return（因 return 含现有字段）。**这是合理的，因为完整 return 依赖现有代码**，实现者按模式追加 `goalBySession: goalRest` 即可。不算占位（有明确指令）。
- Task 7 依赖 remote-bridge 现有 dispatcher 结构（命令路由模式），先 grep 再按模式加——给了 case 代码 + 明确参照。可接受。

**3. Type consistency:**
- `GoalState`（condition/startedAt/turns/tokensBaseline/lastReason/status）Task 1 定义，Task 5 UI 用同名同字段 ✓
- `parseGoalCommand`（Task 2）→ InputBar（Task 4 Step 6 引用）✓
- `evaluateGoal(condition, lastAssistantMsg, cwd?)`（Task 3）→ Stop hook（Task 4 Step 2 调用）✓
- `setGoal(lsid, condition)`/`clearGoal(lsid)`（Task 4）→ InputBar（Task 4 Step 6）+ resume（Task 6 Step 3）+ remote（Task 7）✓
- IPC 通道名 `claude:goal-evaluated`/`claude:goal-achieved`（Task 4）→ App.tsx 订阅（Task 4 Step 5）+ remote 转发（Task 7 Step 4）✓

**4. 已知手动验证项（jsdom 测不了）:** Stop hook 真实续轮、UI 指示条/GoalCard 视觉、resume 真实恢复、remote 真机——全部 Task 8 手动验证。
