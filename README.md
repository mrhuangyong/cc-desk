# cc-desk

Claude Code 桌面客户端 — 基于 Electron + React + TypeScript 构建的 AI 工作台。

## 功能特性

- **AI 对话** — 集成 Claude Agent SDK，支持流式响应、会话管理、会话恢复
- **多 Tab 面板** — 文件预览、内置浏览器、真实终端、代码审查
- **真实终端** — xterm.js + node-pty，完整的终端体验
- **文件系统** — 目录树浏览、文件内容预览
- **元素拾取** — 从浏览器 Tab 拾取网页元素送入 AI 对话
- **主题系统** — 四种内置主题（暖色暗夜/冷峻深空/纸感明亮/酸性极客），实时切换
- **可拖拽布局** — 左右面板可拖拽调节宽度，支持展开/折叠动画
- **设置管理** — API Key、模型选择、MCP 服务器、技能、插件配置

## 技术栈

- Electron 42 + React 18 + TypeScript 6
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- node-pty + @xterm/xterm（终端）
- electron-store（设置持久化）
- Lucide React（图标）
- Vite（构建）+ Vitest（测试）

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装

```bash
git clone https://github.com/mrhuangyong/cc-desk.git
cd cc-desk
pnpm install
```

### 开发

```bash
pnpm dev
```

### 构建

```bash
pnpm build
```

### 测试

```bash
pnpm test
```

## 配置

首次启动后，在设置页配置：

1. **API Key** — Anthropic API 密钥（必填）
2. **模型** — Sonnet / Opus / Haiku
3. **工作目录** — 默认项目路径

## 项目结构

```
src/
├── main/                    # Electron 主进程
│   ├── index.ts             # 应用入口 + IPC 注册
│   ├── claude-service.ts    # Claude SDK 封装
│   ├── pty-manager.ts       # 终端进程管理
│   ├── file-service.ts      # 文件系统操作
│   └── settings-store.ts    # 设置持久化
├── preload/
│   └── index.ts             # contextBridge API
└── renderer/                # React 渲染进程
    ├── components/          # UI 组件
    │   ├── ChatArea.tsx     # 对话区
    │   ├── InputBar.tsx     # 输入框
    │   ├── LeftPanel.tsx    # 左栏（项目/会话树）
    │   ├── RightPanel.tsx   # 右栏（多 Tab 面板）
    │   ├── TabBar.tsx       # Tab 标签栏
    │   ├── TerminalTab.tsx  # 终端 Tab
    │   ├── FileTree.tsx     # 文件树
    │   ├── BrowserTab.tsx   # 浏览器 Tab
    │   └── settings/        # 设置页组件
    ├── state/               # 状态管理
    │   ├── store.tsx        # React Context + useReducer
    │   ├── reducer.ts       # 状态 reducer
    │   └── actions.ts       # Action 类型定义
    ├── hooks/               # 自定义 hooks
    │   ├── useResizableWidth.ts   # 拖拽调宽
    │   └── usePanelAnimation.ts   # 面板动画
    └── types.ts             # 类型定义
```

## 许可证

MIT
