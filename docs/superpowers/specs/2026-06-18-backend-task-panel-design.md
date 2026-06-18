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
**`Query.stopTask(taskId)` 驱动**：`query()` 返回的 `Query` 对象自带 `stopTask()` 方法，cc-desk 直接调用即可终止后台任务，零额外 SDK 探索成本。

### 退出感知
**`task_notification` 推送事件**：SDK 在任务完成/失败/被终止时主动推 `system(task_notification)` 事件，cc-desk 被动接收，无需轮询探活。

## Task 1 验证结论（2026-06-18，从 SDK v0.3.178 类型定义直接确认）

**所有 4 个待验证点均已确认，分支 A 成立，且架构比预期更简单。**

### 数据源：SDK `system` 事件（非 tool_result 解析）

| SDK 事件 | 字段 | 用途 |
|---|---|---|
| `system` / `task_started` | `task_id`, `description`, `prompt`, `task_type`, `subagent_type` | CREATE 任务（task_id 直接当主键） |
| `system` / `task_updated` | `task_id`, `patch: { status, ... }` | UPDATE 状态 |
| `system` / `task_notification` | `task_id`, `status: 'completed'\|'failed'\|'stopped'` | **任务结束感知**（原生推送，无需轮询探活） |

`task_id` 是稳定 UUID 字符串，跨所有事件一致。`task_type === 'local_workflow'` 用于区分为"后台进程"还是"Claude 内部待办"。

> 现状：`claude-service.ts` 已在处理 `task_started`（line 193）和 `task_updated`（line 205），转发为 `claude:task` 给 TaskPanel。**`task_notification` 被当作普通 notice 丢弃了**（line 216-217），而这正是退出感知的关键事件。

### 终止：`Query.stopTask(taskId)` 就在手上

`query()` 返回的 `Query` 对象（`sdk.d.ts:2242`）同时是 AsyncIterable 和有方法的对象：

```typescript
export declare interface Query extends AsyncGenerator<SDKMessage, void> {
    stopTask(taskId: string): Promise<void>;
    // ... 还有 interrupt(), setPermissionMode(), setModel(), background() 等
}
```

现状 `claude-service.ts:108` 的 `const stream = query({...})` 已经拿到了 `Query` 对象，**但 `stopTask()` 方法被白白丢弃了**。只需把 `stream` 存为字段引用，暴露一个 `stopTask(taskId)` wrapper。

### 无需轮询探活

`task_notification` 事件在任务完成/失败/被终止时由 SDK 主动推送，cc-desk 无需额外轮询。**原计划 Task 9（探活定时器）取消。**

### 分支结论：分支 A 确认成立，无退化

`backgroundTaskId` / 终止 / 退出感知三条路全部打通，**且实现路径比计划设想的更干净**——不需要从 tool_result JSON 解析、不需要额外 SDK 调用入口、不需要定时轮询。全部依赖 SDK 原生 API。

## 架构与数据流

### 新增主进程模块 `src/main/backend-task-registry.ts`

与 `pty-manager.ts` 同层，职责单一：维护 Claude 后台任务的生命周期。内部 `Map<taskId, BackendTask>`。

```typescript
interface BackendTask {
  // 任务主键：SDK system 事件的 task_id（稳定 UUID 字符串），task_started 直接提供
  id: string              // = SDK task_id
  localSessionId: string
  command: string         // task_started 的 description 或 prompt
  taskType?: string       // SDK 的 task_type（如 'local_workflow'）
  status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: number
  lastKnownAt: number     // 最后一次状态更新时间
}
```

### 数据流

```
SDK query() 流
   │
   ▼
claude-service.ts（扩展）──► 处理 system 事件：
   │                          • task_started (task_type==='local_workflow') → CREATE 后台任务
   │                          • task_updated                                → UPDATE 状态
   │                          • task_notification (completed/failed/stopped) → 退出感知
   │
   │  存 stream(Query) 引用 → Query.stopTask(taskId) 供终止用
   │
   ▼  webContents.send('claude:backend-task', { op, localSessionId, task })

backend-task-registry.ts ──存──► Map<taskId, BackendTask>
   │
   ▼  新增 IPC
   • 'backend-task:list'   → 渲染端拉取当前列表（按 localSessionId 过滤）
   • 'backend-task:kill'   → 渲染端请求终止（taskId）→ claude.stopTask(taskId)

preload 暴露 window.api.backendTask.{ list, kill, onEvent }
   │
   ▼
渲染端 store ──► BackendTaskPanel.tsx（右上角悬浮 Panel）
```

### 事件识别细节（实际架构，非旧假设）

| SDK 事件 | 判断条件 | 动作 |
|---|---|---|
| `system` / `task_started` | `task_type === 'local_workflow'` | CREATE 后台任务，`id = task_id`，存 `command = description \|\| prompt` |
| `system` / `task_started` | `task_type` 不满足上述（或无 task_type） | 走现有 `claude:task` → TaskCard（待办），不做后端任务 |
| `system` / `task_updated` | 该 `task_id` 在 registry 中 | UPDATE 状态（`patch.status`） |
| `system` / `task_notification` | 该 `task_id` 在 registry 中 | **退出感知**：`status` 为 completed/failed/stopped → 标记对应状态 |
| `system` / `task_notification` | `task_id` 不在 registry 中 | 走现有 `claude:task` → TaskCard（待办结束通知） |

> **现状**：`claude-service.ts` 已处理 `task_started`（line 193-203）和 `task_updated`（line 205-213），转发为 `claude:task`。**`task_notification` 被当成普通 notice 丢弃**（line 216-217）——这是本次要修的关键 gap。另外 `const stream = query({...})` 的 `Query` 对象需存为字段引用以暴露 `stopTask()`。

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
- 状态标注：由 `task_notification` 推送事件驱动——running 直到收到 completed/failed/stopped 才更新。

### 单条后台任务展示

- 命令（命令文本，省略号截断）
- 状态图标 + 状态文案
- 起始时间（相对时间，复用 `formatSessionTime`）
- "终止"按钮（分支 A 可用；分支 B 隐藏或置灰）
- 输出片段：最近 N 行 + "展开看全部"（数据来自 BashOutput 被动片段，无轮询）

## 错误处理

| 场景 | 处理 |
|---|---|
| `task_notification` 未关联到任何已知任务 | 忽略，记日志 |
| `stopTask` 调用失败 | 状态回退，面板提示"终止失败"，不静默吞错 |
| 会话切换 | 任务数据按 localSessionId 隔离，不串台（与现有 Claude 流隔离逻辑一致） |

## 测试策略

- **registry 纯函数**（vitest）：mock task_started（task_type=local_workflow / 无 task_type），断言 CREATE / 跳过；mock task_notification，断言状态转换；会话隔离测试。
- **UI 层**（@testing-library/react）：
  - Panel 三层折叠：各层独立展开/收起。
  - 显示规则：两 Card 空 → 不渲染 Panel；单 Card 有内容 → 只显该 Card。
  - 任务列表渲染 + 终止按钮点击触发 `backend-task:kill`。

## 实现顺序（已验证架构，无分支退化）

1. `backend-task-registry.ts` 主进程模块：`task_id` 作主键，CREATE（task_started）/ UPDATE（task_updated）/ EXIT_DETECT（task_notification）。
2. `claude-service.ts` 扩展：处理 `task_started`（分叉→backend task vs todo）、`task_notification`（退出感知）、保存 `stream` 引用暴露 `stopTask()`。
3. preload 暴露 + IPC（list / kill → `claude.stopTask(taskId)`）。
4. 渲染端 types + reducer + actions + store 接线。
5. `BackendTaskPanel` 容器 + `BackendTaskCard` + 改造 `TaskPanel` 为 Card。
6. 终止按钮接通 `stopTask`。
7. 测试。

## 未来方向（不在本设计范围）

- MCP 自定义 Bash（内置终端）路线：cc-desk 起 MCP server 暴露自定义 bash 工具，禁用 SDK 内置 Bash，命令全走 cc-desk PTY。一次性解决退出感知/PID/终止，并解锁实时输出与反馈。工程量大，作为本特性验证后的升级选项保留。
- 实时输出流与"反馈给 Claude"闭环：依赖内置终端或 shellId 输出接管，本设计不做。
