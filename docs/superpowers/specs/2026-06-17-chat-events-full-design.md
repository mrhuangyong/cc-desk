# 对话区事件全量处理 · 设计文档

日期：2026-06-17
状态：已确认（待实现）

## Context（背景与动机）

cc-desk 当前的对话区只处理了 Claude Agent SDK 事件流的一小部分：文本增量（`text_delta`）、思考增量（`thinking_delta`）、工具调用的"开始"（`tool_use` 的 `content_block_start`）、`system init` 元数据、`result` 的 cost/duration。

大量事件被丢弃或未接：完整 assistant 消息里的非文本 block（`tool_use` 的完整 input）、工具执行结果（`user` 消息里的 `tool_result`）、多轮中间产物、`result` 的 `is_error`、image/附件 block。`claude:assistant` 通道主进程虽发了，渲染端根本没监听。

更关键的是，SDK 的**交互型请求**完全没接入：`AskUserQuestion`（`onUserDialog` / `request_user_dialog` control request）因主进程 `query()` options 未声明 `onUserDialog`/`supportedDialogKinds`，被 SDK 直接降级，到不了 UI。

根本约束：`Message.content` 当前是 `string`，结构化内容天然存不下。

本次目标：**对所有 SDK 事件有正确处理**——每种 `message.type` 都有明确归宿（进对话内容、进状态提示、或显式记日志丢弃），并接入 `AskUserQuestion` 交互。

## 核心决策（已与用户确认）

1. **数据结构**：`Message.content` 从 `string` 改为 `ContentBlock[]`。旧数据不兼容（清掉）。
2. **工具呈现**：可折叠卡片，默认折叠；超长结果截断 + 按需展开。
3. **流式**：实时 blocks 拼接 + assistant 完整消息校正（临时态 + uuid 去重 / id 合并）。
4. **事件范围**：全量 SDK message type，归一化为 content blocks 或 SystemNotice，default 兜底。
5. **AskUserQuestion**：仅加 `onUserDialog`（保留 `permissionMode:'auto'`，不做工具权限弹窗）。从对话底部弹出答题面板，复用输入栏位置（InputDock 双态）。
6. **错误收尾**：`STREAM_ERROR` 只标记不结束流，等主进程 result/error/aborted 显式收尾。
7. **notice 留存**：SystemNotice 固化进历史 Message（`notices` 字段）。
8. **thinking**：作为 content block，默认折叠，统一交互。
9. **元数据**：在 AI 消息上展示 cost/duration/turns。

## 架构：分层归一化（方案 A）

主进程把所有 SDK message 归一化为渲染端能直接用的结构，渲染端只认 block/notice，不认 SDK 细节。新增事件类型是局部、可预测的改动。

数据流：
```
SDK stream message
  → 主进程 ClaudeService switch 归一化
  → 三种单向载荷：claude:delta / claude:blocks / claude:notice（+ 保留 claude:system / claude:result）
  → 交互载荷：claude:dialog-request（下发）/ claude:dialog-response（回传）
  → preload 6+2 通道
  → reducer 拼接 streaming.blocks / 累积 notices / 维护 pendingDialog
  → ChatArea 按 block 类型渲染 + InputDock 双态
```

## 数据模型

### ContentBlock（`src/renderer/types.ts`）

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; status: 'running' | 'completed' | 'error'; result?: ToolResult }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'image'; source: string }

export interface ToolResult { content: string; isError: boolean }

export interface SystemNotice {
  id: string
  kind: 'permission_denied' | 'api_retry' | 'status' | 'hook_progress'
       | 'task' | 'error' | 'info' | 'compact' | 'auth'
  text: string
  level: 'info' | 'warn' | 'error'
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[]          // 改：从 string 改为 blocks 数组
  attachment?: PickedElement
  notices?: SystemNotice[]         // 新增：本轮状态型提示固化
  costUSD?: number                 // 新增：result 元数据
  durationMs?: number
  turns?: number
  isError?: boolean
}
```

`tool_use` 自带 `status` 字段——流式期间一开始为 `running`，收到 `tool_result` 后回填 `result` 并改 `completed`/`error`。一张卡片自带生命周期。

## 主进程归一化（`src/main/claude-service.ts`）

`for await` 改为覆盖所有 `message.type` 的 switch，产出 5 种载荷。完整映射规约：

| SDK message | 归一化目标 | IPC 载荷 |
|---|---|---|
| `system` subtype=init | 会话元数据 | `claude:system`（保留） |
| `system` subtype=status | SystemNotice(status) | `claude:notice` |
| `system` subtype=permission_denied | SystemNotice(permission_denied, warn) | `claude:notice` |
| `system` subtype=compact* | SystemNotice(compact) | `claude:notice` |
| `system` 其余子类型 | SystemNotice(info) 或丢弃 | `claude:notice` |
| `stream_event` text_delta | text 增量 | `claude:delta {kind:'text'}` |
| `stream_event` thinking_delta | thinking 增量 | `claude:delta {kind:'thinking'}` |
| `stream_event` content_block_start(tool_use) | 新建 tool_use block, status=running | `claude:blocks {op:'tool_use_start'}` |
| `assistant`（BetaMessage content blocks） | blocks 补全/校正 | `claude:blocks {op:'assistant_blocks', uuid}` |
| `user`（含 tool_result） | tool_result 回填 | `claude:blocks {op:'tool_result', toolUseId}` |
| `result`（success/error） | 结束 + cost + is_error | `claude:result`（保留，加 isError） |
| `result` is_error=true | 额外 error notice | `claude:notice` |
| `api_retry` | SystemNotice(api_retry, warn) | `claude:notice` |
| `task_*` | SystemNotice(task) | `claude:notice` |
| `auth_status` | SystemNotice(auth) | `claude:notice` |
| `keep_alive` / `worker_shutting_down` / `commands_changed` | 协议类，记日志丢弃 | 无 |
| 其他未知 type | SystemNotice(info) 兜底 | `claude:notice` |

**default 分支兜底**是"全量正确处理"的保险：SDK 未来加任何新 type 都不静默丢失。

辅助纯函数：`mkNotice` / `normalizeBetaBlocks`（BetaMessage content → ContentBlock[]）/ `extractToolResults`（user message content → `{toolUseId, content, isError}[]`）/ 各 `*Text` 拍平函数。

### 调试日志

`[cc-stream]` 节点 4（每条 message type）保留作为全量覆盖验证；上一轮其余节点日志清理。新增：`onUserDialog` 触发时打印 `dialogKind`/`payload`（实现期观察用）。

## IPC / preload（`src/preload/index.ts`）

替换原 8 个 `onXxx`，新通道：

- 单向：`onSystem` / `onDelta(cb:{kind,delta})` / `onBlocks(cb:{op,...})` / `onNotice(cb:SystemNotice)` / `onResult(含 isError)` / `onError` / `onAborted`
- 交互：`onDialogRequest(cb:{reqId,dialogKind,payload,toolUseId})`（下发）、`dialogResponse({reqId,result})`（回传，invoke）
- `removeAllListeners` 清除以上通道；删除旧的 `onStreamDelta/onThinkingDelta/onToolUse/onAssistant`。

## AskUserQuestion / onUserDialog 桥接

### 主进程（`ClaudeService`）

`query()` options 新增（`permissionMode:'auto'` 不变）：

```ts
supportedDialogKinds: ['refusal_fallback_prompt' /* + 观察到的 AskUserQuestion kind */],
onUserDialog: async (request, { signal }) => bridge.askUserDialog(request, signal),
```

桥接器（请求-响应 IPC）：

```ts
private dialogResolvers = new Map<string, (r: UserDialogResult) => void>()

async askUserDialog(request, signal) {
  const reqId = nextId('dlg')
  webContents.send('claude:dialog-request', { reqId, dialogKind: request.dialogKind, payload: request.payload, toolUseId: request.toolUseID })
  return new Promise(resolve => {
    this.dialogResolvers.set(reqId, resolve)
    signal.addEventListener('abort', () => { this.dialogResolvers.delete(reqId); resolve({ behavior: 'cancelled' }) })
  })
}
// index.ts: ipcMain.handle('claude:dialog-response', (_e, { reqId, result }) => { ...resolve })
```

### 渲染端（InputDock 双态 + AnswerPanel）

- store 新增 `pendingDialog: { reqId, dialogKind, payload, toolUseId? } | null`
- 新增 `InputDock` 容器组件：`pendingDialog` 为空 → 渲染 `<InputBar>`（自由输入）；非空 → 渲染 `<AnswerPanel>`（答题）。复用底部位置，视觉为"面板从下方弹出"。消息流保持可见。
- `AnswerPanel`：按 `dialogKind` 分发；`AskUserQuestion` 形态（1-4 question，每个 2-4 option + multiSelect + 自动 "Other…" 文本框）。
- 提交 → dispatch `ANSWER_DIALOG` → 组件侧 `window.api.claude.dialogResponse({reqId, result})` → 清 `pendingDialog`。取消/关闭 → 回 `{behavior:'cancelled'}`。

### 实现期不确定性（必须先验证）

`AskUserQuestion` 的 `dialogKind` 字符串与 payload 精确结构在 SDK 类型里是 opaque（`unknown`），文档只举 `'refusal_fallback_prompt'`，sdk.mjs 无字面量。**第一次触发时用 `[cc-stream]` 日志打印真实 `request.dialogKind`/`payload`，确认形态后再接表单 UI。** 未识别 kind 回 `{behavior:'cancelled'}`（SDK 契约）。

> 备选路径：AskUserQuestion 也可能作为普通 `tool_use`（工具名 `AskUserQuestion`）出现在流里而非 dialog。实现时第一时间验证；若确认走 tool_use 而非 dialog，切换为"拦截该 tool_use → 收集答案 → 注入 tool_result"方案。

## reducer / actions（`src/renderer/state/`）

### 状态

```ts
streamingBySession: Record<string, {
  blocks: ContentBlock[]
  notices: SystemNotice[]
  error?: string
}>
pendingDialog: { reqId, dialogKind, payload, toolUseId? } | null
```

### actions

```ts
| { type: 'STREAM_START'; sessionId }
| { type: 'STREAM_DELTA'; sessionId; kind:'text'|'thinking'; delta }
| { type: 'STREAM_TOOL_USE_START'; sessionId; block: Extract<ContentBlock, {type:'tool_use'}> }
| { type: 'STREAM_TOOL_RESULT'; sessionId; toolUseId; result: ToolResult }
| { type: 'STREAM_ASSISTANT_BLOCKS'; sessionId; blocks; uuid }   // 校正：uuid 去重、id 合并 tool_use
| { type: 'STREAM_NOTICE'; sessionId; notice: SystemNotice }
| { type: 'STREAM_ERROR'; sessionId; error }                     // 只标记，不结束流
| { type: 'STREAM_ABORTED'; sessionId }
| { type: 'STREAM_END'; sessionId; costUSD?; durationMs?; isError?; turns? }  // 固化 + 清理
| { type: 'SHOW_DIALOG'; reqId; dialogKind; payload; toolUseId? }
| { type: 'ANSWER_DIALOG' }   // reducer 只清 pendingDialog；IPC 回传在组件侧
```

### 流式拼接规约

- `STREAM_DELTA`(text)：找 blocks 末尾最后一个 text block append；否则 push 新 text block。thinking 同理。
- `STREAM_TOOL_USE_START`：push `status:'running'` tool_use block。
- `STREAM_TOOL_RESULT`：找到 `id===toolUseId` 的 tool_use，回填 result、置 completed/error。
- `STREAM_ASSISTANT_BLOCKS`：按 uuid 记录已校正轮次避免重复；新 block 追加，已存在 tool_use 按 id 合并（补全 input）。
- `STREAM_NOTICE`：append 到 `streaming.notices`。
- `STREAM_END`：把 `streaming.blocks` + `notices` + cost/duration/isError 固化成一条 assistant Message 追加到 session.messages；删除 streaming 条目。
- `STREAM_ERROR`：置 `streaming.error`，UI 显示错误条，**不**自动结束。
- `STREAM_ABORTED`：删除 streaming 条目。

不可变更新沿用现有 reducer spread 模式。

## ChatArea 渲染层

- 消息流：按 `Message.content` 的 block 类型渲染：
  - `text`：纯文本（保留 `userSelect:'text'`）
  - `thinking`：可折叠区，默认折叠
  - `tool_use`：可折叠卡片，默认折叠。摘要行（工具名 + 关键参数 + status 图标），展开看完整 input + result。结果超长（>30 行/2000 字符）截断 + "展开查看全部"。
  - `image`：图片
- 流式区：渲染 `streaming.blocks`（同上 block 渲染组件复用）+ 闪烁光标 + error 条。
- notice：消息上方细状态行（permission_denied/api_retry/status 等），按 level 着色。固化进 Message 后历史消息也展示。
- 元数据：AI 消息末尾展示 cost/duration/turns。
- `InputDock`：底部容器，双态切换 InputBar / AnswerPanel。

## 旧数据

`Message.content` 改为 blocks 后，已持久化的旧 snapshot（string content）**不兼容，清掉**。实现时 projects snapshot 加版本检测或直接重置（用户已确认清掉旧数据）。

## 测试策略

- **单元（vitest）**：reducer 流式拼接——text append、tool_use 生命周期（start→result 回填）、assistant_blocks 校正去重、STREAM_END 固化、notice 累积、error 不结束流。沿用 `tests/reducer.test.ts` 模式，更新断言到新 content 结构。
- **单元**：主进程归一化纯函数（`normalizeBetaBlocks` / `extractToolResults` / `mkNotice`）——喂 mock SDK message，断言产出载荷。
- **手动端到端**（`npm run dev`）：
  - 文本对话正常 + cost/时长展示。
  - AI 调工具（Read/Bash）：看到 tool_use 卡片 + tool_result 回填，默认折叠可展开，超长结果截断。
  - AskUserQuestion：底部弹出答题面板，提交后 AI 继续（实现期先靠日志确认 dialogKind）。
  - 权限拒绝/api_retry 等 notice 显示。
  - 流式期间切换不卡死（回归前几轮修复）。

## 实现顺序建议

1. 数据模型（types）+ reducer 流式拼接 + actions（先不带 dialog）。
2. 主进程归一化 switch + preload 6 通道（单向）。
3. ChatArea block 渲染组件 + notice 行 + 元数据。
4. AskUserQuestion：主进程 onUserDialog 桥接 + 双向 IPC + InputDock 双态 + AnswerPanel（实现期观察 dialogKind 后接表单）。
5. 清理 `[cc-stream]` 调试日志（保留节点 4 直到最后）。
