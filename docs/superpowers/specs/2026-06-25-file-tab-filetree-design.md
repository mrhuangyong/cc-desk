# 右侧栏「文件」Tab 改造：内置文件树 + 内容浏览

- 日期：2026-06-25
- 状态：待实现
- 关联组件：`src/renderer/components/FileTab.tsx`

## 1. 背景与问题

右侧栏通过 `+` 新增的「文件」tab 对应组件 `FileTab.tsx`。它当前是一个**单文件 Monaco 编辑器**（支持 Cmd+S 保存、markdown 预览切换、脏标），但其显示内容完全依赖外部通过 `props.filePath` 投喂：

- 正常路径：用户在**左栏 FileTree** 点文件 → dispatch `OPEN_FILE_TAB` → tab 携带 `filePath` → FileTab 加载并显示。
- 问题路径：用户直接在右栏 `+` 开一个文件 tab（无 `filePath`）→ FileTab 第 110 行 `if (!filePath)` 直接返回 `(未指定文件)` 占位 → **整个 tab 是空白区域**。

用户期望：文件 tab 打开后即「左侧文件树 + 右侧文件内容」的两栏浏览体验，不再依赖左栏投喂。

## 2. 目标与非目标

### 目标
1. 改造 `FileTab.tsx`，使其内置「左文件树 + 右文件内容」左右两栏布局。
2. 文件树根目录 = 当前项目 `project.path`（回退 `settings.cwd`）。
3. 右栏文件内容**可编辑**，复用现有 Monaco 全部能力（保存、预览、脏标）。
4. 点文件树中的文件 → 在**当前 tab 右栏切换内容**（单 tab 浏览，不新开 tab）。
5. 复用已有 `window.api.fs.*` 能力（readTree / readFile / writeFile），不新写主进程逻辑。

### 非目标（YAGNI）
- 不做文件变化 watch（`file-service.ts` 本就无 chokidar，不在本次范围）。
- 左栏宽度首版**固定 220px**，不做可拖拽分栏（预留后续）。
- 不做多项目切换，文件树固定当前项目。
- 不改动左栏现有 `FileTree.tsx` 及其 `OPEN_FILE_TAB` 流程（保持向后兼容）。
- 不动全局 reducer / store。

## 3. 架构与组件边界

把 `FileTab` 从「单编辑器」升级为「自带文件浏览的编辑器」，拆分为三个单元，各司其职：

```
FileTab (tabId, filePath?)            —— 容器：左右两栏布局 + 状态协调
├── FileExplorerPanel (cwd, onOpenFile)  —— 左栏：按需展开文件树（新增）
└── FileEditorPane (filePath, tabId, ref) —— 右栏：Monaco 编辑器（从现 FileTab 抽出）
```

**拆分理由**：现有 `FileTab.tsx` 把「加载/保存/编辑/预览/脏标/Cmd+S」全揉在一个组件里（162 行）。改造时顺势把「编辑器」抽成独立的 `FileEditorPane`，让 `FileTab` 回归「容器+协调」职责，`FileExplorerPanel` 专注「树渲染」。每个单元可独立理解和测试。

**为什么不复用左栏 `FileTree.tsx`**：它带 `onBack` 返回按钮、project 切换语义、`OPEN_FILE_TAB` dispatch 副作用，与左栏场景强耦合。新写精简的 `FileExplorerPanel`（直接 `readTree` + 回调父组件）边界更清晰。

## 4. 数据流与状态管理

### 4.1 局部状态（保持在 FileTab 组件内，不进全局 store）

```ts
// FileTab 内
const [currentFilePath, setCurrentFilePath] = useState<string | undefined>(filePath)
```
- 初始值 = `props.filePath`（外部投喂来的）；用户点文件树时 `setCurrentFilePath` 更新。
- **不进全局 store 的理由**：tab 级瞬态浏览状态，不属于会话持久化数据；store 是按 session 分片且会 `projects:save` 落盘，塞进去会无谓增大持久化体积。

### 4.2 当前项目根目录获取（沿用项目通用模式）

```ts
const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
const cwd = activeProject?.path || state.settings?.cwd
```
传 `cwd` 给 `FileExplorerPanel` 作文件树根。

### 4.3 数据流

```
FileTab 挂载
  ├── props.filePath 有值 → currentFilePath = filePath，右栏加载它
  └── props.filePath 无值 → currentFilePath = undefined，右栏空态「选择一个文件」

FileExplorerPanel 点击文件 node
  └── onOpenFile(node.path) → setCurrentFilePath(node.path)
      └── FileEditorPane 监听 filePath 变化 → 重新加载内容

FileEditorPane 加载/保存
  ├── window.api.fs.readFile(path) → 内容进 Monaco
  └── Cmd+S → window.api.fs.writeFile(path, content)（复用现有 doSave 逻辑）
```

### 4.4 向后兼容
现有「左栏 FileTree → `OPEN_FILE_TAB` → tab 携带 filePath」路径**不变**，只是现在 `filePath` 成为 `currentFilePath` 的初始值，且左树也常驻可见（两种入口行为统一，无特殊分支）。

## 5. 布局与样式

### 5.1 两栏容器（inline style + CSS 变量，遵循项目约定）

```tsx
<div style={{ display:'flex', flexDirection:'row', flex:1, minHeight:0, minWidth:0 }}>
  {/* 左栏：文件树，固定宽度 */}
  <div style={{ width: 220, minWidth: 160, borderRight: '1px solid var(--border)',
                display:'flex', flexDirection:'column', minHeight:0, overflow:'hidden' }}>
    <FileExplorerPanel cwd={cwd} currentFilePath={currentFilePath} onOpenFile={setCurrentFilePath} />
  </div>
  {/* 右栏：编辑器，flex:1 */}
  <div style={{ flex:1, minWidth:0, minHeight:0 }}>
    <FileEditorPane ref={editorRef} filePath={currentFilePath} tabId={tabId} />
  </div>
</div>
```
- 左栏固定 220px（min 160），首版不可拖拽。
- 颜色/圆角/阴影全部走 CSS 变量（`var(--bg-sidebar)` / `var(--border)` / `var(--bg-hover)` / `var(--text-muted)` 等）。
- 图标用 `lucide-react`（Folder / File / ChevronRight）。
- 严格遵循 `minHeight:0 / minWidth:0` 防 flex 子项撑破。

### 5.2 FileExplorerPanel 要点
- 按需展开：点目录 → `window.api.fs.readTree(dirPath)` 读单层 → 填充 children。
- 目录/文件图标区分；当前选中文件高亮（`var(--bg-hover)`）。
- 忽略集由 `file-service.ts` 内置（node_modules/.git/dist 等），组件层不再过滤。
- 顶栏显示当前项目名（可选，轻量）。

### 5.3 FileEditorPane 要点
- 把现 `FileTab.tsx` 第 27–161 行的加载/保存/编辑/预览/脏标/Cmd+S 逻辑整体迁入。
- 接收 `filePath`（即 `currentFilePath`）；`filePath` 变化时重新加载（现有 `useEffect([filePath])` 已支持）。
- 空态（`filePath` 为空）：显示「选择一个文件」提示，替代现第 110–112 行的 `(未指定文件)`。

## 6. 错误处理与边界

| 场景 | 处理 |
|------|------|
| 切换文件时有未保存改动（脏标） | 弹确认「丢弃当前改动？」（复用 TabBar 关闭时的未保存确认交互模式）。可编辑模式必须处理。 |
| 读文件 >200KB / 读取失败 | 右栏错误态，沿用现有 try/catch + 提示（`readFileContent` 对 >200KB 抛错）。 |
| 无 cwd（项目无 path 且无 settings.cwd） | 左树空态「未选择工作区」，右栏不渲染。 |
| 点目录懒加载失败 | 该目录节点显示错误标记，不影响其它节点。 |

## 7. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/renderer/components/FileTab.tsx` | 改造 | 改为两栏容器 + 状态协调，抽出编辑器逻辑 |
| `src/renderer/components/FileExplorerPanel.tsx` | 新增 | 左栏文件树子组件 |
| `src/renderer/components/FileEditorPane.tsx` | 新增 | 右栏 Monaco 编辑器封装（迁移自 FileTab） |
| `tests/file-tab-explorer.test.tsx` | 新增 | 组件测试（jsdom，mock `window.api.fs`） |

## 8. 测试计划

- **reducer 无变更**：本设计不动 reducer / store，`reducer.test.ts` 无需改。
- **新增组件测试**（jsdom）：
  - `FileExplorerPanel`：mock `window.api.fs.readTree` 返回固定 FileNode[]，验证目录展开、点文件触发 `onOpenFile(node.path)` 回调、当前文件高亮。
  - `FileTab` 浏览模式：无 `filePath` 时左树渲染、右栏空态；点文件后右栏加载（mock `readFile`）。
  - 未保存切文件确认流程。
- mock `window.api.fs` 即可，不涉及落盘，**无需 `withFakeConfigDir`**（那是主进程配置测试才用）。

## 9. 风险与注意事项

- **Monaco 实例复用**：编辑器逻辑迁移时，`useImperativeHandle` 暴露的 `save()` 和 `Cmd+S` 注册需正确指向当前 `FileEditorPane`，保证 TabBar 关闭确认仍能调用 `save()`。`forwardRef` 链路：TabBar → FileTab → FileEditorPane。
- **`display:none` 切 tab 不丢状态**：TabBar 靠 `display: flex/none` 常驻 DOM（见 CLAUDE.md）。FileTab 改为两栏后，Monaco `automaticLayout: true` 已处理切回时的布局重算，需验证切 tab 后编辑器尺寸正常。
- **filePath 初始值同步**：`props.filePath` 变化时（理论上一个 tab 的 filePath 不变，但稳妥起见）需同步 `currentFilePath`，避免外部更新不反映。
