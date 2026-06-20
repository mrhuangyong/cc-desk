# Hooks 设置真实接入设计

> 日期：2026-06-20
> 分支：dev
> 前置：通知功能已基于 cc-desk 内置实现，hooks 设置页现为空壳（7 事件简单开关），需完整还原 Claude 原生 hooks 管理能力。

## 目标

完整还原 Claude 原生 hooks 管理：27 个事件类型全量支持，4 种 hook 类型（command/prompt/agent/http）统一表单编辑，事件驱动主从布局 + 分组事件列表 + 列表/JSON 双视图。区分自定义 hooks 与插件贡献 hooks（插件来源只读）。

## 现状

- `HooksSettings.tsx`（30 行）：复用 `EntryListSection`，7 个事件类型的 checkbox 列表，只能切换「有没有配置」。
- `claude-config.ts` 的 `getHooks` / `setHookEnabled`：简化逻辑，toggle = 该事件数组写空占位 / 清空。
- Claude 原生 hooks 结构（来自 `claude-code-bak` 源码）：
  - 27 个事件：PreToolUse / PostToolUse / PostToolUseFailure / Notification / UserPromptSubmit / SessionStart / SessionEnd / Stop / StopFailure / SubagentStart / SubagentStop / PreCompact / PostCompact / PermissionRequest / PermissionDenied / Setup / TeammateIdle / TaskCreated / TaskCompleted / Elicitation / ElicitationResult / ConfigChange / WorktreeCreate / WorktreeRemove / InstructionsLoaded / CwdChanged / FileChanged
  - 配置结构：`{ <EventName>: [{ matcher: string, hooks: HookEntry[] }] }`
  - 4 种 hook 类型：command / prompt / agent / http

## 架构

三层结构：

### 数据层（`src/main/claude-config.ts`）

重写 hooks 读写，废弃 `setHookEnabled`，新增细粒度接口。

#### 数据模型

```typescript
// hook 单条配置（4 种类型的联合）
type HookEntry = CommandHook | PromptHook | AgentHook | HttpHook
// command: { type:'command', command, if?, shell?, timeout?, statusMessage?, once?, async?, asyncRewake? }
// prompt:  { type:'prompt', prompt, if?, timeout?, model?, statusMessage?, once? }
// agent:   { type:'agent', prompt, if?, timeout?, model?, statusMessage?, once? }
// http:    { type:'http', url, if?, timeout?, headers?, allowedEnvVars?, statusMessage?, once? }

// matcher 配置
interface HookMatcher {
  matcher: string          // 工具名模式，如 "Bash(git *)"，可空
  hooks: HookEntry[]
}

// 事件分组的展示模型（列表视图用）
interface HookEventView {
  eventName: string
  group: 'tool' | 'session' | 'task' | 'permission' | 'system'
  matchers: HookMatcher[]
  source: 'custom' | string   // 'custom' 或 'plugin:插件名'
  isReadonly: boolean         // 插件来源为 true
}
```

#### 事件分组

- **工具（tool）**：PreToolUse / PostToolUse / PostToolUseFailure
- **会话（session）**：UserPromptSubmit / SessionStart / SessionEnd / PreCompact / PostCompact
- **任务（task）**：Stop / StopFailure / SubagentStart / SubagentStop / TaskCreated / TaskCompleted
- **权限（permission）**：PermissionRequest / PermissionDenied / Elicitation / ElicitationResult
- **系统（system）**：Notification / Setup / TeammateIdle / ConfigChange / WorktreeCreate / WorktreeRemove / InstructionsLoaded / CwdChanged / FileChanged

#### 函数

- `getHooksFull()`：读 settings.json 的 hooks 字段 + 插件贡献 hooks，返回 `{ custom: HookEventView[], plugins: HookEventView[] }`。
- `getPluginHooks()`：遍历已安装插件 manifest 的 hooks 字段，返回插件贡献的 hooks 配置。
- `saveHooks(hooksObj)`：整体写回 settings.json 的 hooks 字段，写前做结构校验（事件名合法 + hook 类型合法 + 必填字段非空）。
- `getHooksJson()`：返回 hooks 字段原始 JSON 文本。
- `saveHooksJson(jsonText)`：解析 JSON 文本 → 校验 → 写回。

### IPC 层（`src/main/index.ts` + `src/preload/index.ts` + `src/renderer/global.d.ts`）

- `cc:hooks:get` → 改为返回 `{ custom: HookEventView[], plugins: HookEventView[] }`
- `cc:hooks:save`（新增）→ 接收完整 hooks 对象写回，保存前结构校验
- `cc:hooks:get-json`（新增）→ 返回 hooks 字段原始 JSON 文本
- `cc:hooks:save-json`（新增）→ 接收 JSON 文本，解析校验后写回
- 旧 `cc:hook:set-enabled` 废弃删除

### 视图层（`src/renderer/components/settings/`）

#### HooksSettings.tsx（主组件，重写）

- 顶部 segmented control 切「列表 / JSON」视图
- 顶部右侧「新建 Hook」按钮（仅列表视图显示）
- **列表视图**：左侧事件列表（按 5 组折叠，每组显示已配置数量角标）+ 搜索框；右侧选中事件的 matcher 列表
- **JSON 视图**：全宽 textarea + 保存按钮 + 校验错误提示
- 自定义 hooks 和插件 hooks 在事件列表用不同颜色区分：自定义黑色事件名，插件来源灰色 + 来源标签（如「来自 superpowers」）
- 列表视图的改动实时同步刷新 JSON 视图内容

#### HookMatcherList.tsx（右侧编辑区，新增组件）

- 展示选中事件下的每个 matcher 块
- 每个 matcher 块显示 matcher 模式 + 下面的 hooks 列表
- 每条 hook 显示类型图标（command/http/prompt/agent）+ 摘要文本
- 插件来源的 matcher 整块只读，不显示编辑/删除按钮
- 自定义 matcher 的每条 hook 有编辑、删除按钮；matcher 块底部有「添加 hook」按钮

#### HookEditDialog.tsx（编辑弹窗，新增组件）

- 类型选择器（command/prompt/agent/http 四个 tab）
- 切换类型时表单字段切换：
  - command：command 文本框、timeout（数字）、shell 选择器、if 条件、async 开关、asyncRewake 开关、statusMessage
  - http：url、headers（key=value 多行）、allowedEnvVars（逗号分隔）、timeout
  - prompt：prompt 文本域、model、timeout
  - agent：prompt 文本域、model、timeout
- 公共字段：if 条件、timeout、statusMessage、once 开关
- 弹窗内自带保存/取消，保存时前端做必填字段校验

## 错误处理

- JSON 视图保存时解析失败 → 显示具体错误（行号或字段名），不写入文件，textarea 内容保留让用户修正
- 校验失败（未知事件名 / 未知 hook 类型 / 必填字段空）→ 红色错误提示列出所有问题，阻止保存
- IPC 读写失败 → 列表视图显示加载失败提示 + 重试按钮；JSON 视图显示错误
- 插件 hooks 读取失败 → 插件来源的 hooks 显示为空，不影响自定义 hooks 正常展示（降级隔离）

## 测试

跟现有测试一致用隔离临时 HOME（`os.tmpdir()`）+ `vi.resetModules()`。

- 后端 `claude-config.ts`：
  - hooks 解析（空配置 / 正常配置 / 含插件 hooks）
  - 保存（结构校验通过 / 拒绝未知事件名 / 拒绝未知 hook 类型）
  - JSON 文本读写往返一致性
- 前端 `HooksSettings`：
  - 事件分组渲染
  - 列表 / JSON 视图切换
  - 插件 hooks 只读标记
  - 新建 / 编辑 / 删除 matcher 流程

## 存储边界

所有配置读写落在 `CLAUDE_CONFIG_DIR`（`~/.cc-desk/claude/settings.json`），不碰 `~/.claude`。插件 hooks 读取自 `plugins/cache/<marketplace>/<plugin>/<version>/.claude-plugin/plugin.json` 的 hooks 字段。
