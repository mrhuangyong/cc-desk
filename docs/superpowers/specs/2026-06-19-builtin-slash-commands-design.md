# 内置 Slash 命令补全设计

**日期**：2026-06-19
**状态**：已与用户确认，待实现

## 背景与问题

对话输入框的 `/` 菜单当前只包含两类来源：

1. **已启用插件**的 `commands/` 目录
2. `~/.claude/commands/` 用户自定义命令

它们的来源是主进程 `getCommands()`（`src/main/claude-config.ts:307`），逻辑为：

```ts
for (const p of plugins) {
  if (!p.enabled) continue
  out.push(...await scanCommandsInDir(join(p.installPath, 'commands'), ...))
}
out.push(...await scanCommandsInDir(join(CLAUDE_DIR, 'commands'), 'user', true))
```

而 Claude Code 的**内置 slash 命令**（`/init`、`/compact`、`/clear`、`/review`、`/agents`、`/cost`、`/memory`、`/vim`、`/login` 等）不是文件系统里的 markdown，是 CLI 行为，因此**一个都没出现在 `/` 菜单里**。

用户诉求：把内置命令补进 `/` 菜单，且**尽可能完整复刻 CLI 行为**。

## 关键约束与现状

### cc-desk 跑在 Claude Agent SDK 上，不是交互式 CLI

会话由 `SessionQueryManager`（`src/main/session-query-manager.ts`）用 `@anthropic-ai/claude-agent-sdk` 的 `Query` 驱动。因此内置命令分两类性质：

- **SDK / 本地能力能真实复刻**的 → 接真实动作
- **纯 CLI 交互层行为**（`/vim` 切编辑模式、`/terminal-setup` 装 shell 集成、`/login`/`/logout` OAuth、`/doctor` 终端诊断）→ SDK 端无对等能力，**不收录**

### 已发现的关联 bug：权限/思考下拉是 UI 摆设

调查 `/permissions` 时发现：InputBar 的权限下拉 `['变更前确认','自动编辑','计划模式','完全访问']`（`InputBar.tsx:12/82`）和思考下拉 `['minimal','standard','thorough']`（`:13/83`，默认 `'standard'`）都是纯 UI，从未传入 `window.api.claude.send()`，`claude-service.ts:124` 写死 `permissionMode: 'auto'`，`query()` options 也无 `effort`/`thinking`。

**SDK 真实接口**（已查 `@anthropic-ai/claude-agent-sdk/sdk.d.ts`）：

权限 `permissionMode`：

| 中文标签 | SDK code |
|---|---|
| 变更前确认 | `default` |
| 自动编辑 | `acceptEdits` |
| 计划模式 | `plan` |
| 完全访问 | `bypassPermissions` |

思考强度走 **`effort`** 参数（`EffortLevel = 'low'|'medium'|'high'|'xhigh'|'max'`），配合 `thinking:{type:'adaptive'}` 让模型自适应。**下拉直接用 SDK 原生词**（不自造 minimal/standard/thorough），即 `InputBar.tsx:13` 的 `THINKINGS` 改为 `['low','medium','high']`，默认值改为 `'medium'`。本期顺带打通 permission + thinking 两条链路（用户确认），让 `/permissions` 真正生效。

## 设计决策（已确认）

1. **行为**：尽可能完整复刻，但**只收录能做到的**（真接动作 + 可转译 prompt），纯 CLI 行为不收录。
2. **菜单**：内置命令与现有插件命令/技能**合并到一个 `/` 菜单，分组区分**（内置 / 命令 / 技能）。
3. **范围**：**一期做完全部档①**（含需新写逻辑的 `/compact` `/init` `/cost` `/export` `/add-dir` `/status` `/review`），不拆期。
4. **`/compact`**：调 SDK 跑摘要 query（真复刻），非本地截断。
5. **`/permissions`**：打开输入栏的权限下拉（下拉已打通真生效）。
6. **`/review`**：插入触发文本（如 `/code-review`）发起，不直接调度。
7. **permission/thinking**：**会话级持久化**（存进 `Session` 字段）。thinking 下拉改为 SDK 原生词 `low/medium/high`（默认 `medium`），对应 `query()` 的 `effort` + `thinking:{type:'adaptive'}`。
8. **流式约束**：`/clear` 流式中可执行（先 stop 再清）；`/compact` 流式中**禁用（灰显）**。
9. **`/init` 覆盖**：`cwd/CLAUDE.md` 已存在 → 原生 dialog 问是否覆盖。
10. **`/agents`**：cc-desk 当前**无** agents 面板/入口，本期**降级为插入文本档**（或暂不收录，见下）。

## 命令数据模型

### `SlashMenuItem` 扩展第三个 kind

```ts
// src/renderer/editor/types.ts
export interface SlashMenuItem {
  kind: 'command' | 'skill' | 'builtin'
  id: string
  name: string
  desc: string
  builtinAction?: BuiltinAction   // 仅 builtin 有
}

export type BuiltinAction =
  | { type: 'open-settings'; section: SettingsSection }  // /config /mcp /hooks /model
  | { type: 'open-permission-menu' }                     // /permissions
  | { type: 'clear-session' }                            // /clear
  | { type: 'compact' }                                  // /compact
  | { type: 'show-cost' }                                // /cost
  | { type: 'init-project' }                             // /init
  | { type: 'add-dir' }                                  // /add-dir
  | { type: 'export-session' }                           // /export
  | { type: 'show-status' }                              // /status
  | { type: 'resume' }                                   // /resume
  | { type: 'run-review' }                               // /review
  | { type: 'insert-text' }                              // /release-notes /feedback /bug /agents(降级)
```

### 主进程静态注册表

新增 `getBuiltinCommands(): ClaudeBuiltinCommand[]`（静态表，17 条），`getCommands()` 改为：

```ts
return [...builtin, ...pluginCmds, ...userCmds]
```

`window.api.cc.commands.get()` 自动带回内置命令。

### 菜单分组

`SuggestionMenu` 已支持 `groupKey/groupLabel`。`SlashSuggestion` 的 `groupKey` 按 `kind` 分组：`builtin` → 标题"内置"；`command` → "命令"；`skill` → "技能"。内置与插件/用户命令天然分开（前者 kind=`builtin`，后者 kind=`command`）。

## 执行链路（选中 → 副作用）

### TipTap command 回调分流

`buildSlashExtension`（`SlashSuggestion.tsx`）的 `command` 回调新增 `builtin` 分支：

```ts
command: ({ editor, range, props }) => {
  if (props.kind === 'builtin') {
    editor.chain().focus().deleteRange(range).run()   // 删触发符，不插内容
    onBuiltinRun?.(props)                              // 副作用交给渲染端
    return
  }
  if (props.kind === 'command') { /* 原逻辑：插文本 */ }
  else { /* skill：插 chip */ }
}
```

`buildSlashExtension` 增加可选参数 `onBuiltinRun: (item: SlashMenuItem) => void`，由 `PromptEditor` 从 `InputBar` 透传。

### 渲染端 handler 注册表

在 `src/renderer/components/builtinCommands.ts`（新文件）维护 `builtinHandlers`，`builtinAction.type` → handler：

| action.type | 落地 |
|---|---|
| `open-settings` | `dispatch({ type:'SET_SETTINGS_SECTION', section })` |
| `open-permission-menu` | `toggleMenu('permission')`（InputBar 注入） |
| `clear-session` | `window.api.claude.stop(sessionId)` → `dispatch CLEAR_SESSION_MESSAGES` |
| `compact` | `window.api.cc.builtin.compact(sessionId)` |
| `show-cost` | `dispatch SHOW_COST` |
| `init-project` | `window.api.cc.builtin.init({ cwd })` |
| `add-dir` | `dir = await dialog.openDirectory()` → `cc.builtin.addDir({sessionId,dir})` |
| `export-session` | `window.api.cc.builtin.export({ localSessionId })` |
| `show-status` | toast：model / cwd / resume 状态 |
| `resume` | 聚焦会话侧栏（已有会话列表） |
| `run-review` | `editor.chain().insertContent('/code-review ').run()` |
| `insert-text` | `editor.chain().insertContent(name + ' ').run()` |

`BuiltinCtx` 注入：`dispatch` / `sessionId` / `session` / `cwd` / `modelCfg` / `editor` / `toggleMenu` / `toast`。

### 主进程 IPC `cc.builtin.*`

- `compact(localSessionId)` — 读该会话消息，调 SDK 摘要 query 生成总结 → 通过 `onNotice` 推 `kind:'compact'` + 触发 `REPLACE_HISTORY` 替换历史（**保留最近 6 条原文** + 一条摘要 notice）。
- `init({ cwd })` — 跑一次 SDK query 生成 CLAUDE.md；已存在则 `dialog.showMessageBox` 问覆盖。
- `export({ localSessionId })` — 序列化消息为 markdown，`dialog.showSaveDialog` 写文件。
- `addDir({ localSessionId, dir })` — 校验目录存在，记录到会话 `extraDirs`，后续 `send` 带上（等价 `--add-dir`）。

### permission / thinking 链路打通

**映射表**（权限需翻译；thinking 下拉已是 SDK 原生词，无需映射）：

```ts
const PERMISSION_MODE_MAP = {
  '变更前确认': 'default',
  '自动编辑':   'acceptEdits',
  '计划模式':   'plan',
  '完全访问':   'bypassPermissions',
}
// thinking 下拉直接是 EffortLevel：'low' | 'medium' | 'high'，原样传给 effort
```

**链路**：
1. `Session` 加字段 `permissionMode?: string` / `thinking?: 'low'|'medium'|'high'` / `extraDirs?: string[]`（会话级持久化）。
2. InputBar 权限下拉改读写当前 session 的 `permissionMode`；思考下拉 `THINKINGS` 改为 `['low','medium','high']`、默认 `'medium'`，改读写 session 的 `thinking`；切换时 `dispatch SET_SESSION_PERMISSION / SET_SESSION_THINKING`。
3. `doSend()` / 队列发送 / `sendQueuedNow` 三处 `claude.send` opts 加 `permission` / `thinking`。
4. `ClaudeAPI.send` opts 类型加 `permission?: string; thinking?: 'low'|'medium'|'high'`。
5. `ClaudeService.send()` 签名加两字段；`buildQuery` 里 `permissionMode` 改读 `PERMISSION_MODE_MAP[opts.permission] ?? 'default'`，加 `effort: opts.thinking ?? 'medium'` 与 `thinking: { type: 'adaptive' }`；**删除 `:124` 硬编码 `'auto'`**。

## reducer 新增 action

- `CLEAR_SESSION_MESSAGES` — 清空指定 session 的 `messages`，保留 session/tabs/claudeSessionMap。
- `COMPACT_DONE` — `{ summary, keepRecentIds }`：用摘要替换历史，保留最近 N 条。
- `SHOW_COST` — 给当前会话插一条 `SystemNotice{kind:'status', text:总费用/turns}`。
- `ADD_SESSION_DIR` — 会话级追加 `extraDirs`。
- `SET_SESSION_PERMISSION` / `SET_SESSION_THINKING` — 写会话字段。

## 错误处理与状态反馈

统一用现有 `SystemNotice` 通道或 toast，避免静默失败：

| 命令 | 成功 | 失败 |
|---|---|---|
| `/clear` | 清空即时 | stop 失败仍清本地 |
| `/compact` | notice"已压缩 N 条" | 摘要失败 → notice error，历史不动 |
| `/cost` | notice 总费用/turns | 无数据 → "暂无费用统计" |
| `/init` | toast"已生成 CLAUDE.md" | 已存在问覆盖；写失败 toast |
| `/export` | toast"已导出至 xxx" | 取消静默；写失败 toast |
| `/add-dir` | notice"已追加 xxx" | 取消静默；无效 toast |
| `/status` | toast model/cwd/resume | 无可显示仍显示部分 |
| 跳面板 / 插入文本 | 视觉即时 | 无失败路径 |

**流式约束**：
- `/compact` 流式中**灰显**（不可选）——替换历史上下文会破坏进行中的会话。
- `/clear` 流式中可执行（先 stop 再清）。
- `/init` `/export` 不碰当前流，流式中可用。

## 命令收录终稿（17 条）

| 分组 | 命令 | action.type |
|---|---|---|
| 跳面板 | `/config` `/model` `/mcp` `/hooks` | `open-settings` |
| 跳面板 | `/permissions` | `open-permission-menu` |
| 会话 | `/clear` | `clear-session` |
| 会话 | `/compact` | `compact`（流式禁用） |
| 会话 | `/cost` | `show-cost` |
| IPC | `/init` | `init-project`（已存在问覆盖） |
| IPC | `/export` | `export-session` |
| IPC | `/add-dir` | `add-dir` |
| 渲染 | `/status` | `show-status` |
| 渲染 | `/resume` | `resume` |
| 文本 | `/review` | `run-review`（插 `/code-review`） |
| 文本 | `/release-notes` `/feedback` `/bug` `/agents`(降级) | `insert-text` |

> **`/agents` 降级说明**：cc-desk 当前无 agents 面板/入口，本期作为 `insert-text` 收录（点了插 `/agents` 文本发送）。若后续 cc-desk 增 agent 管理 UI，再升级为 `open-settings` 跳面板。

## 文件改动总览

**主进程**
- `src/main/claude-config.ts` — 新增 `getBuiltinCommands` + `ClaudeBuiltinCommand` 类型 + 两个映射表；`getCommands` 合并内置
- `src/main/claude-service.ts` — `send()` 加 permission/thinking；`buildQuery` 用映射替换硬编码；新增 `compact`/`init`/`export`/`addDir` 方法
- `src/main/index.ts` — 注册 `cc:builtin:*` IPC handler

**preload**
- `src/preload/index.ts` — `cc.builtin` 四方法；`claude.send` opts 类型

**渲染端**
- `src/renderer/types.ts` — `SlashMenuItem` 加 builtin + `Session` 加三字段
- `src/renderer/global.d.ts` — `ClaudeAPI.send` opts + `ClaudeConfigAPI.builtin`
- `src/renderer/editor/types.ts` / `SlashSuggestion.tsx` — `onBuiltinRun` 参数 + builtin 分流 + 分组标题 + compact 灰显
- `src/renderer/editor/PromptEditor.tsx` — 透传 `onBuiltinRun`
- `src/renderer/components/InputBar.tsx` — 下拉改读写会话字段；`THINKINGS` 改为 `['low','medium','high']`、默认 `'medium'`；send 三处传值；`onBuiltinRun` 注入
- `src/renderer/components/builtinCommands.ts`（新）— handler 注册表
- `src/renderer/state/reducer.ts` + `actions.ts` — 6 个新 action
- `src/renderer/editor/slashFilter.ts` — 确认 builtin kind 过滤（按需小改）

**测试**
- `tests/claude-config.test.ts` — `getBuiltinCommands` + 映射表
- `tests/reducer.test.ts` — 新 action 用例
- `tests/editor/slashFilter.test.ts` — builtin kind 过滤

## 测试策略

- 纯函数（注册表、映射表、reducer action、slashFilter）→ 自动化测试
- IPC（compact/init/export）涉及 SDK 与原生 dialog → 主进程集成或手工验证，spec 标注
- 权限/思考链路打通后 → 手工验证四档权限在 SDK 端真生效（default 弹确认、bypass 不弹等）

## 非目标（YAGNI）

- 不复刻纯 CLI 行为命令（`/vim` `/terminal-setup` `/login` `/logout` `/doctor`）。
- `/compact` 不保留可展开原文（只 notice 标注条数）。
- permission/thinking 不做全局默认（仅会话级）。
- `/agents` 不新建 agent 管理 UI（降级文本）。
