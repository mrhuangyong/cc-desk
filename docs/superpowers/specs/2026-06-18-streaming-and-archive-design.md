# Streaming-Input 长连接 + 会话归档系统 设计

日期：2026-06-18
状态：设计稿（待评审）
关联：`2026-06-18-streaming-input-long-connection.md`（调研）、`2026-06-18-backend-task-panel-design.md`（后台任务面板）

## 背景与目标

两个耦合的特性合并实现：

### 特性 A：Streaming-Input 长连接重构
cc-desk 当前用单轮 `query({ prompt: string })` 模式——每条消息 spawn 一个 CLI 子进程，收到 `result` 后 SDK `cleanup()` 杀掉整个进程组（含 Claude 用 Bash `run_in_background:true` 起的后台进程如 `pnpm dev`）。导致：
1. 后台进程几秒后死（对话轮结束即被连带杀）
2. 后台任务面板即使检测到任务，也只能在对话进行中那几秒有效

Task 0 实验（`scripts/probe-streaming.mjs`）已验证：改用 streaming-input 长连接（`query({ prompt: AsyncIterable })`）后，CLI 子进程持久存活，后台进程不被杀，`result` 只代表「一轮结束」而非「query 结束」。

### 特性 B：会话归档系统
当前「删除会话」是真删除（`DELETE_SESSION` 直接 filter 移除），`ARCHIVE_STALE` 名为归档实为删空会话。需求改为：删除 → 归档（保留可还原）；设置页新增「已归档会话」管理（还原 / 真删除）。

### 耦合点
归档会话时关闭其持久 CLI 进程（杀进程组，含后台任务）。还原时惰性重建（下次发消息 `ensureSession` 带 resume）。

## 决策汇总

| 维度 | 决定 |
|---|---|
| 持久进程范围 | 每会话一个持久 CLI 进程 |
| 停止语义 | stop 按钮只做「停止本轮」(interrupt)；杀进程只绑「关闭/归档会话」 |
| query 创建时机 | 惰性：首条消息时创建 + resume 恢复历史 |
| result 处理 | 渲染端 STREAM_END 语义不变；主进程 for-await 循环不 break |
| CLI 崩溃 | 自动清理 SessionQuery + 下次 send 重建（带 resume）；重建失败才报 error |
| 归档行为 | 归档 = closeSession（杀进程组）+ 标记 archived；还原 = 清标志 + 惰性重建 |

## 架构

### 新增 `src/main/session-query-manager.ts`

承载 per-session 持久 query 生命周期。无渲染端依赖，主进程内部模块。

```typescript
interface SessionQuery {
  localSessionId: string
  query: Query                       // SDK 持久 query 对象
  controller: PushController          // async iterable 的 push 接口
  abort: AbortController
  iterateTask: Promise<void>          // 后台 for-await 遍历任务
  state: 'idle' | 'streaming'
}

export class SessionQueryManager {
  private sessions = new Map<string, SessionQuery>()

  // 确保 session 有持久 query（首次创建带 resume，已存在则复用）
  ensureSession(opts: {
    localSessionId: string
    resumeId?: string
    webContents: WebContents
    onEvent: (msg: any) => void       // 事件转发回调（给 claude-service 注入）
  }): SessionQuery

  // 喂一条用户消息，触发新一轮
  pushMessage(localSessionId: string, prompt: string): void

  // 中断当前轮（不杀进程）
  interrupt(localSessionId: string): void

  // 关闭会话进程（杀进程组，含后台任务）
  closeSession(localSessionId: string): void

  // 关闭所有会话进程（app 退出时调）
  closeAll(): void

  // 停止某后台任务（不动 query）
  stopTask(localSessionId: string, taskId: string): Promise<void>

  // 进程崩溃自愈：清理失效 session
  private handleCrash(localSessionId: string, err: unknown): void
}
```

### PushController（manager 内部类）

```typescript
class PushController {
  private queue: SDKUserMessage[] = []
  private resolveNext: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false
  iterable: AsyncIterable<SDKUserMessage>   // 喂给 query({ prompt })
  push(msg: SDKUserMessage): void
  close(): void
}
```
（Task 0 脚本已验证此模式）

### claude-service.ts 改造

从「每次 send 一个 query」退化为「委托给 SessionQueryManager 的转发层」：

- `send()`：读配置 → `manager.ensureSession({ resumeId })` → `manager.pushMessage(lsid, prompt)`。不再直接 `query()`。
- `abort()` → 拆为 `interrupt()`（调 `manager.interrupt`）+ 移除（关闭会话由归档触发，不在此）。
- `stopTask()` → 调 `manager.stopTask`。
- 事件转发逻辑（`for await` 的所有 case）搬到 manager 的 `iterateTask` 内，通过 `onEvent` 回调推给 claude-service，后者负责 IPC `webContents.send`。
- `askUserDialog` / `onUserDialog` 桥接移到 `ensureSession` 内的 query 创建处。

### index.ts 改造

- `claude:send` handler 不变。
- `claude:stop` handler：`claude.abort()` → `claude.interrupt()`（语义从「停止」变「停止本轮」）。
- 新增：会话归档时调 `manager.closeSession(sessionId)`（接 IPC，见下）。
- 实例化 `SessionQueryManager` 并注入 `claude.setManager(manager)`。

## 特性 A 详细设计：流式生命周期

### ensureSession 首次创建

```
1. 若 sessions.has(lsid) 且 state 有效 → 直接返回
2. 创建 PushController
3. query({ prompt: controller.iterable, options: { resume: resumeId, env, model, cwd, permissionMode, maxTurns, includePartialMessages, abortController, onUserDialog, supportedDialogKinds } })
4. 启动 iterateTask（后台 Promise，跑 for-await，不阻塞 ensureSession）
5. sessions.set(lsid, { query, controller, abort, iterateTask, state:'idle' })
```

### iterateTask（后台遍历）

```typescript
async iterateTask(sq: SessionQuery, onEvent) {
  try {
    sq.state = 'streaming'
    for await (const message of sq.query) {
      onEvent(message)   // 转发给 claude-service → IPC
      // 注意：不因 result break；result 只是一轮结束
    }
    // for-await 正常结束 = query 被 return/close（归档或退出）
  } catch (err) {
    this.handleCrash(sq.localSessionId, err)
  }
}
```

### pushMessage

```
1. ensureSession(lsid) 确保存在
2. controller.push({ type:'user', message:{ role:'user', content: prompt }, parent_tool_use_id: null })
3. （SDK 收到 iterable 产出 → 触发新一轮 → iterateTask 继续产出事件）
```

### interrupt vs closeSession

- `interrupt(lsid)`：`sq.query.interrupt()` —— 中断当前 assistant turn，本轮以 result 结束，进程活着。
- `closeSession(lsid)`：`sq.controller.close()` + `sq.query.return()` —— 杀进程组（含后台任务），`sessions.delete(lsid)`。iterateTask 的 for-await 因 close 自然结束。

### CLI 崩溃自愈

`iterateTask` catch 到错误 → `handleCrash`：
1. `sessions.delete(lsid)`（进程已死，引用失效）
2. 通过 onEvent 推一条 error 事件给渲染端
3. 下次 `send` 时 `ensureSession` 发现 session 不存在 → 重建（带 resume）

重建仍失败 → `claude:error` 明确告知「会话进程已断开」。

### resume 行为（待实现期验证）

首次 `ensureSession` 带 `resume: resumeId`（来自 `claudeSessionMap`）。Task 0 未测 resume，实现时第一个验证点：用 resume 恢复旧会话，确认 Claude 能看到历史上下文。若 streaming 模式下 resume 行为异常，回退方案：不带 resume，由 cc-desk 把历史消息序列化拼进首条 prompt。

## 特性 B 详细设计：会话归档系统

### 数据结构变更

`Session`（`src/renderer/types.ts`）新增字段：
```typescript
export interface Session {
  id: string
  title: string
  messages: Message[]
  updatedAt?: number
  archived?: boolean        // 新增：是否已归档
  archivedAt?: number       // 新增：归档时间
}
```

### reducer 变更

| action | 变更 |
|---|---|
| `DELETE_SESSION` | **保留但语义收窄**：只在「已归档会话」管理里用（真删除） |
| `ARCHIVE_SESSION`（新增） | 标记 `archived:true` + `archivedAt`；**触发主进程 closeSession** |
| `RESTORE_SESSION`（新增） | 清 `archived` 标志 |
| `ARCHIVE_STALE` | 行为不变（删空会话），但可改为标记 archived 而非删除——**本 spec 暂不动，保持原样**（YAGNI，避免范围蔓延） |
| 会话列表渲染 | 过滤掉 `archived:true` 的会话（主列表不显示） |

### ProjectTree 改造

会话删除按钮（当前 `DeleteConfirmIcon` → `DELETE_SESSION`）改为：
- 主列表的会话：按钮变为「归档」（触发 `ARCHIVE_SESSION`）
- 已归档会话管理页：每个会话两个按钮「还原」（`RESTORE_SESSION`）+「删除」（`DELETE_SESSION` 真删）

### 设置页新增「已归档会话」

`src/renderer/components/settings/` 新增 `ArchivedSessionsSettings.tsx`：
- 列出所有 `archived:true` 的会话（跨项目）
- 每条：会话标题、所属项目、归档时间、还原按钮、删除按钮
- 在 `SettingsMenu` 加入口「已归档会话」
- `SettingsSection` 类型新增 `'archived'`

### 归档与持久进程的联动

`ARCHIVE_SESSION` 触发时：
1. 渲染端 dispatch（标记 archived、从主列表移除）
2. 渲染端调 IPC `session:archive`（参数 localSessionId）
3. 主进程 `manager.closeSession(localSessionId)` —— 杀进程组

还原（`RESTORE_SESSION`）：
1. 渲染端 dispatch（清 archived 标志、回主列表）
2. **不立即重建进程**——惰性，下次该会话发消息时 `ensureSession` 带 resume 重建

## 数据流总览

```
[发送消息]
  渲染端 → claude:send → claudeService.send()
    → manager.ensureSession(lsid, resumeId)   // 首次创建持久 query + 启动 iterateTask
    → manager.pushMessage(lsid, prompt)       // 触发新轮
    → iterateTask 的 for-await 产出事件 → onEvent → claudeService IPC 转发

[停止本轮]
  渲染端 → claude:stop → claudeService.interrupt() → manager.interrupt(lsid) → query.interrupt()

[归档会话]
  渲染端 ProjectTree 归档按钮 → dispatch ARCHIVE_SESSION（标记）
    → IPC session:archive → manager.closeSession(lsid) → 杀进程组

[还原会话]
  设置页还原按钮 → dispatch RESTORE_SESSION（清标志）→ 不重建进程（惰性）

[CLI 崩溃]
  iterateTask catch → handleCrash → 删 session 引用 + 推 error → 下次 send 重建
```

## 错误处理

| 场景 | 处理 |
|---|---|
| ensureSession 时 resume 失败 | 回退：不带 resume，历史拼进首条 prompt；或报 error |
| iterateTask 崩溃 | handleCrash 清理 + 下次重建；重建失败报 error |
| pushMessage 时 session 已被 close | ensureSession 重建 |
| interrupt 时 session 不存在 | 静默忽略（会话可能已归档） |
| closeSession 时 session 不存在 | 静默忽略 |
| 归档一个正在 streaming 的会话 | closeSession 中断 iterateTask + 杀进程，渲染端流式状态由 STREAM_ABORTED 清理 |
| 还原一个仍存活的会话 | 不会发生（归档已杀进程）；还原后发消息走 ensureSession 重建 |
| app 退出 / 窗口关闭 | `before-quit` / `window.on('closed')` 调 `manager.closeAll()` 杀所有持久进程，避免孤儿 CLI 子进程 |

## 测试策略

- **PushController 单测**（vitest）：push/next 顺序、close 后迭代结束、并发 push 排队。
- **SessionQueryManager 单测**（mock SDK query）：ensureSession 复用、pushMessage 触发事件、interrupt/closeSession 行为、handleCrash 清理。
- **归档 reducer 单测**：ARCHIVE_SESSION 标记、RESTORE_SESSION 清除、主列表过滤 archived、DELETE_SESSION 真删。
- **UI 测试**（@testing-library/react）：归档按钮触发 ARCHIVE_SESSION、设置页已归档会话列表渲染、还原/删除按钮。
- **resume 行为实验**（手工）：用 resume 恢复旧会话验证 Claude 上下文可见。
- **端到端**：起后台命令 → 对话结束 → 确认进程仍活、面板持续显示；归档会话 → 确认进程被杀、面板任务消失。

## 文件改动清单

**新建：**
- `src/main/session-query-manager.ts`
- `src/renderer/components/settings/ArchivedSessionsSettings.tsx`

**修改：**
- `src/main/claude-service.ts`（重构为转发层）
- `src/main/index.ts`（实例化 manager、stop→interrupt、session:archive IPC）
- `src/renderer/types.ts`（Session 加 archived/archivedAt；SettingsSection 加 'archived'）
- `src/renderer/state/reducer.ts`（ARCHIVE_SESSION/RESTORE_SESSION；主列表过滤）
- `src/renderer/state/actions.ts`（新 action）
- `src/renderer/components/ProjectTree.tsx`（删除按钮→归档按钮）
- `src/renderer/components/settings/SettingsMenu.tsx`（加已归档会话入口）
- `src/main/projects-store.ts`（持久化含 archived 字段）

## 不做（YAGNI）

- 归档数量上限、自动清理已归档会话
- 多会话并发进程数限制（仅 log 观察）
- ARCHIVE_STALE 行为改造（保持原删空会话行为）
- 「停止本轮」与「杀进程」的 stop 按钮分动作（杀进程只绑归档）
- 后台任务实时输出流（仍只读 task_notification/task_updated 推送的状态）
