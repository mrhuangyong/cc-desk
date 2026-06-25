# 设计：右栏审查 Tab 接入 Git 能力

- **日期**：2026-06-25
- **状态**：已通过 brainstorming，待写实现计划
- **背景**：右栏「审查」tab 当前是假功能（`ReviewTab.tsx` 硬编码 `MOCK_DIFF` 字符串，注释明说"原型阶段用 mock diff 内容演示，不接真实 git"）。本设计将其重写为结合 git 的真实能力，定位为**嵌进右栏的完整 git 客户端**。

## 1. 决策汇总

| 维度 | 决策 |
|------|------|
| 定位 | 完整 git 客户端嵌进右栏审查 tab（diff 浏览 + add/restore/commit/reset + 分支/amend + push/pull） |
| 工作目录 | 绑定当前激活项目 `activeProject.path` |
| diff 计算 | 文件列表手动刷新 + 单文件 diff 懒加载 |
| 写操作范围 | A 基础四件套(add/restore/commit/reset) + B 分支/amend + C push/pull，**分阶段交付** |
| commit 输入 | 行内输入框；手动「✨生成」按钮 + 留空提交时自动生成，两种都支持 |
| AI 生成方式 | **复用 `ClaudeService.runSideQuery`**（独立通路、复用激活模型、不污染对话流、不裸调 HTTP） |
| AI 输入范围 | `git diff HEAD`（全部改动） |
| review 状态分片 | **按项目**（`reviewByProject`，以 `activeProject.id` 为 key），非按会话 |

## 2. 整体架构

遵循 cc-desk "main → preload → renderer" 三进程契约，按现有模式落点。

### 2.1 主进程

```
src/main/
├── git-service.ts        ← 新增：纯 git 操作层（status/diff/add/commit/...），execFileAsync('git')
└── claude-service.ts     ← 扩展：新增 generateCommitMessage(cwd)，内部调 runSideQuery
```

- **`git-service.ts`**：所有 git 命令封装成纯函数，每个接收 `cwd` 参数（= 激活项目路径），返回结构化数据。不依赖 Electron（纯 Node），方便单测。统一用 `execFileAsync('git', [...], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout, maxBuffer })`。
- **`ClaudeService.generateCommitMessage(cwd)`**：薄封装，调 `runSideQuery`，prompt 约束为「只输出一行 Conventional Commits message」。失败返回 `null`（渲染端回退让用户手填）。

### 2.2 IPC 通道（新增 `git:*` 命名空间）

`index.ts` 注册 `ipcMain.handle`，`preload/index.ts` 暴露 `window.api.git`：

```
window.api.git
├── status(cwd)                              → GitFileStatus[]
├── diff(cwd, scope, filePath?)              → string
├── add(cwd, paths)                          → void
├── restore(cwd, paths, opts:{staged?})      → void
├── commit(cwd, message)                     → { sha: string }
├── resetHard(cwd)                           → void
├── branch(cwd)                              → { current, list }        // B 阶段
├── checkout(cwd, ref, opts:{newBranch?})    → void                     // B 阶段
├── amend(cwd, message?)                     → void                     // B 阶段
├── push(cwd, opts?) / pull(cwd)             → void                     // C 阶段
└── generateCommitMessage(cwd)               → string | null            // 调 runSideQuery
```

### 2.3 渲染端

```
src/renderer/
├── components/
│   ├── ReviewTab.tsx        ← 重写：三栏布局（替换 mock）
│   ├── review/
│   │   ├── FileStatusList.tsx   ← 左：改动文件列表（复选框 ⇄ 暂存）
│   │   ├── DiffView.tsx         ← 右：diff 渲染（复用现有 DiffLine 着色）
│   │   └── CommitBar.tsx        ← 底：commit 输入 + 生成按钮 + 提交
├── state/reducer.ts         ← 新增 reviewByProject 分片
└── types.ts                 ← 新增 GitFileStatus 等类型
```

### 2.4 数据流（单次「查看改动」）

```
切到审查 tab / 点刷新
  → ReviewTab 检测到该项目 status 为空 → 自动刷新
  → window.api.git.status(activeProject.path)
  → 主进程 git-service.status → execFileAsync('git status --porcelain') → 解析
  → 返回 GitFileStatus[] → reducer 存入 reviewByProject[projectId].status
点击某文件
  → window.api.git.diff(cwd, scope, filePath) → 渲染 DiffView（缓存进 diffCache）
```

## 3. 数据模型与 git-service 接口

### 3.1 类型定义（`types.ts` 新增）

```ts
export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitFileStatus {
  path: string                          // 相对仓库根的路径
  indexStatus: GitChangeKind | null     // 暂存区状态（X），null=无暂存改动
  workdirStatus: GitChangeKind | null   // 工作区状态（Y），null=已全部暂存
  // 派生：staged   = indexStatus !== null && indexStatus !== 'untracked'
  //       unstaged = workdirStatus !== null
}

export type DiffScope = 'HEAD' | 'cached' | 'workdir'
```

**双字段理由**：`git status --porcelain` 每行 `XY path`，X=index、Y=workdir。用两个字段分别存能准确表达 `MM`（暂存一版又改了）这类状态，UI 据此派生 `staged`/`unstaged` 布尔决定勾选与色块。

### 3.2 git-service 方法签名

所有方法 cwd 为第一个参数：

```ts
async function status(cwd: string): Promise<GitFileStatus[]>
async function diff(cwd: string, scope: DiffScope, filePath?: string): Promise<string>
//   'HEAD'   → git diff HEAD [-- <path>]
//   'cached' → git diff --cached [-- <path>]
//   'workdir'→ git diff [-- <path>]

async function add(cwd: string, paths: string[]): Promise<void>
async function restore(cwd: string, paths: string[], opts: { staged: boolean }): Promise<void>
//   staged:true  → git restore --staged -- <paths>（取消暂存，保留工作区改动）
//   staged:false → git restore -- <paths>（丢弃工作区改动，危险，UI 二次确认）
async function commit(cwd: string, message: string): Promise<{ sha: string }>
async function resetHard(cwd: string): Promise<void>

// 阶段 B
async function branch(cwd: string): Promise<{ current: string; list: string[] }>
async function checkout(cwd: string, ref: string, opts: { newBranch?: boolean }): Promise<void>
async function amend(cwd: string, message?: string): Promise<void>   // 不传 message → --amend --no-edit

// 阶段 C
async function push(cwd: string, opts?: { setUpstream?: boolean }): Promise<void>
async function pull(cwd: string): Promise<void>

async function log(cwd: string, limit?: number): Promise<GitLogEntry[]>
```

### 3.3 关键实现约定

1. **统一 exec 包装**：私有 `git(cwd, args, opts?)`，固定注入 `GIT_TERMINAL_PROMPT: '0'`、`timeout`（默认 30s，push/pull 放宽 120s）、`maxBuffer`（10MB，diff 可能很大）。所有命令走它。
2. **错误归一化**：非零退出码转 `{ code: 'NOT_A_REPO'|'GIT_NOT_FOUND'|'CONFLICT'|'AUTH_FAILED'|'NOTHING_TO_COMMIT'|'GIT_ERROR', message, stderr }`。
3. **路径安全**：`add`/`restore` 的 paths，主进程校验为相对路径（`path.relative` 后不含 `..` 越界），防注入。
4. **diff 不服务端正则切分**：直接返回原始 unified diff 文本，渲染端复用 `DiffLine` 逐行着色。
5. **status 解析**：`--porcelain=v1 -z`（NUL 分隔，正确处理含空格/引号路径），手写状态码映射（M/A/D/R/?/!/U → GitChangeKind），写单测覆盖 `MM`/`??`/`R ` 等组合。

### 3.4 generateCommitMessage（ClaudeService 扩展）

```ts
async generateCommitMessage(cwd: string): Promise<string | null> {
  const diffText = await gitService.diff(cwd, 'HEAD')   // 全部改动
  if (!diffText.trim()) return null
  const trimmed = trimDiffForPrompt(diffText, 8000)     // 截断防 token 爆炸，保留各文件统计 + 前 N 行 hunk
  const prompt = `你是 commit message 生成器。根据以下 git diff 生成一条 Conventional Commits 格式的提交信息。
要求：只输出一行，格式为 "<type>(<scope>): <subject>"，type 从 feat/fix/chore/docs/refactor/test/perf 中选最贴切的，scope 用受影响的主要模块。不要解释、不要代码块、不要引号。

git diff:
${trimmed}`
  const result = await this.runSideQuery(prompt)
  const cleaned = result?.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim()
  return cleaned || null
}
```

`trimDiffForPrompt`：纯函数，优先保留每个文件的 `diff --git` 头 + `@@` hunk 头 + 前若干行变更，超长截断并附 `(diff 已截断，共 X 文件)`。可单测。

## 4. 渲染端 UI 与 reducer

### 4.1 reducer 状态分片（按项目）

```ts
interface ReviewState {
  status: GitFileStatus[]
  selectedPath: string | null
  diffCache: Record<string, string>
  loadingStatus: boolean
  loadingDiffPath: string | null
  error: { code: string; message: string } | null
  commitMessage: string
  commitBusy: boolean
  branches: { current: string; list: string[] } | null   // B 阶段
  remoteBusy: boolean                                     // C 阶段
}
// state 新增：reviewByProject: Record<projectId, ReviewState>
```

Actions（新增到 `actions.ts`）：`REVIEW_SET_STATUS` / `REVIEW_SELECT_FILE` / `REVIEW_SET_DIFF` / `REVIEW_SET_LOADING` / `REVIEW_SET_ERROR` / `REVIEW_SET_COMMIT_MESSAGE` / `REVIEW_SET_BRANCHES` / `REVIEW_CLEAR`，均带 `projectId` 做 upsert。`initialState()` 补 `reviewByProject: {}`（同步更新 `tests/reducer.test.ts`）。

### 4.2 ReviewTab 三栏布局

```
┌─────────────────────────────────────────────┐
│ 工具栏：[🔄刷新] [分支: main ▾] [+提交]       │  顶部 Toolbar（分支 B 阶段）
├──────────────┬──────────────────────────────┤
│ 改动文件 (3)  │  src/main/index.ts            │
│ ☑ M index.ts │  diff 渲染区（DiffView）       │
│ ☑ M reducer  │                               │
│ ☐ ? new.txt  │  @@ -10,3 +10,5 @@            │
│              │  - 旧代码  + 新代码             │
├──────────────┴──────────────────────────────┤
│ [✨生成] commit message 输入框... [提交]      │  底部 CommitBar
└─────────────────────────────────────────────┘
```

### 4.3 关键交互

**复选框 ⇄ 暂存状态**（GitHub Desktop 风格，核心范式）：
- 勾选 = 该文件 `indexStatus !== null`（已暂存）
- 勾选未暂存文件 → `git.add(cwd, [path])` → 局部刷新该文件状态
- 取消勾选已暂存文件 → `git.restore(cwd, [path], {staged:true})`
- 顶部「全部暂存/全部取消」批量按钮

**diff 范围 toggle**：DiffView 顶部小 toggle，`工作区 vs HEAD`（默认）/ `仅暂存` / `仅工作区`，对应 `DiffScope`。默认 `HEAD` 一眼看到相对上次提交的总改动。

**commit 提交流程**：
```
点「提交」
  ├─ commitMessage 为空 → 自动调 generateCommitMessage → 填入 → 再提交（commitBusy 期间按钮禁用转圈）
  └─ 非空 → 直接 git.commit(cwd, message)
       → 成功 → 刷新 status + 清空 commitMessage + notice「已提交 <sha>」
       → 失败 → notice 报错（如「无可提交改动」/「请先暂存」）
```

**AI 生成按钮**：点「✨生成」→ `commitBusy=true` → `git.generateCommitMessage(cwd)` → 回填输入框（可再改）；返回 null → notice 提示，输入框保持空。

**危险操作二次确认**：丢弃工作区改动（`restore staged:false`）、`resetHard`、`amend`（改写历史）→ 复用 Electron 原生 `dialog.showMessageBox`，不自造 React 弹窗。

### 4.4 生命周期与刷新

- 进入审查 tab：该项目 `status` 为空（首次）→ 自动刷新一次。
- 手动刷新按钮：重拉 status + **清空 diffCache**。
- 写操作后（add/restore/commit/checkout）：局部刷新 status（去掉已无改动的条目）。
- 切项目：分片隔离，不动其他项目状态。
- 卸载：ReviewTab 常驻（非订阅型 IPC，全是 invoke），无需 removeAllListeners。

### 4.5 i18n

所有文案两语言都加（`i18n/index.ts`），`i18n-completeness.test.ts` 校验对齐。新增 key：`review.title` / `review.refresh` / `review.noChanges` / `review.commit` / `review.generate` / `review.confirmDiscard` / `review.staged` / `review.unstaged` / 各错误码文案。

## 5. 错误处理、边界与测试

### 5.1 错误处理

| 场景 | 处理 |
|------|------|
| 项目根不是 git 仓库 | `NOT_A_REPO`；ReviewTab 空状态「当前项目不是 git 仓库」，隐藏写操作 UI |
| git 未安装（打包版 PATH 坑） | `GIT_NOT_FOUND`；notice 提示检查 PATH（呼应 `fix-env.ts` 既有坑） |
| push/pull 凭证失败 | `AUTH_FAILED`（识别 `Authentication failed`/`403`）；notice 提示配置远程凭证 |
| merge 冲突 | `CONFLICT`；status 红标 conflicted 文件，禁用 commit，提示先解决冲突 |
| 无暂存改动 commit | `NOTHING_TO_COMMIT`（识别 `nothing to commit`）；notice「请先暂存改动」 |
| AI 生成失败 | `generateCommitMessage` 返回 `null`；notice 提示原因，**绝不让 commit 因 AI 失败阻塞** |
| diff 超大文件 | DiffView > 5000 行 → 简单截断 + 提示「显示前 N 行」。阶段 A 不做虚拟化 |

核心原则：错误经 `mkNotice`（复用 `claude-normalize.ts`）走 `claude:notice` 显示，UI 永不进入未定义状态。

### 5.2 边界与约束

1. **路径安全**（主进程写操作硬约束）：`add`/`restore`/`commit --` 的 paths，`git-service` 内 `path.relative(repoRoot, path.resolve(cwd, p))` 校验，拒绝含 `..` 越界或指向 cwd 之外的路径。
2. **commit message 注入**：用 `git commit -m <msg>` 的 args 数组传参（不拼 shell 字符串），天然防注入；多行用多个 `-m`。
3. **并发**：`git-service` 对同一 cwd 维护简单串行队列（Promise 链），保证写操作不交叉；读操作（status/diff）不加锁。
4. **大仓库 status**：不带 `--untracked-files=all`，用默认目录级 untracked，避免扫巨量未跟踪文件。
5. **打包版 PATH**（CLAUDE.md 反复强调）：`git-service` 的 `git()` 继承 `process.env`（已被 `fix-env.ts` 修正），与 SDK 子进程同源。交付前必须在打包版验证一次能找到 git。
6. **隔离**：review 状态纯内存，不持久化（git 状态实时变化，持久化无意义），不落 `~/.cc-desk/`，不碰 `~/.claude`。

### 5.3 测试策略

**`git-service.ts`**（纯 Node，重点测）— `tests/git-service.test.ts`：
- `// @vitest-environment node`（执行真 git）
- 每个测试建临时 git 仓库：`mkdtemp` → `git init` → 制造改动，互不干扰
- 覆盖：status 解析（M/A/D/R/??/MM/UU 冲突）、diff 三 scope、add/restore/commit/resetHard 行为 + 错误码、路径越界拒绝、并发队列
- **不 mock git**，真跑 git 二进制

**`generateCommitMessage` + `trimDiffForPrompt`** — `tests/commit-message.test.ts`：
- `trimDiffForPrompt`：纯函数，测截断/超长/空 diff
- `generateCommitMessage`：mock `runSideQuery`，测 prompt 拼装、返回值清理、null 回退、空 diff

**reducer** — 扩展 `tests/reducer.test.ts`：`initialState()` 补 `reviewByProject: {}` + 各 `REVIEW_*` action 的分片 upsert / 清空 / projectId 隔离。

**组件** — `tests/ReviewTab.test.tsx`（jsdom）：mock `window.api.git`，测文件列表渲染、勾选→暂存、diff 懒加载、commit 流程（含空 message 触发生成）、错误态。复用 `tests/fixtures.ts` 种子。

**真机 e2e**：push/pull 涉及网络远程，**不纳入默认 e2e**，靠手动验证。

## 6. 分阶段交付

| 阶段 | 内容 | 价值 | 发版 |
|------|------|------|------|
| **A** | git-service 基础（status/diff/add/restore/commit/resetHard）+ ReviewTab 三栏 UI + AI 生成 commit message | 完整本地「改→暂存→提交→反悔」闭环，可独立交付、可用 | `feat(review): 审查 tab 接入 git，支持改动查看与提交` |
| **B** | 分支（branch/checkout/amend）+ 工具栏分支下拉 | 多分支管理 | 独立发版 |
| **C** | push/pull + 远程状态（领先/落后） | 远程同步 | 独立发版 |

A 阶段即可发版可用，避免憋大招。B、C 各自独立发版。

## 7. 不做（YAGNI）

- 文件系统监听（fs.watch）自动刷新——跨平台可靠性坑，手动刷新足够。
- merge 冲突解决工具——超出审查 tab 范畴，只识别并提示。
- commit 历史可视化（git log 图）——B 阶段只做分支切换，不做图形化历史。
- rebase、cherry-pick、stash 等高级操作——不在本次范围。
- diff 虚拟化——阶段 A 用简单截断，性能问题真出现再加。
- AI 生成多候选 commit message——单条足够。
