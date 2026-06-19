# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

cc-desk 是 **Claude Code 的桌面客户端**（Electron + React + TypeScript），把 Claude Agent SDK 包装成一个带文件树、终端、浏览器、代码审查多 Tab 的工作台。核心价值不在 UI，而在于对 SDK 流式事件、会话生命周期、以及 `~/.claude` 真实配置的桥接。

## Commands

```bash
pnpm install        # 安装；postinstall 会修 node-pty 的 spawn-helper 执行权限（见下）
pnpm dev            # electron-vite dev，热重载
pnpm build          # 生产构建到 out/
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
- **涉及落盘的主进程测试（`claude-config`、`cc-desk-store` 等）必须隔离 HOME**：用 `os.tmpdir()` 下的临时目录 + `vi.resetModules()` 动态重导入模块，绝不写真机 `~/.claude`。参考 `tests/claude-config-write.test.ts` 的 `withFakeHome()` 工厂。
- reducer/组件测试用 `tests/fixtures.ts` 的 `seedProjects`（p1=cc-desk 含 s1..s8，p2 含 s3）作为已知结构种子，不要各自造 mock 数据。
- 真机 e2e 文件内部用 `// @vitest-environment node` 声明 node 环境（jsdom 不适用），由独立 `vitest.e2e.config.ts` 收集。

## 架构

三进程标准 Electron：**main（Node）→ preload（contextBridge）→ renderer（React）**。所有跨进程调用都走 `window.api.*`（`src/preload/index.ts` 是唯一的桥，新增 IPC 必须在这里登记通道）。

### 流式对话是整个应用的核心（理解前不要动它）

不要把一次对话当成「调一次 `query()` 等结果」。会话是**长生命周期的持久 query**：

- `SessionQueryManager`（`src/main/session-query-manager.ts`）为每个 `localSessionId` 维护一个常驻的 `Query` + `PushController`。`PushController` 是个手写异步队列，让 SDK 的 `streamingInput: true` 能在多轮间持续接收用户消息。
- 中断用 `query.interrupt()` 而非杀子进程——**这是为了后台任务（Bash/Task 工具 auto-background）能跨多轮存活**。`claude:stop` IPC 触发 interrupt，并兜底发 `claude:aborted` 让渲染端清 streaming 状态。
- `ClaudeService`（`src/main/claude-service.ts`）是桥：`send()` → `manager.ensureSession` + `pushMessage`；事件转发逻辑注入 `buildQuery`。SDK 原始 message 经 `claude-normalize.ts`（`normalizeBetaBlocks` / `extractToolResults` / `mkNotice`）拍平为渲染端的 `ContentBlock` / `SystemNotice`。

**IPC 事件通道契约**（main `webContents.send` ↔ renderer 订阅，`localSessionId` 是路由键）：
`claude:system` / `claude:delta`（增量 text/thinking）/ `claude:blocks`（tool_use_start / assistant_blocks / tool_result）/ `claude:task`（todo）/ `claude:plan`（计划卡片，含批准/拒绝，**不走普通工具卡片**）/ `claude:backend-task`（后台任务 create/update）/ `claude:notice`（系统提示 info/warn/error）/ `claude:result` / `claude:error` / `claude:aborted` / `claude:dialog-request`（见下）。

### 用户提问/计划批准的挂起对话框

SDK 的 `onUserDialog`（阻塞式）和被 cc-desk 拦截的 `AskUserQuestion` tool_use，都走同一条路：`ClaudeService.askUserViaPanel` 发 `claude:dialog-request`，挂起一个 Promise（keyed by `reqId`），等渲染端经 `claude:dialog-response` IPC 回答后 resolve。AbortSignal 触发时回 `{behavior:'cancelled'}`。改这条链路时注意 AskUserQuestion 经代理未注册的已知坑——cc-desk 自行拦截它（参见 `handleAskUserQuestion`）。

### 渲染端状态

`src/renderer/state/` 是 React Context + `useReducer` 单一 store（不是 Redux）。`AppState` 大量使用 **按 session 分片的 map**（`tabsBySession` / `streamingBySession` / `tasksBySession` / `backendTasksBySession` / `planBySession` / `queueBySession`），因为同一时刻多个会话可并存。改 reducer 时要同步更新 `tests/reducer.test.ts` 里 `initialState()` 的全字段构造。

会话数据来自两条路：①启动时 `projects:get` 拉持久化快照 `HYDRATE`；②真实 Claude 事件流实时累积。store 只持有内存态，持久化由 `App.tsx` 防抖触发 `projects:save`。

### 持久化：三个独立存储，别混

应用数据全部收敛到 **`~/.cc-desk/`**（`src/main/paths.ts` 的 `CC_DESK_DIR`）：

| 文件 | 内容 | 模块 |
|------|------|------|
| `~/.cc-desk/settings.json` | electron-store 默认文件，UI 设置（主题/语言/缩放/代码预览等） | `settings-store.ts` |
| `~/.cc-desk/projects.json` | 工作区快照（项目/会话/消息/tab/sessionMap/lastSeq） | `projects-store.ts` |
| `~/.cc-desk/config.json` | **模型供应商配置**（providers/models/apiKey/baseUrl），ClaudeService 从此注入 SDK env | `cc-desk-store.ts` |

**`~/.claude/` 真实配置**由 `claude-config.ts` 读写，是设置页的数据源（**非 mock**）：`settings.json`（env/model/theme/enabledPlugins/hooks/permissions）、`.claude.json`（mcpServers + projects）、`plugins/installed_plugins.json`、各插件 manifest/skills/commands。写策略是**深合并 + 仅动受管字段**（append-only 思想，保留用户未知 key）。改写操作务必加测试验证「保留未知字段」。

### 终端

`PtyManager`（`pty-manager.ts`）用 node-pty 创建真实 shell，输出经 `webContents` 推到渲染端的 xterm.js。macOS 上有 PTY 孤儿进程的已知坑（退出时需显式 kill）。`postinstall` 的 `scripts/fix-pty-perm.js` 修 node-pty 1.1.0 prebuild 丢失 spawn-helper 执行位的 bug。

## 关键约定与坑

- **IPC 通道是契约**：新增任何主进程能力都要在 `preload/index.ts` 暴露 + `index.ts` 注册 `ipcMain.handle`，且渲染端订阅的事件要在组件 unmount 时 `removeAllListeners`（`archive:tick` / `backend-task` 已有泄漏前科，preload 提供了 unsubscribe 返回值）。
- **`localSessionId`** 是 cc-desk 内部会话 ID，与 Claude SDK 的 `session_id`（resumeId）通过 `claudeSessionMap` 映射。两者不要混。
- **i18n**（`src/renderer/i18n/`）是轻量字典，按 `settings.lang`（zh-CN / en）切换；有 `i18n-completeness.test.ts` 校验两语言 key 对齐，加文案要两边都加。
- **输出语言跟随界面 lang**：靠 systemPrompt append 强制（`settings.language` 对代理不可靠）；resume 旧会话不跟随（SDK resume 沿用旧系统提示）。
- **权限模式**（`getPermissionMode`）已接入 SDK；思考强度走 effort 参数。
- 代码有大量中文注释解释「为什么这么写」（含历史坑修复），改动前先读周边注释，很多反直觉的设计是为绕开 SDK/Electron 的具体 bug。
