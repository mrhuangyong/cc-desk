# cc-desk

<p align="center">
  <img src="docs/images/screenshot.png" width="900" alt="cc-desk 界面截图" />
</p>

<p align="center">
  <strong>Claude Code 桌面客户端</strong> — 基于 Electron + React + TypeScript 构建的 AI 工作台
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#配置">配置</a> ·
  <a href="#项目结构">项目结构</a> ·
  <a href="#许可证">许可证</a>
</p>

---

## 功能特性

### AI 对话
- 集成 Claude Agent SDK，支持流式响应
- 多轮对话，会话自动持久化
- 会话恢复（resume），跨会话切换
- 工具调用可视化

### 多 Tab 面板
- **文件预览** — 浏览项目文件，语法高亮
- **内置浏览器** — 地址栏、前进后退、网页渲染
- **真实终端** — xterm.js + node-pty，完整终端体验
- **代码审查** — Diff 视图

### 项目管理
- 多项目支持，一键添加项目目录
- 项目 → 会话树，支持展开/折叠/搜索
- 文件树浏览，点击文件在右栏打开

### 界面
- 自定义标题栏，macOS 红绿灯适配
- 四种内置主题（暖色暗夜 / 冷峻深空 / 纸感明亮 / 酸性极客）
- 左右面板可拖拽调节宽度
- 展开/折叠动画

### 设置
- API Key 管理（加密存储）
- 模型选择（Sonnet / Opus / Haiku）
- MCP 服务器配置
- 技能 / 插件 / 命令 / Hooks 管理

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Electron 42 + React 18 + TypeScript 6 |
| AI 集成 | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
| 终端 | node-pty + @xterm/xterm |
| 存储 | electron-store（加密持久化） |
| 图标 | Lucide React |
| 构建 | Vite + electron-vite |
| 测试 | Vitest + @testing-library/react |

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8
- **Anthropic API Key** — 从 [console.anthropic.com](https://console.anthropic.com) 获取

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

---

## 配置

首次启动后，在 **设置 → 常规** 中配置：

| 配置项 | 说明 | 必填 |
|--------|------|------|
| API Key | Anthropic API 密钥 | ✅ |
| 模型 | Sonnet / Opus / Haiku | 默认 Sonnet |
| 工作目录 | 新会话默认路径 | 可选 |

---

## 项目结构

```
src/
├── main/                        # Electron 主进程
│   ├── index.ts                 # 应用入口 + IPC 注册
│   ├── claude-service.ts        # Claude SDK 封装（流式对话）
│   ├── pty-manager.ts           # 终端进程管理（node-pty）
│   ├── file-service.ts          # 文件系统操作（目录树/文件读取）
│   └── settings-store.ts        # 设置持久化（electron-store）
├── preload/
│   └── index.ts                 # contextBridge API 暴露
└── renderer/                    # React 渲染进程
    ├── components/
    │   ├── ChatArea.tsx         # 对话消息流 + 流式渲染
    │   ├── InputBar.tsx         # 输入框（发送/停止/附件/模型选择）
    │   ├── LeftPanel.tsx        # 左栏（项目/会话树/搜索/技能）
    │   ├── RightPanel.tsx       # 右栏（多 Tab 容器）
    │   ├── TabBar.tsx           # Tab 标签栏
    │   ├── TerminalTab.tsx      # 终端 Tab（xterm.js）
    │   ├── FileTree.tsx         # 文件树
    │   ├── FileTab.tsx          # 文件预览 Tab
    │   ├── BrowserTab.tsx       # 浏览器 Tab
    │   └── settings/            # 设置页组件
    ├── state/
    │   ├── store.tsx            # React Context + useReducer
    │   ├── reducer.ts           # 状态 reducer
    │   └── actions.ts           # Action 类型
    ├── hooks/
    │   ├── useResizableWidth.ts # 拖拽调宽（ref + rAF）
    │   └── usePanelAnimation.ts # 面板展开/折叠动画
    └── types.ts                 # 类型定义
```

---

## 开发

### 命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 构建生产版本 |
| `pnpm test` | 运行测试 |
| `pnpm test:watch` | 监听模式测试 |

### 架构

```
渲染进程 (React)
    ↓ IPC (contextBridge)
主进程 (Node.js)
    ├── ClaudeService → Claude Agent SDK → Claude CLI 子进程
    ├── PtyManager → node-pty → shell 进程
    ├── FileService → fs 模块
    └── SettingsStore → electron-store
```

---

## 许可证

[MIT](LICENSE)
