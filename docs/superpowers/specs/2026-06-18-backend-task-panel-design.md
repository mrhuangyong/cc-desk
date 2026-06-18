# 右上角后台任务面板设计

日期：2026-06-18
状态：设计稿（待评审）

## 背景与问题

cc-desk 中 Claude 通过 Claude Agent SDK 的 `query()` 执行命令（`src/main/claude-service.ts`）。当 Claude 用 Bash 工具的 `run_in_background: true` 起长进程（如 `pnpm dev`）时，进程在 SDK 内部的 Bash 工具实现里 spawn 并持久保持——SDK 本身是支持的，进程不会因命令结束而消失。

但存在两个缺口：

1. **不可观测**：cc-desk 前端完全感知不到 Claude 起了哪些后台进程。`claude-service.ts` 只把 `tool_use_start` / `tool_result` 等流事件转发出去，没有任何渠道告诉渲染端"现在有个 `pnpm dev` 在后台跑"。
2. **不可控**：用户无法从 UI 终止 Claude 起的后台进程，也看不到它是否已崩溃/退出。

本设计新增一个右上角悬浮面板，把 Claude 起的后台进程展示出来，并支持终止与退出感知。

## 范围

### 进程来源
**只抓 Claude 起的后台进程**——即 SDK Bash 工具 `run_in_background: true` 的命令。不包含用户在 TerminalTab（PtyManager）里手动跑的进程，也不做独立通用后台任务子系统。

### 能力边界
**只读 + 可控**：

- 展示：后台任务的命令、cwd、状态、Claude 已知输出片段
- 终止：用户在 UI 点"终止"，cc-desk 直接杀进程
- 退出感知：进程崩溃/正常退出时面板能更新状态

**明确不做**：

- 不做实时输出流（不轮询读取进程持续输出）
- 不做"反馈给 Claude"——经讨论，反馈依赖实时输出，与"不要实时"矛盾，砍掉

### 终止机制路线
**backgroundTaskId 驱动（小工程）**：cc-desk 不接管命令执行，而是从 SDK 流事件里提取后台任务的稳定标识 `backgroundTaskId`，据此探活与终止（调 `TaskOutput` 探活、`TaskStop` 终止——具体可行性见前置 gate 实验结果）。

> **不采用 MCP 自定义 Bash（内置终端）路线**：该路线能力最强（一次性解决退出感知/PID/终止/未来输出），但需在 cc-desk 内实现完整 Bash 工具替代品，工程量最大。本设计暂不采用，作为未来升级方向保留。

## 最大风险：SDK 后台任务的实际机制（前置 gate）

整个"可控 + 退出感知"能力的可行性，押在 SDK 后台任务机制上。

### 已验证事实（SDK v0.3.178 类型定义）

读取 `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` 确认，SDK 已把"后台"概念收敛为统一 API，**不再是旧的 `Bash(run_in_background)` + `BashOutput` + `KillShell` 三件套**：

| 工具 | 作用 | 关键字段 |
|---|---|---|
| `Bash` | 普通同步命令执行（`run_in_background` 字段在 Bash 上已无后台语义） | `BashInput` |
| `Task`（Agent） | 起后台 agent，`run_in_background: true` | 返回 `backgroundTaskId` |
| `TaskOutput` | **主动读后台任务输出**（`task_id`, `block`, `timeout`）——实时输出的官方入口 | `TaskOutputInput` |
| `TaskStop` | **终止后台任务**（`task_id`，旧 `shell_id` 已废弃） | `TaskStopInput` |

`BashOutput` 接口含 `backgroundTaskId?: string`、`backgroundedByUser`、`assistantAutoBackgrounded`——说明 **`backgroundTaskId` 是跨工具的稳定字符串主键**，cc-desk 可直接用，不靠 toolUseId 凑，也不靠 `process.kill(pid,0)` 这种脆弱探活。

### 仍需实验确认的点（实现第一步）

1. **`backgroundTaskId` 在 tool_result 里的具体位置/JSON 结构**。现状 `claude-normalize.ts:extractToolResults` 把 tool_result.content 拍平成字符串，会吃掉结构化字段——需要 dump 一次真实 tool_result 确认 `backgroundTaskId` 是在 content 文本里、还是单独的 JSON 字段。
2. **cc-desk 能否直接调用 `TaskStop` / `TaskOutput`**。这些是 Claude 侧工具，cc-desk 自己调用路径未确认——可能要走 `claude` CLI 子命令，或只能在会话内由 Claude 代调。
3. **"探活"的可行实现**：理想是用 `TaskOutput(task_id, block:false, timeout:0)` 探"任务还活着吗"，但 cc-desk 能否独立调用同上未确认。

### 分支（按实验结果决定）

**分支 A：cc-desk 能拿到 backgroundTaskId 且能调用 TaskStop/TaskOutput**

- 标识：tool_result 提取 `backgroundTaskId` 作为稳定主键。
- 探活：定时（建议 5s）调 `TaskOutput(block:false, timeout:0)`，任务不存在/已结束即标记 `exited`。
- 终止：调 `TaskStop(task_id)`。
- 完整能力成立。

**分支 B：cc-desk 能拿到 backgroundTaskId，但无法独立调用 TaskStop/TaskOutput**

- 标识：仍能用 backgroundTaskId 做主键展示。
- 探活：做不了（无法独立查活）。
- 终止：做不了（无法独立杀）。
- **退化范围**：第一版纯展示——显示命令 + 上次已知输出片段，状态永远"运行中（最后已知）"，直到 Claude 主动调 TaskStop 才更新为"已终止"。用户已同意此退化。

**分支 C：tool_result 里根本没有 backgroundTaskId（结构不符预期）**

- 无法关联任务，整套特性无数据源。
- 整体搁置，待后续上 MCP 内置终端方案。

## 架构与数据流

### 新增主进程模块 `src/main/backend-task-registry.ts`

与 `pty-manager.ts` 同层，职责单一：维护 Claude 后台任务的生命周期。内部 `Map<taskId, BackendTask>`。

```typescript
interface BackendTask {
  // 任务主键：SDK 返回的 backgroundTaskId（稳定字符串）；拿到前用 localSessionId+toolUseId 临时占位
  id: string              // backgroundTaskId（实验确认前先以 toolUseId 作占位主键）
  localSessionId: string
  toolUseId: string       // 触发该后台任务的 tool_use.id，用于回填 backgroundTaskId
  command: string         // Task/Bash 的 input.command 或子 agent prompt
  cwd?: string            // 当时 SDK 的 cwd
  status: 'running' | 'killed' | 'exited' | 'unknown'
  outputSnippets: string[]  // TaskOutput tool_result 经过的片段，append
  startedAt: number
  lastKnownAt: number     // 最后一次状态更新时间
}
```

### 数据流

```
SDK query() 流
   │
   ▼
claude-service.ts（扩展）──► 识别工具事件：
   │                          • tool_use_start（Task / auto-backgrounded Bash）→ CREATE 占位任务（toolUseId）
   │                          • tool_result 含 backgroundTaskId            → 回填稳定 id
   │                          • tool_use_start（TaskOutput）               → 关联任务，append 输出片段
   │                          • tool_use_start（TaskStop）                  → MARK_KILLED
   │
   ▼  webContents.send('claude:backend-task', { op, localSessionId, ... })

backend-task-registry.ts ──存──► Map<taskId, BackendTask>
   │
   ▼  新增 IPC
   • 'backend-task:list'   → 渲染端拉取当前列表（按 localSessionId 过滤）
   • 'backend-task:kill'   → 渲染端请求终止（id）→ 调 TaskStop（分支 A）

preload 暴露 window.api.backendTask.{ list, kill, onEvent }
   │
   ▼
渲染端 store ──► BackendTaskPanel.tsx（右上角悬浮 Panel）
```

### 工具事件识别细节

| SDK 事件 | 判断条件 | 动作 |
|---|---|---|
| `stream_event` / `tool_use_start`，name === 'Task' | `input.run_in_background === true` | CREATE 占位任务，主键先用 localSessionId + block.id |
| `user` / `tool_result`（对应上述工具） | 从返回体提取 `backgroundTaskId` | 回填任务稳定 id |
| `stream_event`，name === 'Bash' 且 tool_result 含 `assistantAutoBackgrounded:true` 或 `backgroundTaskId` | —— | CREATE/回填（SDK 自动后台的长命令） |
| `tool_use_start`，name === 'TaskOutput' | 取 `input.task_id` 关联任务 | 把 result stdout 片段 append |
| `tool_use_start`，name === 'TaskStop' | 取 `input.task_id` | MARK_KILLED 对应任务 |

> **注意**：`extractToolResults`（claude-normalize.ts）当前把 tool_result.content 拍平成字符串，会吃掉结构化字段。提取 `backgroundTaskId` 需扩展该函数保留原始结构，或在 `claude-service.ts` 的 `user` 分支直接读未拍平的 content。具体落点由实验确认 backgroundTaskId 实际位置后定。

### 会话隔离
与现有 TaskPanel 一致，按 `activeSessionId` 过滤，切会话只看本会话起的后台任务。任务数据存 `state.backendTasksBySession`，与现有 `tasksBySession` 同构。

## UI 设计：右上角 Panel

### 结构
一个外层悬浮 Panel 容器，内部上下叠放两张 Card，整组是一个可折叠单元。

```
┌─ 右上角悬浮 Panel (整体可折叠) ────────────┐
│  [标题/折叠钮]                              │
│ ┌─ TaskCard (Claude 待办) ────────────────┐ │
│ │  ▸ 待办 (3 进行 · 2 完成)               │ │
│ │    • 任务A · 进行中                     │ │
│ └─────────────────────────────────────────┘ │
│           ↕ 间隔                             │
│ ┌─ BackendTaskCard (后台任务) ────────────┐ │
│ │  ▸ 后台任务 (1 运行)                    │ │
│ │    • pnpm dev · 运行中        [终止]    │ │
│ └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### 三层折叠状态，各自独立持久化

| 层级 | 控制项 | 状态 |
|---|---|---|
| Panel 整体 | Panel 折叠钮 | 展开 / 收起（收起后只剩窄条入口，点击恢复） |
| TaskCard | Card 标题行点击 | 展开（列任务）/ 折叠（只显统计） |
| BackendTaskCard | Card 标题行点击 | 展开（列进程）/ 折叠（只显统计） |

折叠状态走 `cc-desk-store` 持久化（与现有 store 一致）。

### 现状改造影响

现有 `TaskPanel.tsx` 是自包含悬浮组件、受 `state.settings.showTodo` 控制。改造后：

- 新增 `BackendTaskPanel` 容器组件，承载三层折叠逻辑。
- `TaskPanel` 降级为纯 Card 内容组件，放进容器。
- `showTodo` 语义从"显示整个面板"变为"显示 TaskCard"。
- 新增 `showBackendTask` 设置控制 BackendTaskCard。
- 两个开关都关 / 两张 Card 都无内容 → Panel 不显示。

### 显示规则

- 两张 Card 都空（无待办、无后台进程）→ Panel 整体不显示。
- 仅 TaskCard 有内容 → 只显示 TaskCard。
- 状态标注诚实：进程状态显示"运行中（最后已知）"而非"运行中"——因为不实时，进程可能已死但未被感知。分支 A 下探活确认退出后显示"已退出"；分支 B 下永远停在"运行中（最后已知）"直到 Claude 调 KillShell。

### 单条后台任务展示

- 命令（命令文本，省略号截断）
- 状态图标 + 状态文案
- 起始时间（相对时间，复用 `formatSessionTime`）
- "终止"按钮（分支 A 可用；分支 B 隐藏或置灰）
- 输出片段：最近 N 行 + "展开看全部"（数据来自 BashOutput 被动片段，无轮询）

## 错误处理

| 场景 | 处理 |
|---|---|
| SDK 拿不到 backgroundTaskId（分支 B/C） | 隐藏终止按钮，状态停"运行中（最后已知）"，纯展示 |
| 探活时任务已结束（分支 A） | TaskOutput 返回结束态 → 标记 `exited`，显示"已退出" |
| 终止失败（TaskStop 抛错） | 状态回退，面板提示"终止失败"，不静默吞错 |
| TaskStop / TaskOutput 工具调用未关联到任何已知任务 | 忽略，记日志 |
| 多个后台任务命令文本相同 | 用 backgroundTaskId（或 toolUseId）主键区分，不靠命令文本关联 |
| 会话切换 | 任务数据按 localSessionId 隔离，不串台（与现有 Claude 流隔离逻辑一致） |

## 测试策略

- **工具事件识别**：给定 mock 的 stream_event / tool_result，断言 registry 正确 CREATE（占位）→ 回填 backgroundTaskId → APPEND（TaskOutput）→ MARK_KILLED（TaskStop）。
- **状态机**：running → killed / exited / unknown 的转换。
- **会话隔离**：不同 localSessionId 的任务互不干扰。
- **探活逻辑**（分支 A）：mock TaskOutput，断言返回结束态时标记 exited。
- **UI 层**（@testing-library/react）：
  - Panel 三层折叠：各层独立展开/收起。
  - 显示规则：两 Card 空 → 不渲染 Panel；单 Card 有内容 → 只显该 Card。
  - 任务列表渲染 + 终止按钮点击触发 `backend-task:kill`。
  - 状态文案：分支 A/B 下分别正确标注。
- **前置验证实验**（非自动化测试，手工跑一次）：独立脚本调 `query()` 起一个后台 Task（如 "跑 sleep 60"，run_in_background:true），dump 所有流事件，确认：(1) backgroundTaskId 在 tool_result 的具体位置；(2) cc-desk 能否独立调 TaskStop/TaskOutput。结果记录到 spec，决定走分支 A/B/C。

## 实现顺序（概要，详见后续 writing-plans）

1. **前置验证实验**——跑脚本确认 backgroundTaskId 位置 + cc-desk 能否独立调 TaskStop/TaskOutput，记录结果，定分支。
2. `backend-task-registry.ts` 主进程模块 + 工具事件识别（CREATE/回填/APPEND/MARK_KILLED 纯函数）。
3. `claude-service.ts` 扩展转发 `claude:backend-task` 事件；`claude-normalize.ts` 扩展保留 backgroundTaskId。
4. preload 暴露 + IPC（list / kill）。
5. 渲染端 store + `BackendTaskPanel` 容器 + 改造 `TaskPanel` 为 Card。
6. 分支 A 专属：探活定时器（TaskOutput）+ 终止实现（TaskStop）。
7. 测试。

## 未来方向（不在本设计范围）

- MCP 自定义 Bash（内置终端）路线：cc-desk 起 MCP server 暴露自定义 bash 工具，禁用 SDK 内置 Bash，命令全走 cc-desk PTY。一次性解决退出感知/PID/终止，并解锁实时输出与反馈。工程量大，作为本特性验证后的升级选项保留。
- 实时输出流与"反馈给 Claude"闭环：依赖内置终端或 shellId 输出接管，本设计不做。
