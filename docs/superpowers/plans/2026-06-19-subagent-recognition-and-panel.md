# Subagent 识别与悬浮面板改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 正确识别 Claude Task 工具 spawn 的 subagent,把它和 local_workflow 后台任务统一收进右上角悬浮面板(三段式),并把 subagent 自己的对话输出从主对话流折叠分离。

**Architecture:** 给现有 `BackendTaskRegistry` 的 `BackendTask` 加 `kind` 判别字段(`subagent`/`workflow`/`shell`/`monitor`),由 registry 内部 `resolveKind` 统一归类;主进程对带 `subagent_type` 的 assistant 消息走新 `claude:subagent-output` 通道,渲染端在 Task 工具卡片下挂可折叠的子代理输出区;面板按 `kind` 拆成任务/子代理/后台任务三段。

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React + 自研 reducer state, Vitest, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)。

**Spec:** [docs/superpowers/specs/2026-06-19-subagent-recognition-and-panel-design.md](../specs/2026-06-19-subagent-recognition-and-panel-design.md)

---

## 关键设计决策(实施前必读)

1. **task_type 值域**:SDK 实际只对四类长生命周期任务发 `task_started`,`task_type` ∈ `{'shell','subagent','monitor','local_workflow'}`(见 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 的 `BackgroundTaskSummary.type` 注释)。普通 Write/Edit 工具调用**不发** task_started,所以"所有 task_started 都进 registry"不会把普通工具调用塞进面板。

2. **未知 task_type 处理**:`resolveKind` 对"无 task_type 且无 subagent_type"返回 `null`,registry 不创建(保持与现有"普通 todo 不创建"测试语义一致)。只对能明确归类的四类 + subagent_type 非空的事件创建。这与 spec 第 1 节"未知归 workflow"有调整——经实施前取证,改为"未知不创建"更安全,兼容既有 `task_type='tool'`/无 task_type 的回归测试。

3. **既有测试更新**:现有 `tests/forward-event-identity.test.ts` 的 `task_type='agent' → claude:task kind=started` 和 `task_notification 普通 task → claude:task kind=updated` 两条断言固化的是旧(错误)行为,本计划在 Task 7 里更新它们为新行为(subagent 走 backend-task 通道)。

4. **临时调试日志**:Task 1 先加 `task_*` 调试日志并抓真实样本,校准 `resolveKind` 的字面值映射;Task 8(收尾)移除或降级该日志。

## 文件结构

**主进程:**
- `src/main/backend-task-registry.ts` — 加 `BackendTaskKind`/`subagentType`/`resolveKind`,放宽 `handleTaskStarted`。
- `src/main/claude-service.ts` — `task_started` 全进 registry;`assistant` 分流 `subagent_type`;临时调试日志。
- `src/preload/index.ts` — 暴露 `claude.onSubagentOutput` + 注册 `claude:subagent-output` 通道清理。

**渲染端:**
- `src/renderer/types.ts` — 对齐 `BackendTaskKind`/`subagentType` 字段。
- `src/renderer/state/reducer.ts` — `subagentOutputBySession` + `panelFold` 扩 `subagentCard`。
- `src/renderer/state/actions.ts` — `APPEND_SUBAGENT_OUTPUT` + `SET_PANEL_FOLD` 联合类型扩 `'subagentCard'`。
- `src/renderer/state/store.tsx` — 初始 `subagentOutputBySession: {}` + `panelFold.subagentCard: false`。
- `src/renderer/components/BackendTaskPanel.tsx` — 三段式分区。
- `src/renderer/components/SubagentCard.tsx` — 新增。
- `src/renderer/components/blocks/ToolUseCard.tsx` — Task 工具卡片挂子代理输出折叠区。
- `src/renderer/components/ChatArea.tsx` — 接 `claude:subagent-output` 监听。

**测试:**
- `tests/backend-task-registry.test.ts` — `resolveKind`/subagent 创建/kind 字段。
- `tests/forward-event-identity.test.ts` — 更新旧断言为新行为。
- `tests/reducer-extra.test.ts` — `subagentOutputBySession` / `panelFold.subagentCard`。
- `tests/subagent-panel-render.test.tsx` — 新增,三段式面板渲染 + SubagentCard。
- `tests/e2e-real-model.test.ts` — 真机 subagent 触发验证(条件执行)。

---

### Task 1: 临时调试日志抓取真实 task_* 事件样本

**Files:**
- Modify: `src/main/claude-service.ts:255`(case 'system' 分支顶部)

- [ ] **Step 1: 在 case 'system' 顶部插入调试日志**

定位 [claude-service.ts:256](/Users/mrhua/projects/aieditor/cc-desk/src/main/claude-service.ts:256) 处 `const subtype: string = sys.subtype` 这一行,在其后插入:

```typescript
        // [临时] 抓取真实 task_* 事件结构,校准 resolveKind 映射;Task 8 移除
        if (subtype && subtype.startsWith('task_')) {
          console.log('[cc-desk][debug] task event', {
            subtype, task_id: sys.task_id, task_type: sys.task_type,
            subagent_type: sys.subagent_type, description: sys.description,
          })
        }
```

- [ ] **Step 2: 构建确认无语法错误**

Run: `pnpm build`
Expected: 构建成功,无 TS 报错。

- [ ] **Step 3: 运行应用抓取真实样本**

Run: `pnpm dev`,在应用中发起一个会触发 subagent 的对话(如"用 Task 工具并行跑两个子代理,一个检查 src/ 一个检查 tests/"),观察主进程控制台 `[cc-desk][debug] task event` 输出。
Expected: 看到 `task_started` 事件,记录真实的 `task_type` 和 `subagent_type` 字面值。把输出贴给计划执行者用于 Task 3 的映射校准。

- [ ] **Step 4: Commit**

```bash
git add src/main/claude-service.ts
git commit -m "debug: 抓取真实 task_* 事件样本(临时,Task 8 移除)"
```

> **注:** 若真机无法触发 subagent(第三方代理不支持),跳过 Step 3 的实证,Task 3 按文档字面值 `'subagent'`/`'agent'` 双兜底实现,依赖 Task 9 的单元测试兜底验证。

---

### Task 2: 扩展 BackendTask 数据模型与 resolveKind

**Files:**
- Modify: `src/main/backend-task-registry.ts:6-26`(类型) + `:46-72`(handleTaskStarted)
- Test: `tests/backend-task-registry.test.ts`

- [ ] **Step 1: 写失败测试 — subagent_type 非空创建 subagent 类型任务**

在 `tests/backend-task-registry.test.ts` 末尾追加:

```typescript
  // ===== resolveKind: subagent 识别 =====
  it('task_started 带 subagent_type → 创建 kind=subagent 任务', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'sub1',
      task_type: 'subagent',
      subagent_type: 'general-purpose',
      description: '审查 src 目录',
    })

    expect(task).not.toBeNull()
    expect(task!.kind).toBe('subagent')
    expect(task!.subagentType).toBe('general-purpose')
    expect(task!.command).toBe('审查 src 目录')
  })

  it('task_started subagent_type 非空但 task_type 为 agent → 仍归 subagent', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'sub2',
      task_type: 'agent',
      subagent_type: 'code-reviewer',
      description: '代码评审',
    })

    expect(task).not.toBeNull()
    expect(task!.kind).toBe('subagent')
  })

  it('local_workflow 事件 kind=workflow', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'wf1', task_type: 'local_workflow', description: '跑脚本',
    })

    expect(task).not.toBeNull()
    expect(task!.kind).toBe('workflow')
  })

  it('无 task_type 且无 subagent_type → 不创建(兼容旧 todo 行为)', () => {
    const reg = new BackendTaskRegistry()
    const task = reg.handleTaskStarted('session1', {
      task_id: 'unknown1', description: '神秘任务',
    })

    expect(task).toBeNull()
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/backend-task-registry.test.ts`
Expected: 新增的 4 条测试 FAIL(`kind` / `subagentType` 属性不存在,且无 task_type 仍按旧逻辑 `!== 'local_workflow'` 返回 null——但前两条 subagent 测试因 `task_type !== 'local_workflow'` 返回 null 而 FAIL)。

- [ ] **Step 3: 实现 — 扩展类型与 resolveKind**

修改 `src/main/backend-task-registry.ts`:

类型部分(替换第 6-26 行 `BackendTask` 与事件接口):

```typescript
export type BackendTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
export type BackendTaskKind = 'subagent' | 'workflow' | 'shell' | 'monitor'

export interface BackendTask {
  id: string              // SDK task_id
  localSessionId: string
  command: string         // task_started 的 description || prompt
  taskType?: string       // SDK 原始 task_type
  kind: BackendTaskKind   // 归一化类型,驱动 UI 分区/图标
  subagentType?: string   // subagent 专属(如 general-purpose)
  status: BackendTaskStatus
  startedAt: number
  lastKnownAt: number
}

interface TaskStartedEvent {
  task_id: string
  description?: string
  prompt?: string
  task_type?: string
  subagent_type?: string
}
```

在 `BackendTaskRegistry` 类内、`handleTaskStarted` 之前加 `resolveKind` 私有方法:

```typescript
  /**
   * 归一化 task_type/subagent_type → BackendTaskKind。
   * 优先级:subagent_type 非空 > task_type 字面值。
   * 无法明确归类(均无)时返回 null,registry 不创建。
   *
   * task_type 值域(见 SDK BackgroundTaskSummary.type):
   * 'shell' | 'subagent' | 'monitor' | 'local_workflow'。
   * 历史版本也曾发过 'agent',按 subagent 兜底。
   */
  private resolveKind(event: TaskStartedEvent): BackendTaskKind | null {
    if (event.subagent_type) return 'subagent'
    switch (event.task_type) {
      case 'subagent':
      case 'agent':          return 'subagent'   // 'agent' 历史值兜底
      case 'local_workflow': return 'workflow'
      case 'shell':          return 'shell'
      case 'monitor':        return 'monitor'
      default:               return null          // 未知不创建
    }
  }
```

- [ ] **Step 4: 实现 — 放宽 handleTaskStarted**

替换 `handleTaskStarted` 方法体(原 `if (event.task_type !== 'local_workflow') return null` 改为按 resolveKind):

```typescript
  handleTaskStarted(localSessionId: string, event: TaskStartedEvent): BackendTask | null {
    const kind = this.resolveKind(event)
    if (!kind) return null

    // 重复 task_id → 返回已存在的记录,不覆盖
    const existing = this.tasks.get(event.task_id)
    if (existing) return existing

    const now = Date.now()
    const task: BackendTask = {
      id: event.task_id,
      localSessionId,
      command: event.description || event.prompt || '(后台任务)',
      taskType: event.task_type,
      kind,
      subagentType: event.subagent_type,
      status: 'running',
      startedAt: now,
      lastKnownAt: now,
    }
    this.tasks.set(task.id, task)
    return task
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run tests/backend-task-registry.test.ts`
Expected: 全部 PASS(含新增 4 条 + 原有所有条)。注意:原有 `task_started 非 local_workflow 的 task_type 不创建` 测试用 `task_type: 'tool'` 仍返回 null(resolveKind 返回 null),保持通过。

- [ ] **Step 6: Commit**

```bash
git add src/main/backend-task-registry.ts tests/backend-task-registry.test.ts
git commit -m "feat(registry): BackendTask 加 kind/subagentType + resolveKind 归类"
```

---

### Task 3: claude-service 放宽 task_started 入注册表条件

**Files:**
- Modify: `src/main/claude-service.ts:394-406`(handleTaskStartedEvent)
- Test: `tests/forward-event-identity.test.ts`

- [ ] **Step 1: 写失败测试 — subagent task_started 走 claude:backend-task**

在 `tests/forward-event-identity.test.ts` 的 `describe('forwardEvent 能力识别', ...)` 内追加:

```typescript
  it('system.subtype=task_started (subagent) → claude:backend-task create, kind=subagent', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-sub1', task_type: 'subagent', subagent_type: 'general-purpose',
      description: '审查代码', uuid: 'u10', session_id: 's1',
    }, wc)

    const created = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'create')
    expect(created.length).toBe(1)
    expect(created[0].data.task.kind).toBe('subagent')
    expect(created[0].data.task.subagentType).toBe('general-purpose')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/forward-event-identity.test.ts`
Expected: 新测试 FAIL(subagent 因 `task_type !== 'local_workflow'` 走 else 分支推 `claude:task`,不发 backend-task create)。

- [ ] **Step 3: 实现 — 放宽 handleTaskStartedEvent**

修改 `src/main/claude-service.ts:394-406` 的 `handleTaskStartedEvent`,把"只有 local_workflow 进 registry"改为"所有 task_started 都委托 registry,registry 内部 resolveKind 决定是否创建":

```typescript
  /** system.subtype='task_started':委托 registry(内部 resolveKind 决定是否创建)。
   *  registry 返回 null(未知 task_type)时,事件被丢弃——不回退到 claude:task,
   *  因为 task_started 只对长生命周期任务发出,无对应 kind 的属噪声。 */
  private handleTaskStartedEvent(tm: any, lsid: string, webContents: WebContents): void {
    if (!this.registry) return
    const t = this.registry.handleTaskStarted(lsid, {
      task_id: tm.task_id,
      description: tm.description ?? '',
      prompt: tm.prompt ?? '',
      task_type: tm.task_type,
      subagent_type: tm.subagent_type,
    })
    if (t) {
      webContents.send('claude:backend-task', { localSessionId: lsid, op: 'create', task: t })
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/forward-event-identity.test.ts`
Expected: 新增 subagent 测试 PASS。注意:原 `system.subtype=task_started (普通 task) → claude:task kind=started`(task_type='agent')此时会 FAIL——这正是要更新的旧断言,留到 Task 7 统一处理;本步先确认新测试通过、其余既有测试中除该条外仍通过。

- [ ] **Step 5: Commit**

```bash
git add src/main/claude-service.ts tests/forward-event-identity.test.ts
git commit -m "feat(service): task_started 全部委托 registry,subagent 走 backend-task"
```

---

### Task 4: 渲染端类型对齐 + reducer state 扩展

**Files:**
- Modify: `src/renderer/types.ts:74-82`(BackendTask)
- Modify: `src/renderer/state/reducer.ts:39-42`(State) + `:569`(SET_PANEL_FOLD)
- Modify: `src/renderer/state/actions.ts:66-73`
- Modify: `src/renderer/state/store.tsx:34`
- Test: `tests/reducer-extra.test.ts`

- [ ] **Step 1: 写失败测试 — subagentOutputBySession + panelFold.subagentCard**

在 `tests/reducer-extra.test.ts` 末尾追加:

```typescript
import type { ContentBlock } from '../src/renderer/types'

describe('reducer: subagent output & panel fold', () => {
  it('APPEND_SUBAGENT_OUTPUT 按 toolUseId 累积子代理输出', () => {
    const block: ContentBlock = { type: 'text', text: '子代理说了一句话' }
    let state = reducer(initialState, {
      type: 'APPEND_SUBAGENT_OUTPUT', sessionId: 's1', toolUseId: 'tu1', block,
    })
    expect(state.subagentOutputBySession['s1']?.['tu1']).toEqual([block])

    const block2: ContentBlock = { type: 'text', text: '第二句' }
    state = reducer(state, {
      type: 'APPEND_SUBAGENT_OUTPUT', sessionId: 's1', toolUseId: 'tu1', block: block2,
    })
    expect(state.subagentOutputBySession['s1']?.['tu1']).toEqual([block, block2])
  })

  it('SET_PANEL_FOLD 支持 subagentCard', () => {
    const state = reducer(initialState, {
      type: 'SET_PANEL_FOLD', panel: 'subagentCard', folded: true,
    })
    expect(state.panelFold.subagentCard).toBe(true)
  })
})
```

注:`reducer` / `initialState` 的导入方式与该文件顶部已有的导入保持一致(查看文件开头既有 `import { reducer } from ...` 等)。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/reducer-extra.test.ts`
Expected: FAIL(`APPEND_SUBAGENT_OUTPUT` action 未定义、`subagentOutputBySession` / `panelFold.subagentCard` 不存在、TS 编译报错)。

- [ ] **Step 3: 实现 — types.ts 对齐字段**

修改 `src/renderer/types.ts` 的 `BackendTask`(约 74-82 行),加 `kind` 与 `subagentType`:

```typescript
export type BackendTaskKind = 'subagent' | 'workflow' | 'shell' | 'monitor'

export type BackendTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
export interface BackendTask {
  id: string
  localSessionId: string
  command: string
  taskType?: string
  kind: BackendTaskKind
  subagentType?: string
  status: BackendTaskStatus
  startedAt: number
  lastKnownAt: number
}
```

- [ ] **Step 4: 实现 — actions.ts 扩 action 类型**

修改 `src/renderer/state/actions.ts`:

在 `SET_PANEL_FOLD` 行(73 行)把 panel 联合类型加 `'subagentCard'`:

```typescript
  | { type: 'SET_PANEL_FOLD'; panel: 'root' | 'taskCard' | 'subagentCard' | 'backendTaskCard'; folded: boolean }
```

并在 backend-task 相关 action 附近(66-69 行后)追加新 action:

```typescript
  | { type: 'APPEND_SUBAGENT_OUTPUT'; sessionId: string; toolUseId: string; block: import('../types').ContentBlock }
```

- [ ] **Step 5: 实现 — reducer.ts 扩 State 与 case**

修改 `src/renderer/state/reducer.ts`:

State 接口(39-42 行附近),`panelFold` 行后加 `subagentOutputBySession`:

```typescript
  // 右上角 Panel 折叠状态(四层独立)
  panelFold: { root: boolean; taskCard: boolean; subagentCard: boolean; backendTaskCard: boolean }
  // 子代理对话输出:按会话 + 触发它的 Task tool_use id 索引,累积 ContentBlock[]
  subagentOutputBySession: Record<string, Record<string, import('../types').ContentBlock[]>>
```

`SET_PANEL_FOLD` case(569 行)无需改逻辑(已用 `[action.panel]` 索引),但确保 `panelFold` 类型变更后 TS 通过。

在该 case 之前或之后追加新 case(位置紧跟 backend-task 相关 case 之后):

```typescript
    case 'APPEND_SUBAGENT_OUTPUT': {
      const bySession = state.subagentOutputBySession[action.sessionId] ?? {}
      const existing = bySession[action.toolUseId] ?? []
      return {
        ...state,
        subagentOutputBySession: {
          ...state.subagentOutputBySession,
          [action.sessionId]: {
            ...bySession,
            [action.toolUseId]: [...existing, action.block],
          },
        },
      }
    }
```

- [ ] **Step 6: 实现 — store.tsx 初始 state**

修改 `src/renderer/state/store.tsx:34` 的 `panelFold` 与其后,加 `subagentOutputBySession`:

```typescript
    panelFold: { root: false, taskCard: false, subagentCard: false, backendTaskCard: false },
    subagentOutputBySession: {},
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm vitest run tests/reducer-extra.test.ts`
Expected: 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/types.ts src/renderer/state/reducer.ts src/renderer/state/actions.ts src/renderer/state/store.tsx tests/reducer-extra.test.ts
git commit -m "feat(state): subagentOutputBySession + panelFold.subagentCard + ContentBlock 追加"
```

---

### Task 5: 主进程 assistant 分流 subagent_type + 新 IPC 通道

**Files:**
- Modify: `src/main/claude-service.ts:306-330`(case 'assistant')
- Modify: `src/preload/index.ts:13-24`(claude API + removeAllListeners 列表)
- Modify: `src/renderer/components/ChatArea.tsx`(onSubagentOutput 监听)

- [ ] **Step 1: 实现 — preload 暴露 onSubagentOutput**

修改 `src/preload/index.ts`,在 `onPlan` 行(约 16 行)后加:

```typescript
    onSubagentOutput: (cb: (data: any) => void) => { ipcRenderer.on('claude:subagent-output', (_, data) => cb(data)) },
```

并把 `removeAllListeners` 的通道数组(22 行)追加 `'claude:subagent-output'`:

```typescript
      ['claude:system', 'claude:delta', 'claude:blocks', 'claude:notice', 'claude:task', 'claude:result', 'claude:error', 'claude:aborted', 'claude:dialog-request', 'claude:backend-task', 'claude:builtin-result', 'claude:plan', 'claude:subagent-output']
```

- [ ] **Step 2: 实现 — claude-service assistant 分流**

修改 `src/main/claude-service.ts` 的 `case 'assistant'`(306-330 行)。在该 case 开头 `const aContent = message.message?.content || []` 之后、AskUserQuestion 拦截之前,插入 subagent 分流:

```typescript
        // subagent 自己产生的消息(SDKAssistantMessage 带 subagent_type):
        // 不推主流 assistant_blocks,改推 claude:subagent-output,锚回触发它的 Task tool_use。
        if (message.subagent_type) {
          const parentToolUseId = message.parent_tool_use_id
          if (parentToolUseId) {
            webContents.send('claude:subagent-output', {
              localSessionId: lsid,
              toolUseId: parentToolUseId,
              subagentType: message.subagent_type,
              taskDescription: message.task_description,
              block: normalizeBetaBlocks(aContent),
            })
          }
          // subagent 消息不再进入主流 assistant_blocks,避免对话流重复/混乱
          webContents.send('claude:blocks', { localSessionId: lsid, op: 'assistant_blocks', blocks: [], uuid: message.uuid })
          break
        }
```

注意:`normalizeBetaBlocks` 已在文件顶部 import(line 13)。`message.parent_tool_use_id` 是 `SDKAssistantMessage` 的既有字段。

- [ ] **Step 3: 实现 — ChatArea 接 subagent-output 监听**

在 `src/renderer/components/ChatArea.tsx` 的 IPC 监听 useEffect 内(紧挨 `api.onTask`/`onBackendTask` 注册处),追加:

```typescript
    api.onSubagentOutput((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      const blocks = Array.isArray(data.block) ? data.block : []
      for (const b of blocks) {
        dispatch({ type: 'APPEND_SUBAGENT_OUTPUT', sessionId: sid, toolUseId: data.toolUseId, block: b })
      }
    })
```

- [ ] **Step 4: 构建确认无 TS 错误**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/main/claude-service.ts src/renderer/components/ChatArea.tsx
git commit -m "feat(ipc): assistant 分流 subagent_type → claude:subagent-output 通道"
```

---

### Task 6: 新增 SubagentCard 组件

**Files:**
- Create: `src/renderer/components/SubagentCard.tsx`

- [ ] **Step 1: 创建 SubagentCard 组件**

复用 `BackendTaskCard` 的骨架(圆角浮层 + 折叠头 + 列表),创建 `src/renderer/components/SubagentCard.tsx`:

```typescript
// 子代理卡片:显示当前会话的 subagent(Task 工具 spawn)列表,嵌入 BackendTaskPanel。
import { Bot, Loader2, Square, X, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { BackendTask } from '../types'
import { formatSessionTime } from '../utils/formatSessionTime'

const STATUS_LABEL: Record<BackendTask['status'], string> = {
  running: '运行中', completed: '已完成', failed: '已退出', stopped: '已终止',
}

function StatusIcon({ status }: { status: BackendTask['status'] }) {
  const common = { size: 13, style: { flexShrink: 0, marginTop: 1 } }
  switch (status) {
    case 'running': return <Loader2 {...common} style={{ ...common.style, color: 'var(--accent)' }} />
    case 'completed': return <CheckCircle2 {...common} style={{ ...common.style, color: '#34c759' }} />
    case 'failed': return <AlertCircle {...common} style={{ ...common.style, color: '#ff3b30' }} />
    case 'stopped': return <Square {...common} style={{ ...common.style, color: 'var(--text-muted)' }} />
  }
}

interface Props {
  tasks: BackendTask[]
  folded: boolean
  onToggleFold: () => void
  onKill: (taskId: string) => void
  onRemove: (taskId: string) => void
  onClearFinished: () => void
  onClickTask?: (taskId: string) => void
}

export function SubagentCard({ tasks, folded, onToggleFold, onKill, onRemove, onClearFinished, onClickTask }: Props) {
  if (tasks.length === 0) return null
  const runningTasks = tasks.filter(t => t.status === 'running')
  const finishedTasks = tasks.filter(t => t.status !== 'running')
  const doneCount = finishedTasks.filter(t => t.status === 'completed').length

  return (
    <div style={{
      background: 'var(--surface-1)',
      borderRadius: 10, boxShadow: 'var(--shadow-float)', fontSize: 12, overflow: 'hidden',
    }}>
      <button onClick={onToggleFold} style={{
        width: '100%', padding: '8px 12px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--text)', fontWeight: 600,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Bot size={13} /> 子代理
        </span>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>
          {runningTasks.length} 运行 · {doneCount} 完成 · 共 {tasks.length}
        </span>
      </button>
      <div style={{
        maxHeight: folded ? 0 : 600,
        opacity: folded ? 0 : 1,
        overflow: 'hidden',
        transition: 'max-height .2s ease, opacity .15s ease',
      }}>
        <div style={{ padding: 4, borderTop: '1px solid var(--border-hair)' }}>
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
    </div>
  )
}

function SubagentRow({ t, onKill, onRemove, onClick }: {
  t: BackendTask
  onKill: (id: string) => void
  onRemove: (id: string) => void
  onClick?: (taskId: string) => void
}) {
  return (
    <div
      onClick={onClick ? () => onClick(t.id) : undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '6px 8px', borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <StatusIcon status={t.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: t.status === 'running' ? 'var(--text)' : 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {t.command}
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{STATUS_LABEL[t.status]}{t.startedAt ? ` · ${formatSessionTime(t.startedAt)}` : ''}</span>
          {t.subagentType && (
            <span style={{ background: 'var(--surface-2)', padding: '0 4px', borderRadius: 3 }}>{t.subagentType}</span>
          )}
        </div>
      </div>
      {t.status === 'running' ? (
        <button onClick={(e) => { e.stopPropagation(); onKill(t.id) }} title="终止" style={{
          padding: '2px 6px', color: 'var(--text-muted)', background: 'var(--surface-2)',
          border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
          display: 'inline-flex', alignItems: 'center',
        }}>
          <Square size={10} />
        </button>
      ) : (
        <button onClick={(e) => { e.stopPropagation(); onRemove(t.id) }} title="移除" style={{
          padding: '2px 4px', color: 'var(--text-muted)', background: 'none',
          border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
        }}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 构建确认无 TS 错误**

Run: `pnpm build`
Expected: 构建成功(组件暂未被引用,但编译通过)。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/SubagentCard.tsx
git commit -m "feat(ui): 新增 SubagentCard 子代理卡片组件"
```

---

### Task 7: BackendTaskPanel 三段式分区

**Files:**
- Modify: `src/renderer/components/BackendTaskPanel.tsx`(全文重构 Props 与渲染)
- Test: `tests/subagent-panel-render.test.tsx`(新增)

- [ ] **Step 1: 写失败测试 — 三段式面板渲染 subagent 区**

创建 `tests/subagent-panel-render.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BackendTaskPanel } from '../src/renderer/components/BackendTaskPanel'
import type { TaskItem, BackendTask } from '../src/renderer/types'
import type { ContentBlock } from '../src/renderer/types'

const noop = () => {}

function makeSubagent(over: Partial<BackendTask> = {}): BackendTask {
  return {
    id: 'sub-x', localSessionId: 's1', command: '审查 src', taskType: 'subagent',
    kind: 'subagent', subagentType: 'general-purpose', status: 'running',
    startedAt: 1000, lastKnownAt: 1000, ...over,
  }
}

describe('BackendTaskPanel 三段式', () => {
  it('有 subagent 时渲染「子代理」区', () => {
    render(
      <BackendTaskPanel
        tasks={[] as TaskItem[]}
        backendTasks={[makeSubagent()]}
        showTodo={true}
        showBackendTask={true}
        folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
        activeSessionId="s1"
        subagentOutputByToolUseId={{}}
        dispatch={noop}
      />
    )
    expect(screen.getByText('子代理')).toBeTruthy()
    expect(screen.getByText('审查 src')).toBeTruthy()
    expect(screen.getByText('general-purpose')).toBeTruthy()
  })

  it('只有 workflow 后台任务时渲染「后台任务」区,不渲染子代理区', () => {
    render(
      <BackendTaskPanel
        tasks={[] as TaskItem[]}
        backendTasks={[makeSubagent({ id: 'wf1', kind: 'workflow', taskType: 'local_workflow', command: 'pnpm dev', subagentType: undefined })]}
        showTodo={true}
        showBackendTask={true}
        folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
        activeSessionId="s1"
        subagentOutputByToolUseId={{}}
        dispatch={noop}
      />
    )
    expect(() => screen.getByText('子代理')).toThrow()
    expect(screen.getByText('后台任务')).toBeTruthy()
  })

  it('三区均空 → 返回 null(不挂载)', () => {
    const { container } = render(
      <BackendTaskPanel
        tasks={[] as TaskItem[]}
        backendTasks={[] as BackendTask[]}
        showTodo={true}
        showBackendTask={true}
        folded={{ root: false, taskCard: false, subagentCard: false, backendTaskCard: false }}
        activeSessionId="s1"
        subagentOutputByToolUseId={{}}
        dispatch={noop}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})
```

注:`@testing-library/react` 已在项目依赖中(见既有 `tests/answer-panel.test.tsx` 等用法);测试渲染环境配置参照既有 panel 测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/subagent-panel-render.test.tsx`
Expected: FAIL(`BackendTaskPanel` Props 还没 `subagentOutputByToolUseId`、folded 还没 `subagentCard`,TS 编译报错)。

- [ ] **Step 3: 实现 — BackendTaskPanel 三段式重构**

替换 `src/renderer/components/BackendTaskPanel.tsx` 全文:

```typescript
import { PanelRightOpen, PanelRightClose } from 'lucide-react'
import { TaskCard } from './TaskPanel'
import { BackendTaskCard } from './BackendTaskCard'
import { SubagentCard } from './SubagentCard'
import type { TaskItem, BackendTask, ContentBlock } from '../types'

interface FoldState { root: boolean; taskCard: boolean; subagentCard: boolean; backendTaskCard: boolean }

interface Props {
  tasks: TaskItem[]
  backendTasks: BackendTask[]
  showTodo: boolean
  showBackendTask: boolean
  folded: FoldState
  activeSessionId: string
  subagentOutputByToolUseId: Record<string, ContentBlock[]>
  dispatch: (action: any) => void
}

export function BackendTaskPanel({
  tasks, backendTasks, showTodo, showBackendTask, folded, activeSessionId, subagentOutputByToolUseId, dispatch,
}: Props) {
  const subagents = backendTasks.filter(t => t.kind === 'subagent')
  const backends = backendTasks.filter(t => t.kind !== 'subagent')
  const taskVisible = showTodo && tasks.length > 0
  const subagentVisible = showBackendTask && subagents.length > 0
  const bgVisible = showBackendTask && backends.length > 0
  if (!taskVisible && !subagentVisible && !bgVisible) return null

  // 折叠态:单个圆形小图标
  if (folded.root) {
    return (
      <div style={{ position: 'absolute', top: 12, right: 16, zIndex: 50 }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: false })}
          title="展开面板" aria-label="展开面板"
          style={{
            width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-1)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)',
            boxShadow: 'var(--shadow-float)',
          }}>
          <PanelRightOpen size={15} />
        </button>
      </div>
    )
  }

  return (
    <div style={{
      position: 'absolute', top: 12, right: 16, zIndex: 50,
      width: 280, maxHeight: 480, overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'root', folded: true })}
          title="收起面板" aria-label="收起面板"
          style={{
            width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-1)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)',
          }}>
          <PanelRightClose size={14} />
        </button>
      </div>
      {taskVisible && (
        <TaskCard tasks={tasks} folded={folded.taskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'taskCard', folded: !folded.taskCard })} />
      )}
      {subagentVisible && (
        <SubagentCard
          tasks={subagents}
          folded={folded.subagentCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'subagentCard', folded: !folded.subagentCard })}
          onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }}
          onRemove={(taskId) => dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId })}
          onClearFinished={() => dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })}
        />
      )}
      {bgVisible && (
        <BackendTaskCard
          tasks={backends}
          folded={folded.backendTaskCard}
          onToggleFold={() => dispatch({ type: 'SET_PANEL_FOLD', panel: 'backendTaskCard', folded: !folded.backendTaskCard })}
          onKill={(taskId) => { void window.api.backendTask.kill(activeSessionId, taskId) }}
          onRemove={(taskId) => dispatch({ type: 'REMOVE_BACKEND_TASK', sessionId: activeSessionId, taskId })}
          onClearFinished={() => dispatch({ type: 'CLEAR_FINISHED_BACKEND_TASKS', sessionId: activeSessionId })}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: 实现 — ChatArea 传入新 Props**

修改 `src/renderer/components/ChatArea.tsx:239-247` 的 `<BackendTaskPanel>` 调用,加 `subagentOutputByToolUseId`:

```typescript
      <BackendTaskPanel
        tasks={state.tasksBySession[state.activeSessionId] ?? []}
        backendTasks={state.backendTasksBySession[state.activeSessionId] ?? []}
        showTodo={state.settings.showTodo}
        showBackendTask={state.settings.showBackendTask}
        folded={state.panelFold}
        activeSessionId={state.activeSessionId}
        subagentOutputByToolUseId={state.subagentOutputBySession[state.activeSessionId] ?? {}}
        dispatch={dispatch}
      />
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run tests/subagent-panel-render.test.tsx`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/BackendTaskPanel.tsx src/renderer/components/ChatArea.tsx tests/subagent-panel-render.test.tsx
git commit -m "feat(ui): BackendTaskPanel 三段式(任务/子代理/后台任务)分区"
```

---

### Task 8: ToolUseCard 挂载子代理输出折叠区(对话流分离 C)

**Files:**
- Modify: `src/renderer/components/blocks/ToolUseCard.tsx`
- Modify: `src/renderer/components/blocks/BlockRenderer.tsx`(透传 subagentOutput)

- [ ] **Step 1: 实现 — ToolUseCard 接收并渲染子代理输出区**

修改 `src/renderer/components/blocks/ToolUseCard.tsx`,扩展 Props 加 `subagentBlocks?`:

把 `interface Props` 改为:

```typescript
interface Props {
  block: {
    type: 'tool_use'
    id: string
    name: string
    input: any
    status: string
    result?: { content: string; isError: boolean }
  }
  inGroup?: boolean
  // 该 Task tool_use 触发的 subagent 的累积输出(来自 subagentOutputByToolUseId[block.id])
  subagentBlocks?: import('../../types').ContentBlock[]
}
```

组件签名改为 `export function ToolUseCard({ block, inGroup, subagentBlocks }: Props)`。在组件返回的 `<details>` 内、结果渲染之后,追加子代理输出折叠区(仅当 `block.name === 'Task'` 且 `subagentBlocks?.length` 时渲染):

```typescript
      {block.name === 'Task' && subagentBlocks && subagentBlocks.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid var(--border-hair)', paddingTop: 6 }}>
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, userSelect: 'none' }}>
              子代理输出 · {subagentBlocks.length} 条
            </summary>
            <div style={{ marginTop: 4 }}>
              {subagentBlocks.map((b, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 0' }}>
                  {b.type === 'text' ? b.text
                    : b.type === 'thinking' ? `(思考) ${b.text}`
                    : b.type === 'tool_use' ? `[工具] ${b.name}`
                    : b.type === 'tool_result' ? `[结果] ${(b.content ?? '').slice(0, 80)}`
                    : ''}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
```

(用 `import('../../types')` 避免循环依赖;`ContentBlock` 的联合分支已在 types.ts 定义。)

- [ ] **Step 2: 实现 — BlockRenderer 透传 subagentBlocks**

修改 `src/renderer/components/blocks/BlockRenderer.tsx`,给 `renderBlocks` 加可选参数 `subagentOutputByToolUseId`,透给 `ToolUseCard`。

定位 `renderBlocks` 函数签名,改为:

```typescript
export function renderBlocks(
  blocks: any[],
  subagentOutputByToolUseId?: Record<string, import('../types').ContentBlock[]>,
): React.ReactNode {
```

定位 `case 'tool_use': return <ToolUseCard block={block} />`(约 15 行),改为:

```typescript
    case 'tool_use':
      return <ToolUseCard block={block} subagentBlocks={subagentOutputByToolUseId?.[block.id]} />
```

然后在所有调用 `renderBlocks(...)` 的渲染端(对话流消息渲染处)传入 `state.subagentOutputBySession[sessionId]`。定位 `renderBlocks(` 的调用点(用 `rg "renderBlocks\(" src/renderer`),逐一加第二参数。例如若调用形如 `renderBlocks(msg.content)`,改为 `renderBlocks(msg.content, subagentOutputByToolUseId)`,其中 `subagentOutputByToolUseId` 从上层 props/state 取当前会话的 map。

- [ ] **Step 3: 构建确认无 TS 错误**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/blocks/ToolUseCard.tsx src/renderer/components/blocks/BlockRenderer.tsx
git commit -m "feat(ui): Task 工具卡片挂载子代理输出折叠区(对话流分离)"
```

---

### Task 9: 更新旧测试断言 + 全量回归

**Files:**
- Modify: `tests/forward-event-identity.test.ts:47-80`(两条旧断言)
- Verify: `tests/backend-task-registry.test.ts`(无 task_type='tool' 等回归)

- [ ] **Step 1: 更新 forward-event-identity 的旧 subagent 断言**

修改 `tests/forward-event-identity.test.ts`:

把原 `it('system.subtype=task_started (普通 task) → claude:task kind=started', ...)`(47-61 行,task_type='agent')改为反映新行为——subagent 走 backend-task:

```typescript
  it('system.subtype=task_started (subagent, task_type=agent) → claude:backend-task create', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-task1', task_type: 'agent', subagent_type: 'general-purpose',
      description: '搜索代码', uuid: 'u2', session_id: 's1',
    }, wc)

    const created = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'create')
    expect(created.length).toBe(1)
    expect(created[0].data.task.kind).toBe('subagent')
  })
```

把原 `it('system.subtype=task_notification → claude:task kind=updated（普通 task 终态）', ...)`(63-80 行)改为:subagent 已注册后,notification 走 backend-task update:

```typescript
  it('system.subtype=task_notification (已注册 subagent) → claude:backend-task update', () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    const { wc, calls } = mockWebContents()
    // 先 started 注册 subagent
    fwd(svc, {
      type: 'system', subtype: 'task_started',
      task_id: 't-task2', task_type: 'subagent', subagent_type: 'general-purpose',
      description: 'x', uuid: 'u3', session_id: 's1',
    }, wc)
    calls.length = 0
    // 再 notification
    fwd(svc, {
      type: 'system', subtype: 'task_notification',
      task_id: 't-task2', status: 'completed', uuid: 'u4', session_id: 's1',
    }, wc)

    const updated = calls.filter(c => c.channel === 'claude:backend-task' && c.data?.op === 'update')
    expect(updated.length).toBe(1)
    expect(updated[0].data.task.status).toBe('completed')
  })
```

- [ ] **Step 2: 运行 forward-event-identity 全部测试**

Run: `pnpm vitest run tests/forward-event-identity.test.ts`
Expected: 全部 PASS。

- [ ] **Step 3: 运行 backend-task-registry 测试确认无回归**

Run: `pnpm vitest run tests/backend-task-registry.test.ts`
Expected: 全部 PASS。`task_type='tool'` 和"无 task_type"用例因 resolveKind 返回 null 仍返回 null,语义保持。

- [ ] **Step 4: 运行全量单元测试**

Run: `pnpm test`
Expected: 全部 PASS(无失败)。

- [ ] **Step 5: Commit**

```bash
git add tests/forward-event-identity.test.ts
git commit -m "test: 更新 task_* 识别断言为 subagent 走 backend-task 通道的新行为"
```

---

### Task 10: 移除临时调试日志 + 真机 e2e 验证

**Files:**
- Modify: `src/main/claude-service.ts`(移除 Task 1 的 console.log)
- Verify: `tests/e2e-real-model.test.ts`

- [ ] **Step 1: 移除 Task 1 加的调试日志**

删除 `src/main/claude-service.ts` case 'system' 内 Task 1 插入的 `[cc-desk][debug] task event` console.log 块。

- [ ] **Step 2: 构建确认**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 3: 真机 e2e 验证(条件执行)**

Run: `pnpm test:e2e`(依赖真机模型可用,见 `tests/e2e-real-model.test.ts` 的 `RUN` 守卫)。
手动验证:发起一个会触发 subagent 的对话(如"用 Task 工具并行跑两个子代理"),观察:
- 右上角面板出现,「子代理」区显示,计数正确。
- 主对话流里 Task 工具卡片出现,点开有「子代理输出」折叠区。
- 子代理完成后面板状态更新为已完成。

若真机无法触发 subagent(第三方代理不支持 Task 工具),跳过自动 e2e,在文档/spec 标注"subagent 能力依赖模型/代理支持 Task 工具",依赖 Task 2/3/7 的单元测试兜底。

- [ ] **Step 4: Commit**

```bash
git add src/main/claude-service.ts
git commit -m "chore: 移除 subagent 识别临时调试日志"
```

---

## 完成标准

- `pnpm test` 全绿(含新增 registry/reducer/panel 测试 + 更新后的 forward-event 测试)。
- `pnpm build` 成功。
- 真机或单元测试验证:subagent 触发后面板出现三段式布局,子代理输出从主对话流折叠分离。
- 无残留临时调试日志。
