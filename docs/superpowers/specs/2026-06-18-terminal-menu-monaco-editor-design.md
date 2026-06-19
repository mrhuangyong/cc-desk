# 右栏终端菜单 + FileTab 升级为 Monaco 代码编辑器

> 日期：2026-06-18
> 范围：右侧面板（RightPanel / TabBar）

## 一、目标

两件相互独立、可并行实施的事：

1. **补齐添加菜单的终端项**——`TabBar` 的 `+` 下拉菜单当前只有"浏览器 / 审查 / 文件"，漏了终端。`TerminalTab` 组件与主进程 `pty-manager` 已完整可用，仅需接线。
2. **FileTab 升级为 Monaco 代码编辑器**——当前 `FileTab` 是只读 `<pre>` 文本展示，改造为可编辑的 Monaco 编辑器，支持语法高亮、行号、编辑、保存（脏标 / Cmd+S / 原子写 / 关闭确认）。

## 二、现状

- `src/renderer/types.ts`：`TabType = 'file' | 'browser' | 'terminal' | 'review'`，`Tab` 带 `filePath?` / `url?`，**无 `cwd?`**。
- `src/renderer/components/TabBar.tsx`：
  - `ADD_OPTIONS` 数组缺 `terminal`。
  - tab 标题无脏标。
  - `CLOSE_TAB` 直接 dispatch，无未保存确认。
- `src/renderer/components/FileTab.tsx`：`useEffect` 调 `fs.readFile` → `<pre>` 只读展示。
- `src/renderer/components/TerminalTab.tsx`：xterm + node-pty，已支持 `cwd` prop。
- `src/renderer/state/reducer.ts`：`OPEN_TAB` 创建 tab，**不接收 cwd**；`CLOSE_TAB` 直接过滤删除。
- `src/preload/index.ts`：`fs` 暴露 `readTree` / `readFile` / `searchFiles`，**无 `writeFile`**。
- `src/main/file-service.ts`：`readFileContent` 等，**无写文件函数**。
- `src/main/index.ts`：注册 `fs:read-tree` / `fs:read-file` / `fs:search-files`，**无 `fs:write-file`**。
- 依赖：`monaco-editor`、`@monaco-editor/react` **未安装**；`shiki` 已在但本次不用于编辑器（Monaco 自带高亮）。

## 三、明确不做（YAGNI）

- 不做多 Model 共享单容器编辑器（保留每 tab 一个 Monaco 实例）。
- 不做文件树联动自动刷新（外部修改不感知）。
- 不做 git diff 集成。
- 不做全目录搜索替换。
- 不做自动保存 / 备份文件。

## 四、架构与文件改动

```
src/main/
  file-service.ts      新增 writeFileContent(filePath, content) —— 原子写
  index.ts             新增 ipc: fs:write-file
src/preload/
  index.ts             新增 fs.writeFile 暴露 + 类型
src/renderer/
  types.ts             Tab 增加可选 cwd?: string
  state/reducer.ts     OPEN_TAB 透传 cwd；新增 TAB_DIRTY 与 dirty 状态
  components/
    TabBar.tsx         ADD_OPTIONS 加终端；tab 脏标；脏 tab 关闭二次确认
    FileTab.tsx        重写为 Monaco 编辑器
    editor/
      monacoEnv.ts     [新] Monaco loader（本地 node_modules，非 CDN）、主题注册、语言映射
```

**新增依赖**：`monaco-editor`、`@monaco-editor/react`。

## 五、需求一：终端菜单接线

- `TabBar.ADD_OPTIONS` 加入 `{ type: 'terminal', label: '终端', icon: SquareTerminal }`（图标已 import）。
- `addTab('terminal')` 时，`OPEN_TAB` action 增加 `cwd` 入参：
  - cwd 来源：当前 `activeSession` 所属项目的 `Project.path`；项目无 `path` 时回退 `state.settings.cwd`；仍无则 `undefined`（pty 落默认目录）。
  - 在 TabBar 的 `addTab` 内计算 cwd 并随 `OPEN_TAB` 一并 dispatch（reducer 不主动猜项目路径，由调用方注入）。
- reducer 创建 terminal tab 时把 `cwd` 写入 tab 对象。
- `TerminalTab` 已读 `cwd` prop，无需改动（`TabBar.renderContent` 传 `cwd={active.cwd}`）。

## 六、需求二：FileTab → Monaco 编辑器

### 6.1 职责
加载 `filePath` → Monaco 展示与编辑 → Cmd/Ctrl+S 原子写回原文件。

### 6.2 加载与语言
- `useEffect` 调 `fs.readFile(filePath)`，内容灌入 Monaco `value`；保留 loading / error / 空文件态提示。
- 语言探测：`monacoEnv.ts` 维护扩展名 → Monaco 语言映射表（`.ts/.tsx→typescript`、`.js/.jsx→javascript`、`.py→python`、`.json→json`、`.md→markdown`、`.css/.scss`、`.html`、`.go`、`.rs`、`.java`、`.sh` 等），未命中用 `plaintext`。

### 6.3 脏标管理（数据流）
- reducer 新增 `dirtyTabIds: Record<string, boolean>`（按 sessionId 隔离可后续按需扩展，初版全局一张表即可，key = tabId）。
- 新增 action `TAB_DIRTY`：`{ type: 'TAB_DIRTY'; tabId: string; dirty: boolean }`，置位 / 清除该 tabId。
- FileTab `onChange` 时 `dispatch({ type: 'TAB_DIRTY', tabId, dirty: content !== initialContent })`。
- TabBar 渲染标题时读 `dirtyTabIds`，脏则标题后加圆点。

### 6.4 保存
- Monaco 注册 editor action：`Cmd+S`（mac）/ `Ctrl+S`（win/linux），触发保存。
- 保存调用 `fs.writeFile(filePath, currentValue)`，**同步等待 IPC 返回**：
  - 成功 → `dispatch({ type: 'TAB_DIRTY', tabId, dirty: false })`。
  - 失败 → Monaco 顶部错误条提示，**保留脏标不清**。
- 写入逻辑见主进程原子写（第七节）。

### 6.5 主题与设置联动
- 主题：按 `state.settings.theme`（`codex-light` / `codex-paper` / `codex-warm` / `codex-cool` → Monaco `vs`；`codex-dark` → `vs-dark`）。`monacoEnv.ts` 集中映射，主题变更时 `monaco.editor.setTheme(...)`。
- 设置联动：复用 `CodePreviewSettings`：
  - `fontSize` → Monaco `fontSize`。
  - `wordWrap` → `wordWrap: 'on' | 'off'`。
  - `showLineNumbers` → `lineNumbers: 'on' | 'off'`。

### 6.6 实例生命周期
- 每 file tab 一个 `@monaco-editor/react` `<Editor>` 实例；切 tab（组件卸载）时 Monaco 自行 dispose。
- 撤销栈不跨 tab 保留（切回重新加载文件最新内容）——符合"轻量编辑"定位。
- 保存方法对外暴露：FileTab 通过 ref（或 `editorRef` 注册表）暴露 `save(): Promise<boolean>`，供关闭确认流程调用。

## 七、主进程：原子写文件

`writeFileContent(filePath, content)`（`src/main/file-service.ts`）：
1. `writeFile(filePath + '.ccdesk-tmp', content)`。
2. `rename(filePath + '.ccdesk-tmp', filePath)` 覆盖原文件。
3. 任一步失败：清理 tmp 文件，**原文件保持不变**，向上抛错。

IPC 注册：`ipcMain.handle('fs:write-file', (_e, filePath, content) => writeFileContent(filePath, content))`。

preload 暴露：`writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content)`。

## 八、关闭确认（脏 tab）

TabBar 的关闭按钮处理改为：
1. 若 `dirtyTabIds[tabId]` 为真 → 弹确认对话框（保存 / 不保存 / 取消）：
   - **保存** → 调该 FileTab 的 `save()`：
     - 成功 → dispatch `CLOSE_TAB`。
     - 失败 → 不关闭，停留在编辑器，错误条提示（保持脏标）。
   - **不保存** → 直接 dispatch `CLOSE_TAB`。
   - **取消** → 不操作。
2. 若非脏 → 直接 `CLOSE_TAB`（保持现有行为）。

reducer `CLOSE_TAB` 同时从 `dirtyTabIds` 移除该 tabId（兜底清理）。

## 九、错误处理矩阵

| 场景 | 处理 |
|------|------|
| readFile 失败 | 保留 error 提示，不进入编辑器 |
| writeFile 失败（权限/磁盘） | Monaco 顶部错误条，保留脏标，不关 tab |
| 写入中断 / 进程崩溃 | 原子写保证原文件不被破坏（tmp+rename） |
| 关闭确认-保存失败 | 不关闭，停留在编辑器 + 错误条 |
| 终端 cwd 无法解析 | 回退 pty 默认目录，不报错 |

## 十、测试

### 单元（vitest）
- reducer：
  - `OPEN_TAB` 带 `cwd` → terminal tab 对象含 `cwd`。
  - `TAB_DIRTY` 置位 / 清除 `dirtyTabIds`。
  - `CLOSE_TAB` 移除 tab 同时清理其 dirty 记录。
- `writeFileContent`：mock `rename` 抛错 → 原文件内容不变、tmp 被清理、函数 reject。

### 手动验证
- 开文件 → 改 → 脏标圆点出现 → Cmd+S → 脏标消失，磁盘内容更新。
- 改 → 点 × → 弹三选项：保存成功后关闭 / 不保存直接关 / 取消不动。
- 改 → 保存失败（只读文件）→ 错误条 + 保留脏标 + 不关。
- 深 / 浅主题切换 → 编辑器配色跟随。
- `+` 菜单出现"终端"项 → 新建终端 tab 落在当前项目目录（`pwd` 验证）。
