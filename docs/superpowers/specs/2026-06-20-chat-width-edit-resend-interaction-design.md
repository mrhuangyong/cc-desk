# 对话宽度、消息编辑重发、交互行为修复 设计

> 日期：2026-06-20
> 状态：待实现

## 背景

三个相互独立的需求：

1. 对话区域宽度偏窄（固定 800px），需要加宽并可调节
2. 缺少「编辑最后一条用户消息并重发」的能力
3. 设置中虽有「队列/引导」交互模式，但任务执行阶段无法发送消息（bug）

## 需求1：对话宽度分档可调

### 现状

`src/renderer/index.css:122` 静态定义 `--chat-max-width: 800px`，ChatArea 和 InputDock 均通过 `maxWidth: 'var(--chat-max-width)'` 引用。

### 设计

**新增 settings 字段 `chatWidth`**（字符串，档位 id），四档：

| 档位 id   | 宽度   | 默认 |
|-----------|--------|------|
| `compact` | 760px  |      |
| `standard`| 880px  |      |
| `wide`    | 960px  | ✓    |
| `xwide`   | 1080px |      |

**应用方式**：App.tsx 中新增 useEffect，监听 `state.settings.chatWidth`，动态写入 CSS 变量：

```tsx
const chatWidthPx = (() => {
  const w = state.settings.chatWidth
  return w === 'compact' ? 760 : w === 'standard' ? 880 : w === 'xwide' ? 1080 : 960
})()
useEffect(() => {
  document.documentElement.style.setProperty('--chat-max-width', `${chatWidthPx}px`)
}, [chatWidthPx])
```

覆盖 index.css 的 `:root` 静态值。index.css 的 `:root` 值改为 `960px`（默认值，JS 未执行时兜底）。

**UI**：GeneralSettings「外观」卡片中，「界面缩放」下方新增一行「对话宽度」，用现有 `Segmented` 控件，四个选项。中英文案：
- zh-CN: 紧凑 / 标准 / 宽松 / 超宽
- en: Compact / Standard / Wide / X-Wide

**改动文件**：
- `src/main/settings-store.ts`：schema 加 `chatWidth`，defaults 加 `chatWidth: 'wide'`，withDefaults 标量列表加 `chatWidth`
- `src/renderer/types.ts`：Settings 加 `chatWidth: string`
- `src/renderer/App.tsx`：useEffect 应用 CSS 变量
- `src/renderer/components/settings/GeneralSettings.tsx`：Segmented 控件
- `src/renderer/index.css`：`:root` 默认值改为 960px
- `src/renderer/i18n/`：中英文案

## 需求2：最后一条用户消息编辑重发

### 设计

**触发条件**：
- 当前会话非流式（`!isStreaming`）
- 鼠标 hover 到当前会话**最后一条用户消息**时，气泡左下角显示铅笔编辑图标（lucide `Pencil`）
- 非最后一条用户消息不显示编辑按钮

**编辑交互（就地编辑）**：
- 点击铅笔 → 用户气泡内容替换为可编辑区域（复用 `PromptEditor`，保持 @ 提及、/ 命令一致性）
- 编辑区下方显示「取消」和「发送」（重发图标）两个按钮
- 取消：恢复原气泡内容
- 发送：
  1. 从历史中删除该用户消息及其之后的**所有消息**（AI 回复、工具卡片等）
  2. 用编辑后的文本作为新用户消息发送（走 `doSend` 等价逻辑）
  3. 清空编辑态

**状态管理**：
- `AppState` 新增 `editingMessageId: string | null`
- Action `SET_EDITING_MESSAGE { messageId: string | null }`
- 发送或取消后置 null

**边界**：
- 空文本不可发送（和输入框一致，canSend 检查）
- 编辑态下最后一条用户消息的 hover 编辑图标隐藏

**改动文件**：
- `src/renderer/state/types.ts`（AppState）、`reducer.ts`、`actions.ts`：新增 editingMessageId
- `src/renderer/components/ChatArea.tsx`：用户消息渲染区加 hover 编辑按钮 + 就地编辑态渲染 + 编辑发送逻辑
- 编辑发送需删除该消息及后续所有消息：新增 reducer action `EDIT_RESEND`（或复用 DELETE_MESSAGE_RANGE）

## 需求3：交互行为修复 + 队列编辑

### 3a. Bug 修复：任务执行阶段无法发送消息

**根因**：`onSendClick` 在 `isStreaming` 时直接 `handleStop()` 并 return，永远不会走 `handleSend` 的 queue/interrupt 分支。Enter 键也调用 `onSendClick`，同样失效。

**修复方案**：

```tsx
// InputBar.tsx
const onSendClick = () => {
  if (!canSend) {
    if (isStreaming) handleStop()
    return
  }
  // 有内容时，无论是否流式都走 handleSend（queue/interrupt 分支会接管）
  handleSend()
}
```

**按钮图标逻辑调整**（方案 A：有内容显示发送，无内容显示停止）：

```tsx
// 圆形按钮：isStreaming && !canSend 时显示停止图标，其余显示发送图标
{isStreaming && !canSend ? <Square size={12} /> : <ArrowUp size={14} />}
```

颜色逻辑同步：`isStreaming && !canSend` 或 `canSend` 时高亮（accent），否则暗色。

### 3b. 命名调整

设置界面「交互行为」选项：
- `queue` →「队列」（不变）
- `interrupt` →「引导」（底层值改为 `guide`）

**旧值兼容**：settings-store 的 `withDefaults` 中，读取时若 `queueMode === 'interrupt'` 自动映射为 `guide`。

描述文案更新：
- 队列："运行中将后续消息加入队列，任务完成后逐条发送"
- 引导："运行中发送的消息会立即中断当前任务并优先处理"

**改动文件**：
- `src/main/settings-store.ts`：默认值 `queueMode: 'queue'`，withDefaults 加 interrupt→guide 映射
- `src/renderer/components/settings/GeneralSettings.tsx`：选项文案和值改为 queue/guide
- `src/renderer/components/InputBar.tsx`：`queueMode === 'interrupt'` 改为 `queueMode === 'guide'`
- `src/renderer/i18n/`：描述文案

### 3c. 队列消息编辑操作

队列列表每条消息的操作从 `[立即] [×]` 改为 `[立即] [编辑] [×]`：

- **编辑**：该条队列消息就地变成可编辑文本框（普通 textarea，队列是纯文本），旁边「保存」「取消」
- 保存：dispatch `UPDATE_QUEUED_MESSAGE` 更新 prompt
- 取消：恢复原样
- 编辑态：`AppState` 新增 `editingQueueId: string | null`

**改动文件**：
- `src/renderer/types.ts`：AppState 加 `editingQueueId`
- `src/renderer/state/reducer.ts`、`actions.ts`：新增 `SET_EDITING_QUEUE`、`UPDATE_QUEUED_MESSAGE`
- `src/renderer/components/InputBar.tsx`：队列列表渲染加编辑态

## 测试计划

- **需求1**：ChatArea 宽度随 chatWidth 档位变化（组件测试 mock CSS 变量）；Segmented 切换持久化
- **需求2**：非流式时最后一条用户消息显示编辑按钮；点击进入编辑态；发送后正确删除后续消息并发新消息；空文本不可发
- **需求3a**：流式 + 有内容 → 点发送走 queue/guide 分支（队列模式进队列，引导模式中断重发）；流式 + 无内容 → 点发送停止任务；按钮图标三态正确
- **需求3b**：旧 `interrupt` 值加载时映射为 `guide`；设置页显示「引导」
- **需求3c**：队列编辑保存更新 prompt；取消恢复；编辑态不显示编辑按钮

## 风险

- 需求2 删除后续消息时需同步清理 streaming/backendTask/plan 等按 session 分片的状态，避免残留导致 UI 串台
- 需求3a interrupt→guide 的值迁移需确保旧 settings.json 加载时正确转换
