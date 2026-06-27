# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

cc-desk 是 **Claude Code 的桌面客户端**（Electron + React + TypeScript），把 Claude Agent SDK 包装成一个带文件树、终端、浏览器、代码审查多 Tab 的工作台。核心价值不在 UI，而在于对 SDK 流式事件、会话生命周期、以及隔离的 Claude 配置目录（`~/.cc-desk/claude`，与 SDK 运行时同目录）的桥接。

## Commands

```bash
pnpm install        # 安装；postinstall 会修 node-pty 的 spawn-helper 执行权限（见下）
pnpm dev            # electron-vite dev，热重载
pnpm build          # 生产构建到 out/
pnpm preview        # 预览生产构建（electron-vite preview）
pnpm test           # vitest run（默认套件，排除真机 e2e）
pnpm test:watch     # 监听模式
pnpm test:e2e       # 真机 e2e（tests/e2e-real-model.test.ts，需本地 ai-proxy + 真实模型，~50s）

# 单个测试文件 / 单个用例
npx vitest run tests/reducer.test.ts
npx vitest run -t "DELETE_SESSION 删除指定会话"
```

没有独立的 lint 脚本；类型检查靠 `tsc`（`tsconfig.json` 是 `noEmit`）。

## 测试约定（重要）

- 默认测试在 jsdom，setup 仅 `@testing-library/jest-dom/vitest`。
- **涉及落盘的主进程测试（`claude-config`、`cc-desk-store` 等）必须隔离 `CLAUDE_CONFIG_DIR`**：用 `withFakeConfigDir()` 工厂把它指向 `os.tmpdir()` 下的临时目录 + `vi.resetModules()` 动态重导入模块，绝不落真机 `~/.cc-desk/claude`。参考 `tests/claude-config-write.test.ts`（注意：cc-desk 的 Claude 配置已隔离在 `~/.cc-desk/claude`，不再碰 `~/.claude`，见下文「持久化」）。
- reducer/组件测试用 `tests/fixtures.ts` 的 `seedProjects`（p1=cc-desk 含 s1..s8，p2 含 s3）作为已知结构种子，不要各自造 mock 数据。
- 真机 e2e 文件内部用 `// @vitest-environment node` 声明 node 环境（jsdom 不适用），由独立 `vitest.e2e.config.ts` 收集。
- **测试涉及 `paths.ts` 的 dev/prod 判定时**：可设环境变量 `CC_DESK_DEV=1/0` 强制指定（`detectDevBuild` 优先读它），避免依赖 electron 运行时的 `app.isPackaged`。

## 发版与提交规范（硬约定）

- **Conventional Commits** 是强约束：`feat:` / `fix:` / `chore:` / `docs:` 等。`.github/workflows/release.yml` 在 push 到 `main` 时跑 `scripts/bump-version.mjs`（有测试 `tests/bump-version.test.ts`），按提交前缀推断版本 → 回写 `package.json` + 打 tag → 三平台并行构建发 GitHub Release。
- 提交信息含 `[skip release]` 则跳过发版（发版回写的那次提交自带此标记，防循环触发）。发版回写提交形如 `chore(release): v1.x.0 [skip release]`。
- **无本地 lint / 无 husky / 无 pre-commit hook**——commit 规范靠 CI 隐式强制。commit message 写错（非 Conventional 格式、漏 scope）会导致发版异常或被跳过，提交前自查。

## 架构

三进程标准 Electron：**main（Node）→ preload（contextBridge）→ renderer（React）**。所有跨进程调用都走 `window.api.*`（`src/preload/index.ts` 是唯一的桥，新增 IPC 必须在这里登记通道）。

### 流式对话是整个应用的核心（理解前不要动它）

不要把一次对话当成「调一次 `query()` 等结果」。会话是**长生命周期的持久 query**：

- `SessionQueryManager`（`src/main/session-query-manager.ts`）为每个 `localSessionId` 维护一个常驻的 `Query` + `PushController`。`PushController` 是个手写异步队列，让 SDK 的 `streamingInput: true` 能在多轮间持续接收用户消息。
- 中断用 `query.interrupt()` 而非杀子进程——**这是为了后台任务（Bash/Task 工具 auto-background）能跨多轮存活**。`claude:stop` IPC 触发 interrupt，并兜底发 `claude:aborted` 让渲染端清 streaming 状态。
- `ClaudeService`（`src/main/claude-service.ts`）是桥：`send()` → `manager.ensureSession` + `pushMessage`；事件转发逻辑注入 `buildQuery`。SDK 原始 message 经 `claude-normalize.ts`（`normalizeBetaBlocks` / `extractToolResults` / `mkNotice`）拍平为渲染端的 `ContentBlock` / `SystemNotice`。

**IPC 事件通道契约**（main `webContents.send` ↔ renderer 订阅，`localSessionId` 是路由键）：
`claude:system` / `claude:delta`（增量 text/thinking）/ `claude:blocks`（tool_use_start / assistant_blocks / tool_result；**计划卡片也走这条**，挂在 tool_result 的 payload 上，不是独立通道）/ `claude:task`（todo）/ `claude:backend-task`（后台任务 create/update）/ `claude:subagent-output`（子代理/Task 工具的 tool_use 与 tool_result，不进主流）/ `claude:builtin-result`（`/compact`、`/add-dir` 等内置命令的结果回报）/ `claude:notice`（系统提示 info/warn/error）/ `claude:notification`（通知推送）/ `claude:running-sessions`（在跑会话清单）/ `claude:result` / `claude:error` / `claude:aborted` / `claude:dialog-request`（见下）。

> 注：`preload/index.ts` 的 `removeAllListeners` 清单里还残留一个 `claude:plan`，但主进程**从不发送它**（僵尸通道）——计划实际随 `claude:blocks` 传递，别被 preload 清单误导。

### 用户提问/计划批准的挂起对话框

SDK 的 `onUserDialog`（阻塞式）和被 cc-desk 拦截的 `AskUserQuestion` tool_use，都走同一条路：`ClaudeService.askUserViaPanel` 发 `claude:dialog-request`，挂起一个 Promise（keyed by `reqId`），等渲染端经 `claude:dialog-response` IPC 回答后 resolve。AbortSignal 触发时回 `{behavior:'cancelled'}`。改这条链路时注意 AskUserQuestion 经代理未注册的已知坑——cc-desk 自行拦截它（参见 `handleAskUserQuestion`）。

### 渲染端状态

`src/renderer/state/` 是 React Context + `useReducer` 单一 store（不是 Redux）。`AppState` 大量使用 **按 session 分片的 map**（`tabsBySession` / `activeTabIdBySession` / `streamingBySession` / `queueBySession` / `tasksBySession` / `backendTasksBySession` / `subagentOutputBySession`（悬浮面板里子代理的实时进度：token/工具/摘要）/ `planBySession` / `abortedBySession`），因为同一时刻多个会话可并存。改 reducer 时要同步更新 `tests/reducer.test.ts` 里 `initialState()` 的全字段构造。

会话数据来自两条路：①启动时 `projects:get` 拉持久化快照 `HYDRATE`；②真实 Claude 事件流实时累积。store 只持有内存态，持久化由 `App.tsx` 防抖触发 `projects:save`。

### 持久化：三个独立存储，别混

应用数据全部收敛到 **`~/.cc-desk/`**（`src/main/paths.ts` 的 `CC_DESK_DIR`）。

**dev 版数据隔离**：边用边开发场景下 dev 版与正式版同时运行，若共用 `~/.cc-desk` 会导致
① 中继 `router.register` 同 deviceId 互相覆盖（连接被挤掉）② projects.json 并发写丢数据。
故 `paths.ts` 按 `app.isPackaged` 区分：**dev 版用 `~/.cc-desk-dev/`，正式版用 `~/.cc-desk/`**。
dev 版首次启动由 `migrate-dev.ts` 从正式版拷一份作起点（projects/settings/config），但**剥掉
config.json 的 remote 段**——dev 版要生成独立 relay deviceId，否则隔离就没意义。环境变量
`CC_DESK_DEV=1/0` 可强制覆盖判定；`CC_DESK_DIR` 仍优先（测试隔离）。
判定口径见 `paths.ts` 的 `detectDevBuild`（必须先确认 `process.versions.electron` 才信 app.isPackaged，
否则 vitest 桩对象会误判）。

| 文件 | 内容 | 模块 |
|------|------|------|
| `~/.cc-desk/settings.json` | electron-store 默认文件，UI 设置（主题/语言/缩放/代码预览等） | `settings-store.ts` |
| `~/.cc-desk/projects.json` | 工作区快照（项目/会话/消息/tab/sessionMap/lastSeq） | `projects-store.ts` |
| `~/.cc-desk/config.json` | **模型供应商配置**（providers/models/apiKey/baseUrl），ClaudeService 从此注入 SDK env | `cc-desk-store.ts` |

**`~/.claude/` 不再被读写**——cc-desk 的 Claude 配置**隔离**在 `~/.cc-desk/claude/`（`src/main/paths.ts` 的 `CLAUDE_CONFIG_DIR`，默认 `~/.cc-desk/claude`，可用 `process.env.CLAUDE_CONFIG_DIR` 覆盖/测试隔离）。这个目录与 Claude Agent SDK 运行时同目录，所以设置页所见即所生效。`claude-config.ts` 是设置页的数据源（**非 mock**），在此读写：`settings.json`（env/model/theme/language/enabledPlugins/hooks/permissions）、`.claude.json`（mcpServers + projects）、`plugins/installed_plugins.json`、各插件 manifest/skills/commands。

隔离的原因：SDK 会读 `~/.claude/settings.json`，其 env 块会**覆盖** `options.env` 注入的角色模型映射，导致 haiku 等后台子任务被 `~/.claude` 的模型配置劫持。迁到隔离目录后 cc-desk 完全自洽。首次启动由 `migrate-from-claude.ts`（在 `index.ts` 启动早期调用一次）把 `~/.claude` 的 plugins/skills/settings **一次性迁入**隔离目录，之后 `~/.claude` 仅作为迁移源、不再触碰。

写策略是**深合并 + 仅动受管字段**（append-only 思想，保留用户未知 key）。改写操作务必加测试验证「保留未知字段」。

### 终端

`PtyManager`（`pty-manager.ts`）用 node-pty 创建真实 shell，输出经 `webContents` 推到渲染端的 xterm.js。macOS 上有 PTY 孤儿进程的已知坑（退出时需显式 kill）。`postinstall` 的 `scripts/fix-pty-perm.js` 修 node-pty 1.1.0 prebuild 丢失 spawn-helper 执行位的 bug。

### 其他重要子系统（改动前先认模块）

- **配置迁移** `migrate-from-claude.ts`：首次启动把 `~/.claude` 一次性迁入隔离目录 `~/.cc-desk/claude`（见「持久化」），是「不再依赖 `~/.claude`」这条架构决策的执行点。
- **GUI 运行时 env 修复** `fix-env.ts`：GUI 启动时跑一次 login shell 补齐 PATH/env。**重要运行时坑**：`pnpm dev` 从终端起、继承 shell PATH；但打包分发版是从 Finder/Dock 起、没有 shell 环境，SDK 子进程会找不到 nvm/brew 装的命令（node/git/python 等）。「本地能跑、打包后报命令找不到」先查这里。
- **内置命令 + 权限映射** `builtin-commands.ts`：17 条内置 slash 命令的静态注册表，权限模式（`getPermissionMode`，中文标签 → SDK `permissionMode`）和思考强度（effort）在此与 SDK 衔接。
- **应用更新** `update-manager.ts` + `update:*` IPC（`update:state`/`update:check`/`update:install`/`update:download-and-open`）：mac 走下载 dmg，win/linux 走 autoUpdater。
- **插件市场** `marketplace-manager.ts` + `cc:marketplace:*`：git clone 插件源的增删改查搜。
- **悬浮任务面板**（README 头条特性）：可拖动图标/面板、位置记忆、方向性动画，展示后台任务与子代理实时进度。组件 `BackendTaskPanel.tsx` / `SubagentCard.tsx` / `SubagentDetailDrawer.tsx` + hooks `useDraggable` / `usePanelAnimation` / `useResizableWidth`；状态走 `backendTasksBySession` 与 `subagentOutputBySession`。

## 关键约定与坑

- **IPC 通道是契约**：新增任何主进程能力都要在 `preload/index.ts` 暴露 + `index.ts` 注册 `ipcMain.handle`，且渲染端订阅的事件要在组件 unmount 时 `removeAllListeners`（`archive:tick` / `backend-task` 已有泄漏前科，preload 提供了 unsubscribe 返回值）。
- **`localSessionId`** 是 cc-desk 内部会话 ID，与 Claude SDK 的 `session_id`（resumeId）通过 `claudeSessionMap` 映射。两者不要混。
- **i18n**（`src/renderer/i18n/`）是轻量字典，按 `settings.lang`（zh-CN / en）切换；有 `i18n-completeness.test.ts` 校验两语言 key 对齐，加文案要两边都加。
- **输出语言跟随界面 lang**：靠 systemPrompt append 强制（`settings.language` 对代理不可靠）；resume 旧会话不跟随（SDK resume 沿用旧系统提示）。
- **权限模式**（`getPermissionMode`）已接入 SDK；思考强度走 effort 参数。
- **打包版的 PATH 与 dev 不同**：分发版由 `fix-env.ts` 注入 env，不继承终端 PATH（见上「其他重要子系统」）。本地 `pnpm dev` 能跑、打包后子进程报「命令找不到」时，先排查 env 注入而非业务逻辑。
- 代码有大量中文注释解释「为什么这么写」（含历史坑修复），改动前先读周边注释，很多反直觉的设计是为绕开 SDK/Electron 的具体 bug。

## 部署

服务器信息、SSH 凭据、端口/卷映射、构建更新流程等**敏感信息**存于本地 `CLAUDE.local.md`（已 gitignore，不提交）。Claude Code 自动加载该文件。

为什么不放这里：本仓库为 public，服务器 IP/路径/卷名不应进 git。`web/` PWA 与 `relay/` 中继一同部署为单个 Docker 容器（`Dockerfile` 在仓库根，多阶段构建），具体运行态见本地记忆。
