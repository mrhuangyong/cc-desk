# 上下文面板新增【压缩】按钮（触发真实 SDK 压缩）

## Context（为什么改）

用户希望在输入框底部「上下文用量」圆环弹出的详情面板里，加一个【压缩】按钮，点击触发上下文压缩，并期望压缩后**占比环真的下降**（真降 token，而非仅整理 UI）。

### 关键技术发现（推翻了最初的不成立判断）

经查证 Claude CLI 源码（`/Users/mrhua/projects/aieditor/claude-code-bak`）与 SDK 行为，确认：

- **SDK（`@anthropic-ai/claude-agent-sdk`）的 `query()` 底层 spawn 的是 CLI 子进程**（`pathToClaudeCodeExecutable`）。
- **CLI 子进程在把 user message 发往模型之前，会先做 slash 命令分发**（`processUserInput` → `processSlashCommand`，见 CLI 源码 `processUserInput.ts:533-551`）。
- **`/compact` 是 CLI 的 `type:'local'` 本地命令**（`supportsNonInteractive: true`），命中后本地调用 `compactConversation` 真实压缩历史，用压缩后 messages 替换内部上下文，`shouldQuery:false`（不发 API），后续轮次丢弃旧历史 → **真实降低 token**。
- **SDK 模式不跳过 slash 解析**（SDK 路径不传 `skipSlashCommands`，`effectiveSkipSlash=false`）。
- 因此 **通过 `query()` / `pushMessage()` 发送一条 content 为 `"/compact"` 的 user message，CLI 子进程会本地拦截并真实执行压缩**——这是手动触发真降 token 的可行路径。

### cc-desk 现有相关能力（可复用，无需新写压缩逻辑）

- **`compact_boundary` / `compacting` / `compact failed` 事件已被处理**（`src/main/claude-service.ts:584-598`）：压缩中显示「正在压缩上下文…」，完成显示「已手动/自动压缩：pre → post tokens」，失败显示错误。这些走 `claude:notice` → 渲染端 notice。
- **`getContextUsage`**（`src/main/session-query-manager.ts:204`）每轮对话结束主动推送占比（`claude-service.ts:863-872`）。
- **`pushMessage(lsid, "/compact")`**（`session-query-manager.ts:129`）就是把一条 user message 推进持久 query 的 controller.iterable，正是触发 CLI `/compact` 的入口。

### 与现有手写 `/compact` 的区别（重要）

cc-desk 现有的手写 `/compact`（`compactSession`，`claude-service.ts:1212`）走的是 `runSideQuery` 旁路生成 200 字摘要 + 截断 UI 消息保留最近 6 条——**这是 UI 层整理，不降 SDK token**。本方案的新按钮走的是**完全不同的路径**：直接 `pushMessage("/compact")` 让 CLI 子进程真实压缩。

故按钮不复用 `compactSession`，而是走 `pushMessage`。

## 设计

### 交互

在 `ContextUsagePanel`（`src/renderer/components/ContextUsageRing.tsx` 的详情面板）底部加一个【压缩】按钮：
- 点击 → 调新 IPC `claude:compact-context` → 主进程 `manager.pushMessage(lsid, "/compact")`。
- 按钮点击后面板关闭（避免遮挡 notice），并给按钮一个短暂的「压缩中…」禁用态（本地 state，约 2-3 秒兜底，真实状态由 notice 反馈）。
- 流式中（`isStreaming`）禁用按钮（与现有 `/compact` 在流式时被过滤的约束一致——压缩进行中会破坏流）。
- 无消息的空会话禁用按钮（压缩无意义）。

### 为什么不直接复用 `claude:send` 发 `/compact`

`claude:send` 走渲染端 `doSend`，会先 `dispatch(SEND_MESSAGE_WITH_DRAFT)` 把 `/compact` 当一条用户消息显示在对话流里——但 `/compact` 是命令，不该出现在消息历史中（现有 slash 菜单选中 `/compact` 走 `onBuiltinRun` 即时执行，不进消息流，正是为此）。故新增轻量 IPC 直接 `pushMessage`，绕开消息追加。

### 占比环刷新闭环

压缩完成后占比环要立刻反映新 token。两条保障：
1. **主进程侧（推荐）**：在 `forwardEvent` 处理 `compact_boundary` notice 后，主动 `getContextUsage(lsid)` 推一次 `claude:context-usage`（复用 `claude-service.ts:863-872` 的推送模式）。这是最可靠的——压缩一完成就刷。
2. 渲染端 `InputBar` 已订阅 `onContextUsage`（`InputBar.tsx:145-152`），收到推送自动更新环。

仅做第 1 点即可闭环；不必在渲染端额外监听 compact notice。

## 改动清单

### 1. 主进程：新增 IPC + 压缩后刷新占比

**`src/main/claude-service.ts`** — 新增 `compactContext` 方法：
```ts
async compactContext(localSessionId: string, webContents: WebContents): Promise<void> {
  if (!this.manager) return
  // 流式中压缩会破坏流；调用方（渲染端）已禁用按钮，这里兜底再判一次
  if (this.manager.isIterating(localSessionId)) {
    webContents.send('claude:notice', { ...mkNotice('compact', '流式对话中，无法压缩', 'warn'), localSessionId })
    return
  }
  this.manager.pushMessage(localSessionId, '/compact')
}
```
并修改 `forwardEvent` 的 `compact_boundary` 分支（约 586-595 行）：在发完 notice 后，主动查并推送一次 context-usage（让占比环立即反映压缩后 token）。

**`src/main/index.ts`** — 注册 IPC（约 699 行 `cc:builtin:compact` 附近）：
```ts
ipcMain.handle('claude:compact-context', (_e, localSessionId: string) =>
  claude.compactContext(localSessionId, getActiveWin()!.webContents))
```

### 2. Preload 桥接

**`src/preload/index.ts`** — 在 `claude` 命名空间加（约 53 行 `contextUsage` 附近）：
```ts
compactContext: (localSessionId: string) => ipcRenderer.invoke('claude:compact-context', localSessionId),
```

### 3. 渲染端：面板加按钮

**`src/renderer/components/ContextUsageRing.tsx`** — `ContextUsagePanel` 新增 props（`onCompact`、`compactDisabled`、`compactLabel`），在面板底部（categories 明细下方）渲染【压缩】按钮。按钮样式复用 InputBar 现有 `btnBase` 风格（参考 `InputBar.tsx:397-401`），靠右。

**`src/renderer/components/InputBar.tsx`** — `ContextUsageRing` 的挂载点（约 661 行）传入：
- `onCompact={() => window.api?.claude?.compactContext(state.activeSessionId)}`
- `compactDisabled={isStreaming || isEmptySession}`
- `compactLabel={t('contextUsage.compact')}`

### 4. i18n

**`src/renderer/i18n/index.ts`** — `contextUsage` 段加 `compact: '压缩' / 'Compact'` 两语言对齐（受 `i18n-completeness.test.ts` 校验，两边都要加）。

### 5. 类型声明

**`src/renderer/global.d.ts`** — `claude` 命名空间加 `compactContext(localSessionId: string): Promise<void>`。

## 关键文件

- `src/main/claude-service.ts`（`compactContext` 新增 + `compact_boundary` 分支加占比刷新；`forwardEvent` 约 584-598）
- `src/main/index.ts`（IPC 注册，约 699 行附近）
- `src/preload/index.ts`（桥接，约 53 行附近）
- `src/renderer/components/ContextUsageRing.tsx`（`ContextUsagePanel` 加按钮）
- `src/renderer/components/InputBar.tsx`（传 props，约 661 行）
- `src/renderer/i18n/index.ts`（`contextUsage.compact`）
- `src/renderer/global.d.ts`（类型）

## 验证

1. **类型检查**：`npx tsc -p tsconfig.json --noEmit` 无错误。
2. **i18n 完整性**：`npx vitest run tests/i18n-completeness.test.ts` 通过（zh/en 都有 `contextUsage.compact`）。
3. **手动端到端**（dev 或打包版）：
   - 开一个有多轮对话的会话，记下占比环数值。
   - 点圆环 → 详情面板 → 点【压缩】→ 应看到「正在压缩上下文…」notice → 完成后「已手动压缩：pre → post tokens」notice，post 明显小于 pre。
   - **占比环立即下降**到 post 附近（验证 context-usage 刷新闭环）。
   - 流式中按钮禁用；空会话按钮禁用。
   - 对话历史中**不出现** `/compact` 这条用户消息（验证绕开了 doSend）。
4. **回归**：`npx vitest run` 现有用例不新增失败（已知 3 个 pre-existing 失败文件与本改动无关）。
