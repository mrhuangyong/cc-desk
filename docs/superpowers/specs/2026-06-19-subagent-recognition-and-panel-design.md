# Subagent 识别与悬浮面板改造设计

日期: 2026-06-19
状态: 已确认,待写实施计划

## 背景

cc-desk 右上角悬浮面板(BackendTaskPanel)从未在用户运行中出现过。排查发现数据通路存在三层漏洞,导致 `tasks` / `backendTasks` 几乎永远为空,而面板挂载条件是 `tasks.length > 0 || backendTasks.length > 0`,因此面板永不挂载。

同时存在三个产品诉求:
- A. 正确识别 subagent(Task 工具 spawn 的子代理),目前它被误归为"普通 Task",辨识度不足。
- B. 让 subagent 也进入右上角悬浮面板。
- C. subagent 自己产生的对话输出(thinking/文本/tool 调用)当前全部混在主对话流里,需要分离。

### 现状数据流

- `BackendTaskRegistry`(backend-task-registry.ts)只接收 `task_type === 'local_workflow'` 的事件,产出 `BackendTask`,经 `claude:backend-task` IPC 推给 BackendTaskCard。
- `claude:task` 通道目前承担两类:TodoWrite 的全量待办同步(todo_sync),以及非 local_workflow 的普通 Task 子任务(started/updated)。
- SDK 的 `SDKTaskStartedMessage`(sdk.d.ts:4105)实际字段:`task_type` 可选,值域含 `'subagent'` / `'local_workflow'` / `'shell'` / `'monitor'`;`subagent_type` 仅 Task 工具子代理才有。
- `SDKAssistantMessage`(sdk.d.ts:2708)带 `parent_tool_use_id` 和 `subagent_type?` / `task_description?`,可用于把子代理输出锚回主流并标识来源。

### 根因(面板不显示)

1. 漏洞 1 — claude-service.ts:396 仅 `task_type === 'local_workflow'` 进 registry;subagent(task_type='subagent' 或 subagent_type 非空)走 else 推 `claude:task`,不进任何已管理的生命周期通路。
2. 漏洞 2 — 走 claude:task 的 subagent 理论上能 UPSERT_TASK 进 tasksBySession,但 task_updated/notification 走 delegateTaskEvent 时 subagent 未注册导致 isManaged=false,链路脆弱。
3. 漏洞 3 — 用户实际跑过 subagent 但面板仍未出现,推断真实事件的 task_type/subagent_type 字面值与代码硬编码假设不符,需运行时取证校准。

## 选定方案:统一 BackendTask 模型 + kind 区分

三个诉求中 C(对话流分离)是体验最痛、也最容易过度设计的一环。本方案在数据层复用现有 BackendTaskRegistry 的生命周期管理,给模型加 `kind` 判别字段;对话流采用"主流折叠占位条 + 工具卡片详情抽屉"的折中分离,不改主消息数据结构。

与备选方案对比:
- 方案 1(三通道独立 + 对话流彻底重排):语义最纯但改动面最大,消息重排风险高。
- 方案 3(只修识别不分离对话流):不满足 C 诉求,是半成品。

## 第 1 节:数据模型与识别映射

### BackendTask 扩展 kind 字段

```typescript
export type BackendTaskKind = 'subagent' | 'workflow' | 'shell' | 'monitor'

export interface BackendTask {
  id: string
  localSessionId: string
  command: string         // task_started 的 description || prompt
  taskType?: string       // 保留原始 SDK task_type
  kind: BackendTaskKind   // 新增:归一化类型,驱动 UI 分区/图标
  subagentType?: string   // 新增:subagent 专属(如 general-purpose)
  status: BackendTaskStatus
  startedAt: number
  lastKnownAt: number
}
```

### 识别映射规则(resolveKind)

判定优先级:subagent_type 非空 > task_type 字面值。放在 registry 内部统一判定,不再在 claude-service 硬编码。

```typescript
function resolveKind(event: TaskStartedEvent): BackendTaskKind {
  if (event.subagent_type) return 'subagent'
  switch (event.task_type) {
    case 'local_workflow': return 'workflow'
    case 'shell':          return 'shell'
    case 'monitor':        return 'monitor'
    case 'subagent':       return 'subagent'   // 兜底:有的版本 task_type 直接是 'subagent'
    default:               return 'workflow'    // 未知归 workflow(保持旧行为)
  }
}
```

### claude-service.ts 放宽入注册表条件

`handleTaskStartedEvent` 改为:所有 task_started 事件都进 registry(无论 task_type),由 registry 内部按 resolveKind 分类。`claude:task` 通道此后只服务 TodoWrite(todo_sync),subagent 和 workflow 统一走 `claude:backend-task`。漏洞 1、2 一起堵上。

## 第 2 节:对话流分离(C 诉求)

核心:subagent 的对话输出从主流"折叠抽离",而非重排消息数据。

### 主进程 assistant 分流

claude-service.ts 的 case 'assistant' 检测 message.subagent_type。命中时不推主流的 claude:blocks assistant_blocks,改为推新轻量事件:

```typescript
webContents.send('claude:subagent-output', {
  localSessionId: lsid,
  toolUseId: parentToolUseId,      // 锚回触发它的 Task tool_use block
  subagentType: message.subagent_type,
  taskDescription: message.task_description,
  block: normalizeBetaBlocks(aContent),  // 子代理这条消息的完整 blocks
})
```

parent_tool_use_id 在 SDKAssistantMessage 已有,用于锚回主流里对应的 Task 工具卡片。

### 渲染端:主流折叠占位条

主流里那条 Task tool_use block(子代理入口)正常渲染成工具卡片。判定"有对应输出"的键:该 tool_use block 的 id 作为 toolUseId,查 subagentOutputBySession[sessionId][toolUseId] 是否非空。非空时卡片下方挂一个可折叠的"子代理输出"区:点开看子代理的 thinking/文本/tool 调用全文,默认折叠,主流保持干净。

### state 存储 subagentOutputBySession

```typescript
// reducer 新增
subagentOutputBySession: Record<string, Record<string, ContentBlock[]>>
// key: toolUseId(触发 subagent 的 Task tool_use id)
// value: 该 subagent 产生的所有 blocks,按到达顺序累积
```

子代理输出不进主 messages[].content,主消息结构零改动,仅工具卡片多一个详情抽屉。

决策:默认折叠;运行期态,不持久化(与 tasksBySession / backendTasksBySession 一致)。

## 第 3 节:面板三段式 UI

BackendTaskPanel 升级为三段式:任务卡(todo)→ 子代理卡 → 后台任务卡。

### 分区逻辑

backendTasks 按 kind 拆两路,数据通路不变,渲染层分流:

```typescript
const subagents = backendTasks.filter(t => t.kind === 'subagent')
const backends  = backendTasks.filter(t => t.kind !== 'subagent')
const subagentVisible = showBackendTask && subagents.length > 0
const bgVisible       = showBackendTask && backends.length > 0
const taskVisible     = showTodo && tasks.length > 0
if (!taskVisible && !subagentVisible && !bgVisible) return null
```

### SubagentCard(新增)

复用现有卡片骨架(圆角浮层 + 折叠头 + 列表):
- 标题「子代理」,专属图标 lucide `Bot`,与后台命令区分语义。
- 头部统计:N 运行 · M 完成 · 共 K(沿用 TaskCard 风格)。
- 每行:状态图标 + 描述(任务描述)+ subagentType 小标签(如 general-purpose)+ 状态文字。
- 运行中保留终止按钮(复用现有 onKill → manager.stopTask),结束的可移除。

### 折叠状态扩展

panelFold 从 { root, taskCard, backendTaskCard } 扩为 { root, taskCard, subagentCard, backendTaskCard };SET_PANEL_FOLD action 的 panel 联合类型同步加 'subagentCard'。三张卡各自独立折叠。

### 面板与对话流联动(轻量)

SubagentCard 单条点击时,尝试滚动定位到对话流里对应的 Task tool_use 卡片(toolUseId 锚定)并自动展开子代理输出区。把第 2 节的折叠占位条和面板串起来。若定位失败(卡片不在可视区/已虚拟化)静默无操作,不报错。

## 第 4 节:根因排查与调试验证

### 第 1 步:临时调试日志抓真实事件样本

claude-service.ts 的 case 'system' 顶部,对 task_* subtype 打结构化日志:

```typescript
if (subtype?.startsWith('task_')) {
  console.log('[cc-desk][debug] task event', {
    subtype, task_id: sys.task_id, task_type: sys.task_type,
    subagent_type: sys.subagent_type, description: sys.description,
  })
}
```

运行一次真实 Task/subagent 调用,用真实字面值校准 resolveKind 映射;与假设不符当场修正。

### 第 2 步:验证面板挂载

用第 1 步抓到的事件构造最小测试:直接 dispatch UPSERT_BACKEND_TASK 带 kind: 'subagent',确认三段式面板渲染、卡片显示、折叠/终止/移除可用。不依赖 SDK。

### 第 3 步:真机 e2e 验证

在 tests/e2e-real-model.test.ts 模式上加一条:发起会触发 subagent 的 prompt(如"用 Task 工具并行跑两个子代理检查 A 和 B"),断言:
- 面板挂载,SubagentCard 出现,计数正确。
- 主流里 Task 工具卡片挂载,子代理输出区可展开。
- 子代理完成后面板状态更新为已完成。

### 第 4 步:调试日志去留

真实事件校准完成后,把第 1 步的 console.log 降级成受开关控制的日志或直接移除,不留在生产路径。

### 失败兜底

若 e2e 中 subagent 无法触发(第三方代理不支持 Task 工具),退回第 2 步单元测试覆盖,并在文档标注"subagent 能力依赖模型/代理支持 Task 工具"。

## 非目标

- 不持久化 subagent 输出(与 tasks/backendTasks 同为运行期态)。
- 不重排主对话流消息数据结构(只挂折叠抽屉)。
- 不动 TodoWrite 任务卡和 BackendTaskCard 的既有行为,仅做分区与类型扩展。

## 受影响文件(预估)

- src/main/backend-task-registry.ts — 加 kind/subagentType,resolveKind,放宽 handleTaskStarted。
- src/main/claude-service.ts — task_started 全进 registry;assistant 分流 subagent_type;临时调试日志。
- src/preload/index.ts — 新 claude:subagent-output 通道。
- src/renderer/types.ts — BackendTaskKind, subagentType 字段(与 main 对齐)。
- src/renderer/state/reducer.ts + actions.ts + store.tsx — subagentOutputBySession, panelFold 扩展。
- src/renderer/components/BackendTaskPanel.tsx — 三段式分区。
- src/renderer/components/SubagentCard.tsx — 新增。
- src/renderer/components/blocks/ — Task 工具卡片挂子代理输出折叠区。
- tests/ — registry 新映射、reducer、面板渲染、e2e subagent。
