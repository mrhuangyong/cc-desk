# cc-desk

<div align="center">

**Claude Code 桌面客户端** — 把 Claude Agent SDK 包装成带文件树、终端、浏览器、代码审查的工作台。

Electron · React · TypeScript

![version](https://img.shields.io/badge/version-1.14.0-blue)
![license](https://img.shields.io/badge/license-ISC-green)

</div>

---

## 这是什么

cc-desk 是 [Claude Code](https://claude.com/claude-code) 的桌面客户端。核心价值不在 UI，而在于：

- **对流式对话的精细桥接** — 基于 Claude Agent SDK 的长生命周期持久 query，支持流式增量、多轮续接、中断恢复（后台任务跨多轮存活）。
- **对 Claude 配置的真实读写** — 设置页直接读写 `~/.cc-desk/claude/` 的 settings / mcpServers / plugins / skills / commands / hooks（与 SDK 运行时同目录，所见即所生效），不是 mock。
- **多 Tab 工作台** — 对话 + 文件预览（Monaco）+ 真实终端（node-pty + xterm）+ 内置浏览器 + 代码审查，一个窗口搞定。

> **注意**：本工具调用的是真实 Claude API / Claude CLI，使用前需自备 API Key 或通过第三方代理接入。

---

## 功能特性

### 💬 AI 对话
- 流式响应（文本 / 思考 / 工具调用增量渲染）
- 多会话并行，按会话分片的状态管理
- 会话恢复（resume），跨会话切换不丢上下文
- 工具调用卡片化（Bash / Task / Edit / 计划 / 后台任务各有专属展示）
- **AskUserQuestion** 阻塞式交互桥接（按 tool_use.id 去重 + 会话隔离）
- **计划模式**（ExitPlanMode）— 提交计划走阻塞式批准流程，Markdown 渲染、可折叠
- 输出语言跟随界面 i18n（systemPrompt 强制）
- 权限模式（确认 / 自动编辑 / 计划 / 完全访问）+ 思考强度可调

### 🪟 悬浮任务面板
- **可拖动的图标 / 面板** — 折叠成右上角小图标，展开为面板，均可任意拖动定位
- 位置记忆（设置项控制，默认开启）
- 任务 / 子代理 / 后台任务三分区，**有数据才显示**
- 折叠/展开方向性动画（右上角锚点，向左下生长 / 向右上收回）
- 子代理实时进度（当前工具 / token / 摘要）

### 🗂 多 Tab 工作台
- **文件预览** — Monaco 编辑器，Markdown 预览 / 代码高亮，Cmd+S 保存
- **真实终端** — xterm.js + node-pty，完整 shell 体验
- **内置浏览器** — 地址栏、前进后退、网页渲染
- **代码审查** — Diff 视图

### 📁 项目管理
- 多项目支持，一键添加目录
- 项目 → 会话树，按用户最后发送消息时间排序
- 会话搜索、自动归档（可配置时长）
- 文件树浏览，点击在右栏打开

### 🔌 配置与扩展（直读 `~/.cc-desk/claude/`）
- **模型设置** — 多供应商 + 自定义 baseUrl / 角色映射（支持第三方代理接入 GLM 等）
- **MCP 服务器** 配置
- **技能 / 插件 / 命令 / Hooks** 管理（含插件市场）
- **CLAUDE.md 记忆** 编辑
- 主题 / 语言 / 缩放 / 代理 / 通知 / 队列模式等常规设置

### 🎨 界面
- 自定义标题栏，macOS 红绿灯适配
- 多种内置主题（暖色暗夜 / 冷峻深空 / 纸感明亮 / 酸性极客）
- 中英双语 i18n
- 应用内更新检查

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Electron 42 + React 18 + TypeScript |
| AI 集成 | [`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/anthropic-sdk-typescript) |
| 编辑器 | Monaco |
| 终端 | node-pty + @xterm/xterm |
| Markdown | react-markdown + remark-gfm + shiki + mermaid + KaTeX |
| 存储 | electron-store |
| 图标 | Lucide React |
| 构建 | electron-vite |
| 测试 | Vitest + @testing-library/react（65+ 测试文件） |

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8
- **Claude API Key**（或第三方代理）— 从 [console.anthropic.com](https://console.anthropic.com) 获取

### 安装

```bash
git clone https://github.com/mrhuangyong/cc-desk.git
cd cc-desk
pnpm install        # postinstall 会修 node-pty 的 spawn-helper 执行权限
```

### 开发 / 构建 / 测试

```bash
pnpm dev            # electron-vite dev，热重载
pnpm build          # 生产构建到 out/
pnpm test           # vitest run（默认套件，~650 用例）
pnpm test:watch     # 监听模式
pnpm test:e2e       # 真机 e2e（需本地代理 + 真实模型）
```

---

## 配置

首次启动后，在 **设置** 中配置：

| 页面 | 关键配置 |
|------|---------|
| **模型设置** | 供应商 / API Key / baseUrl / 角色映射（必填） |
| **常规** | 工作目录、主题、语言、代理、通知、任务面板位置记忆等 |
| **MCP / 技能 / 插件 / 命令 / Hooks** | 直读 `~/.cc-desk/claude/` 真实配置 |
| **记忆** | 编辑 CLAUDE.md |

应用数据全部收敛到 `~/.cc-desk/`（settings / projects / config 三文件），Claude 配置隔离在 `~/.cc-desk/claude/`，**不读写 `~/.claude`**（首次启动仅从 `~/.claude` 一次性迁入，之后不再触碰）。

---

## 项目结构

```
src/
├── main/                          # Electron 主进程（Node）
│   ├── index.ts                   # 应用入口 + IPC 注册
│   ├── claude-service.ts          # Claude SDK 桥（流式对话 / 工具拦截 / dialog）
│   ├── session-query-manager.ts   # 长生命周期持久 query 管理（streaming-input）
│   ├── backend-task-registry.ts   # 后台任务 / 子代理注册表
│   ├── pty-manager.ts             # 终端进程（node-pty）
│   ├── file-service.ts            # 文件系统（目录树 / 读写 / stat）
│   ├── claude-config.ts           # ~/.cc-desk/claude 配置读写（深合并）
│   ├── marketplace-manager.ts     # 插件市场
│   ├── settings-store.ts          # 设置持久化（electron-store）
│   └── update-manager.ts          # 应用更新
├── preload/
│   └── index.ts                   # contextBridge API 暴露（唯一 IPC 桥）
└── renderer/                      # React 渲染进程
    ├── App.tsx
    ├── components/                # ChatArea / InputBar / LeftPanel / RightPanel
    │   ├── BackendTaskPanel.tsx   # 悬浮任务面板（可拖动图标/面板）
    │   ├── blocks/                # 工具调用卡片（Bash/Task/计划/Meta）
    │   ├── markdown/              # Markdown 渲染（shiki/mermaid/KaTeX）
    │   └── settings/              # 设置页各子页
    ├── state/                     # React Context + useReducer 单一 store
    ├── hooks/                     # useDraggable / useResizableWidth / usePanelAnimation / useTheme
    ├── editor/                    # Monaco 封装 / @ 引用导航
    ├── i18n/                      # 中英字典
    └── utils/                     # links / formatSessionTime / url
```

### 架构

```
渲染进程 (React)
    ↕  IPC (contextBridge: window.api.*)
主进程 (Node.js)
    ├── ClaudeService → Claude Agent SDK → Claude CLI
    ├── SessionQueryManager → 持久 query（多轮续接 / interrupt 不杀进程）
    ├── PtyManager → node-pty → shell
    ├── FileService → fs
    └── SettingsStore / claude-config → ~/.cc-desk（含隔离的 claude 配置）
```

---

## 开发约定

- **IPC 通道是契约** — 新增主进程能力必须在 `preload/index.ts` 暴露 + `index.ts` 注册，渲染端事件订阅要在 unmount 时清理。
- **`localSessionId`** 是 cc-desk 内部会话 ID，与 Claude SDK 的 `session_id` 通过 `claudeSessionMap` 映射，不要混。
- **i18n** 中英两语言 key 必须对齐（有完整性测试校验）。
- **测试隔离** — 涉及落盘的主进程测试用临时 HOME + `vi.resetModules()`，绝不写真机 `~/.cc-desk/`。
- 代码有大量中文注释解释「为什么这么写」（含历史坑修复），改动前先读周边注释。

---

## 许可证

[ISC](./LICENSE)
