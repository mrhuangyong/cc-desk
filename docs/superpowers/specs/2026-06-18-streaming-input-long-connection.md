# Streaming-Input 长连接模式：后台进程保活改造

日期：2026-06-18
状态：调研 + 方案设计（待评审）

## 背景与根因

后台任务面板完成后实测发现两个连带的架构级问题，根因相同：

**cc-desk 当前用「单轮 query」模式：每条用户消息 spawn 一个新的 `query({ prompt: string })`。**

`src/main/claude-service.ts` 的 `send()` 每次调用 `query()`，拿到 stream 后 `for await` 遍历，收到 `result` 后 stream 结束、进入 `finally`。SDK 的 `Query` 对象在单轮模式下，遍历结束会触发 `cleanup()` → `close()` → `transport.close()`。

SDK 源码（`sdk.mjs`）确认 `close()` 含明确的杀进程逻辑：
```
r.kill("SIGTERM"), setTimeout(()=>{ if(n.exitCode===null) n.kill("SIGKILL") }, 5000)
```
`r` 是 SDK spawn 的 CLI 子进程。Claude 用 Bash `run_in_background:true` 起的后台命令（如 `pnpm dev`）是 CLI 子进程的孙进程，**在同一进程组内，SIGTERM/SIGKILL 连带终止**。

两个表现：
1. **后台进程几秒后死**——对话一轮结束、SDK cleanup、进程组被杀。
2. **（上一轮已修）悬浮面板没出现**——`backgroundTaskId` 藏在 tool_result 文本里，已用正则提取修复。但即使修好，面板也只能在对话进行中那几秒有效，对话一结束进程死、面板随之消失。

## 目标

改用 SDK 的 **streaming-input 长连接模式**：CLI 子进程持久存活，后台进程不被杀，后台任务面板可持续展示任务全生命周期。

## SDK 机制（已从 sdk.d.ts / sdk.mjs 确认）

### 入口
```typescript
query(_params: {
  prompt: string | AsyncIterable<SDKUserMessage>;  // 传 AsyncIterable = streaming 模式
  options?: Options;
}): Query
```
- 传 `string` → 单轮：第一个 `result` 后 CLI 子进程关闭。
- 传 `AsyncIterable<SDKUserMessage>` → streaming：CLI 子进程持续运行，iterable 每产出一个 message 触发一轮 assistant turn，**`result` 只代表「一轮结束」，stream 不关闭**。

### SDKUserMessage 结构
```typescript
{
  type: 'user'
  message: MessageParam              // { role:'user', content: string | ContentBlock[] }
  parent_tool_use_id: string | null  // 顶层用户消息传 null
  isSynthetic?: boolean
  shouldQuery?: boolean              // false=只追加不触发轮次
  priority?: 'now' | 'next' | 'later'
}
```

### Query 对象方法（streaming 模式可用）
- `streamInput(stream)` — 也可单独喂流（与 `prompt: AsyncIterable` 二选一的等价方式）
- `interrupt()` — 中断当前轮
- `stopTask(taskId)` — 停止后台任务（本特性终止用）
- `return()` / `throw()` — 关闭整个 query（杀进程）

## 改造方案

### 核心数据结构：per-session 的 query + push 队列

每个 cc-desk 会话（localSessionId）维持：
- 一个**持久 Query 对象**（CLI 子进程）
- 一个 **async iterable + push 回调**，用于把新用户消息喂进去

```
首次发送：
  1. 创建 session 的 push 队列（async iterable + controller.push）
  2. query({ prompt: 队列的 iterable, options:{ resume?, ... } })
  3. controller.push(首条 SDKUserMessage)
  4. for await message: 转发事件（与现在一致），result 不 break、不 cleanup

后续发送（同一会话）：
  1. controller.push(新 SDKUserMessage)  ← 复用已有持久 query
  2. 同一 for await 循环继续产出新一轮的事件

关闭会话：
  query.return() 或 abortController.abort() → cleanup → 杀进程组
```

### claude-service.ts 改造点

1. **新增 session 状态**：`Map<localSessionId, { query: Query, controller: StreamController, abort: AbortController }>`
2. **`send()` 重构**：
   - 会话首次：创建队列 + query，启动后台遍历任务（不 await）
   - 会话续接：push 新消息到已有队列
   - 区分「中断本轮」(interrupt) vs「关闭会话」(abort/return)
3. **事件转发不变**：`for await` 内的 case 处理逻辑（system/stream_event/assistant/user/result/...）保持不变，只是循环不再因 result 退出。
4. **resume 处理变化**：单轮模式靠每次 `resume: sessionId` 续接；streaming 模式下同一进程天然续接，**但首次创建会话时仍需传 resume（恢复历史会话）**。

### 风险与开放问题

| 风险 | 说明 | 缓解 |
|---|---|---|
| 资源占用 | 每个 cc-desk 会话常驻一个 CLI 子进程 | 监控；空闲会话考虑超时关闭 |
| abort 语义变化 | 现在 abort = 关 query；改造后需区分中断轮 vs 关会话 | 新增 stopTurn vs closeSession |
| result 处理 | 现在是 stream 终点，改造后是轮终点 | 改 STREAM_END 语义：一轮结束不清理 streaming state 的进程引用 |
| resume 在 streaming 下的行为 | 未确认 streaming 模式首次带 resume 能否恢复历史 | 实验验证（Task 0） |
| 并发消息 | streaming 模式下连续 push 多条消息的排队/优先级 | 用 priority 字段控制，默认 'now' |
| 异常恢复 | CLI 子进程崩溃后如何重建 | 需要错误检测 + 重建 query 的机制 |

### 改造范围（预估）

- `src/main/claude-service.ts` — 重构 send/abort，新增 session query 管理
- 可能新增 `src/main/session-query-manager.ts` — per-session 持久 query 生命周期
- `src/main/index.ts` — stop IPC 语义调整
- 渲染端基本不变（事件协议不变）

## 实施顺序（概要）

0. **实验验证**（手工脚本）：确认 streaming 模式下后台进程不被杀、result 不关 stream、resume 行为。
1. 设计 per-session query 管理器。
2. 重构 claude-service.ts。
3. 调整 abort/stop 语义。
4. 端到端验证：起后台命令 → 对话结束 → 确认进程仍活、面板持续显示。
5. 后台任务面板集成测试。

## 待决策

这是一次架构级重构，影响整个会话/流式输出模型。需要先跑 Task 0 实验确认 SDK streaming-input 的实际行为（尤其是 resume 和后台进程保活），再进入实现。

## Task 0 实验结论（2026-06-18，已跑 `scripts/probe-streaming.mjs`）

**三个核心假设全部验证通过，streaming-input 改造方向可行。**

实验用 qwen 模型（本地代理 localhost:1000），streaming-input 模式起后台 `sleep 60`：

| 假设 | 实测结果 |
|---|---|
| 后台进程在第一轮 result 后仍存活 | ✅ result 后 `sleep 60` 进程数=2，等 3s 后仍=2 |
| result 代表「一轮结束」而非「query 结束」 | ✅ push 第二条消息触发第二轮 result，stream 未关闭 |
| close() 才杀进程组 | ✅ close() 后进程数=0 |

**意外收获**：streaming 模式下后台 Bash 命令会发 `system(task_started)` 事件。这意味着 `claude-service.ts` 现有的 `task_started(task_type==='local_workflow')` 分叉路径在 streaming 模式下**自然生效**，文本正则提取 backgroundTaskId 仅作兜底。

仍待实现期验证：resume 在 streaming 首次创建时恢复历史会话的行为。
