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
**shellId/pid 探活路线（小工程）**：cc-desk 不接管命令执行，而是从 SDK 流事件里提取后台 shell 的身份标识（shellId/pid），据此探活与终止。

> **不采用 MCP 自定义 Bash（内置终端）路线**：该路线能力最强（一次性解决退出感知/PID/终止/未来输出），但需在 cc-desk 内实现完整 Bash 工具替代品，工程量最大。本设计暂不采用，作为未来升级方向保留。

## 最大风险：SDK 是否暴露 shellId/pid（前置 gate）

整个"可控 + 退出感知"能力的可行性，押在一个未验证的事实上：

> Claude Agent SDK v0.3.178 的流事件 / tool_result 里，到底有没有把后台 shell 的 `bash_id`（shellId）或 `pid` 暴露出来？

从现有 `claude-service.ts` 看，代码只处理了 `tool_use_start`（含 `input.command` / `input.run_in_background`）和 `tool_result`，**没有任何地方提取 shellId/pid**——但这不代表 SDK 不给，只代表现有代码没用。

**因此，实现的第一步必须是验证实验**（见实现计划），其结果决定后续方案分叉：

### 分支 A：SDK 暴露了 shellId/pid

- 探活：主进程存 pid，定时（建议 5s）`process.kill(pid, 0)` 探活，失败即标记"已退出"。
- 终止：`process.kill(pid)` 直接杀。
- 完整能力成立。

### 分支 B：SDK 不暴露 shellId/pid（接受退化）

- 探活：做不了，没有进程身份，盲区无法消除。
- 终止：做不了，找不到进程。
- **退化范围**：第一版只做**纯展示**——显示 Claude 已知的命令 + 上次输出片段，状态永远停在"运行中（最后已知）"，直到 Claude 主动调 KillShell 才更新为"已终止"。
- 用户已同意此退化。

## 架构与数据流

### 新增主进程模块 `src/main/backend-task-registry.ts`

与 `pty-manager.ts` 同层，职责单一：维护 Claude 后台任务的生命周期。内部 `Map<taskId, BackendTask>`。

```typescript
interface BackendTask {
  // 任务主键：localSessionId + Bash toolUseId（tool_use_start 一定带 block.id）
  id: string
  localSessionId: string
  command: string       // input.command
  cwd?: string          // 当时 SDK 的 cwd
  shellId?: string      // 从 tool_result 提取；拿不到则 undefined（分支 B 标志）
  pid?: number          // 若能从 shellId 解析出 pid 则存
  status: 'running' | 'killed' | 'exited' | 'unknown'
  outputSnippets: string[]  // BashOutput tool_result 经过的片段，append
  startedAt: number
  lastKnownAt: number   // 最后一次状态更新时间
}
```

### 数据流

```
SDK query() 流
   │
   ▼
claude-service.ts（扩展）──► 识别三类 tool 事件：
   │                          • Bash 且 input.run_in_background === true → CREATE
   │                          • BashOutput                                      → APPEND 输出
   │                          • KillShell                                       → MARK_KILLED
   │
   ▼  webContents.send('claude:backend-task', { op, localSessionId, ... })

backend-task-registry.ts ──存──► Map<taskId, BackendTask>
   │
   ▼  新增 IPC
   • 'backend-task:list'   → 渲染端拉取当前列表（按 localSessionId 过滤）
   • 'backend-task:kill'   → 渲染端请求终止（id）

preload 暴露 window.api.backendTask.{ list, kill, onEvent }
   │
   ▼
渲染端 store ──► BackendTaskPanel.tsx（右上角悬浮 Panel）
```

### 工具事件识别细节

| SDK 事件 | 判断条件 | 动作 |
|---|---|---|
| `stream_event` / `tool_use_start`，block.name === 'Bash' | `input.run_in_background === true` | CREATE 任务，主键 = localSessionId + block.id |
| `user` / `tool_result`，对应 Bash 工具 | 提取返回体里的 `bash_id`（若 SDK 给） | 存 shellId，进入分支 A |
| `tool_use_start`，block.name === 'BashOutput' | —— | 取 `input.shell_id` 关联任务，把 result stdout 片段 append |
| `tool_use_start`，block.name === 'KillShell' | —— | MARK_KILLED 对应任务 |

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
| SDK 不暴露 shellId/pid（分支 B） | 隐藏终止按钮，状态停"运行中（最后已知）"，纯展示 |
| 探活时进程已不存在（分支 A） | 标记 `exited`，状态显示"已退出" |
| 终止失败（kill 抛错） | 状态回退，面板提示"终止失败"，不静默吞错 |
| KillShell 工具调用未关联到任何已知任务 | 忽略，记日志 |
| 多个后台任务命令文本相同 | 用 toolUseId 主键区分，不靠命令文本关联 |
| 会话切换 | 任务数据按 localSessionId 隔离，不串台（与现有 Claude 流隔离逻辑一致） |

## 测试策略

- **纯函数层**（vitest，无 Electron 依赖）：
  - 工具事件识别：给定 mock 的 stream_event / tool_result，断言 registry 正确 CREATE / APPEND / MARK_KILLED。
  - 状态机：running → killed / exited / unknown 的转换。
  - 会话隔离：不同 localSessionId 的任务互不干扰。
- **探活逻辑**（分支 A）：mock `process.kill`，断言探活失败标记 exited。
- **UI 层**（@testing-library/react）：
  - Panel 三层折叠：各层独立展开/收起。
  - 显示规则：两 Card 空 → 不渲染 Panel；单 Card 有内容 → 只显该 Card。
  - 任务列表渲染 + 终止按钮点击触发 `backend-task:kill`。
  - 状态文案：分支 A/B 下分别正确标注。
- **前置验证实验**（非自动化测试，手工跑一次）：独立脚本调 `query()` 起一个后台 Bash，dump 所有流事件，确认 SDK 是否暴露 shellId/pid。结果记录到 spec，决定走分支 A 还是 B。

## 实现顺序（概要，详见后续 writing-plans）

1. **前置验证实验**——跑脚本确认 SDK 暴露什么，记录结果，定分支。
2. `backend-task-registry.ts` 主进程模块 + 工具事件识别。
3. `claude-service.ts` 扩展转发 `claude:backend-task` 事件。
4. preload 暴露 + IPC（list / kill）。
5. 渲染端 store + `BackendTaskPanel` 容器 + 改造 `TaskPanel` 为 Card。
6. 分支 A 专属：探活定时器 + 终止实现。
7. 测试。

## 未来方向（不在本设计范围）

- MCP 自定义 Bash（内置终端）路线：cc-desk 起 MCP server 暴露自定义 bash 工具，禁用 SDK 内置 Bash，命令全走 cc-desk PTY。一次性解决退出感知/PID/终止，并解锁实时输出与反馈。工程量大，作为本特性验证后的升级选项保留。
- 实时输出流与"反馈给 Claude"闭环：依赖内置终端或 shellId 输出接管，本设计不做。
