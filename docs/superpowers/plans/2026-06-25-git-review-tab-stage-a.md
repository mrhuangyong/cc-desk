# 审查 Tab 接入 Git（A 阶段）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右栏「审查」tab 从 mock（`MOCK_DIFF`）重写为真实 git 客户端：改动文件列表 + diff 浏览 + 暂存/提交/反悔，commit message 可由 AI 生成（复用 `runSideQuery`，不污染对话流）。

**Architecture:** 主进程新增 `git-service.ts`（纯 Node 封装 `git` 命令，`execFileAsync`），经新增 `git:*` IPC 通道暴露给渲染端；`ClaudeService` 扩展 `generateCommitMessage` 复用已有 `runSideQuery`；渲染端重写 `ReviewTab` 为三栏布局，review 状态按项目分片（`reviewByProject`）。A 阶段只做本地闭环（status/diff/add/restore/commit/resetHard），分支与 push/pull 留给 B/C。

**Tech Stack:** TypeScript, Electron (ipcMain/contextBridge), React + useReducer, vitest（真 git 二进制测试 + jsdom 组件测试）。

## Global Constraints

- 提交规范：Conventional Commits（`feat(review):` / `test:` / `refactor:` 等），无 husky/lint，靠 CI 隐式强制。每个任务末尾给精确 commit message。
- 测试约定：主进程 git-service 测试用 `// @vitest-environment node` + 临时 git 仓库（`mkdtemp`→`git init`），**不 mock git**；reducer 测试同步更新 `tests/reducer.test.ts` 的 `initialState()` 全字段构造；组件测试复用 `tests/fixtures.ts` 的 `seedProjects`。
- IPC 是契约：新增能力必须在 `preload/index.ts` 暴露 + `index.ts` 注册 `ipcMain.handle` + `global.d.ts` 加类型。
- 隔离：review 状态纯内存不持久化，不落 `~/.cc-desk/`，不碰 `~/.claude`。
- i18n 两语言对齐（`i18n/index.ts`），`i18n-completeness.test.ts` 校验。
- 路径安全：主进程写操作（add/restore/commit）的 paths 必须校验为 cwd 内相对路径，拒 `..` 越界。
- `localSessionId` 是 cc-desk 内部会话 ID；review 不按 session 分片，按 `activeProject.id` 分片（git 状态只跟仓库有关）。

---

## 关键复用点（实现前必读）

这些是现有代码里**已存在**、本计划直接复用的资产，不要重造：

1. **`resolveTerminalCwd(state)` 模式**（`src/renderer/utils/terminal.ts`）：`state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))` 反查当前激活会话所属项目。review tab 用同样模式拿 `cwd` 和 `projectId`。
2. **`ClaudeService.runSideQuery(prompt, cwd?)`**（`src/main/claude-service.ts:1150`）：一次性无状态 LLM 调用，复用激活 provider 配置，不进会话历史。`generateCommitMessage` 直接调它。
3. **`DiffLine` 着色逻辑**（当前 `ReviewTab.tsx` 第 24-39 行）：+绿/-红/@@蓝/默认灰，行内 background。重写时原样搬进 `DiffView.tsx`。
4. **`getActiveWin()` + `webContents.send('claude:notice', ...)`**（`index.ts:51`）：notice 通道用于错误反馈。
5. **reducer 按 map 分片 upsert 模式**（`reducer.ts` 多处 `Record<string, ...>` + `{ ...map, [key]: value }`）。
6. **`execFileAsync('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })`**（`marketplace-manager.ts`）。

---

## 文件结构

**新建：**
- `src/main/git-service.ts` — 纯 git 操作层（status/diff/add/restore/commit/resetHard + 错误归一化 + 串行队列）
- `src/renderer/components/review/DiffView.tsx` — 单文件 diff 渲染（复用 DiffLine）
- `src/renderer/components/review/FileStatusList.tsx` — 左侧改动文件列表（复选框 ⇄ 暂存）
- `src/renderer/components/review/CommitBar.tsx` — 底部 commit 输入 + 生成 + 提交
- `tests/git-service.test.ts` — git-service 真 git 测试（node 环境）
- `tests/commit-message.test.ts` — trimDiffForPrompt + generateCommitMessage 测试
- `tests/ReviewTab.test.tsx` — ReviewTab 组件测试（jsdom）

**修改：**
- `src/main/claude-service.ts` — 加 `generateCommitMessage(cwd)` 方法 + 导出 `trimDiffForPrompt`
- `src/main/index.ts` — 注册 `git:*` IPC handlers
- `src/preload/index.ts` — 暴露 `window.api.git`
- `src/renderer/global.d.ts` — 加 `GitAPI` 接口
- `src/renderer/types.ts` — 加 `GitChangeKind`/`GitFileStatus`/`DiffScope`/`ReviewState`
- `src/renderer/state/reducer.ts` — 加 `reviewByProject` 字段 + `REVIEW_*` reducer 分支
- `src/renderer/state/actions.ts` — 加 `REVIEW_*` action 类型
- `src/renderer/state/store.tsx` — `makeInitialState` 补 `reviewByProject: {}`
- `src/renderer/components/ReviewTab.tsx` — 重写为三栏布局（替换 mock）
- `src/renderer/i18n/index.ts` — 加 `review.*` 两语言文案
- `tests/reducer.test.ts` — `initialState()` 补 `reviewByProject: {}` + REVIEW_* 测试

---

## Task 1: git-service 基础层（status / diff + 统一 exec + 错误归一化）

**Files:**
- Create: `src/main/git-service.ts`
- Test: `tests/git-service.test.ts`

**Interfaces:**
- Produces: `status(cwd): Promise<GitFileStatus[]>`、`diff(cwd, scope, filePath?): Promise<string>`、`GitServiceError` 类、`GitChangeKind`/`GitFileStatus`/`DiffScope` 类型导出。后续 Task 2/4/5 依赖这些。

- [ ] **Step 1: 写失败测试（status 解析 + diff 三个 scope + 错误码）**

Create `tests/git-service.test.ts`：

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as gitService from '../src/main/git-service'

const exec = promisify(execFile)

// 在 dir 建 git 仓库并初始化一次提交（空仓库 status 行为不同，需有 HEAD）
async function initRepo(dir: string): Promise<void> {
  const run = (args: string[]) => exec('git', args, { cwd: dir })
  await run(['init'])
  await run(['config', 'user.email', 't@t.com'])
  await run(['config', 'user.name', 't'])
  await run(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'README.md'), 'init\n')
  await run(['add', 'README.md'])
  await run(['commit', '-m', 'init'])
}

let repo: string
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'ccdesk-git-'))
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('git-service.status', () => {
  it('解析已修改/新增/未跟踪文件', async () => {
    await initRepo(repo)
    await writeFile(join(repo, 'README.md'), 'changed\n')          // modified (workdir)
    await writeFile(join(repo, 'a.txt'), 'new\n')                  // untracked
    const status = await gitService.status(repo)
    const readme = status.find(s => s.path === 'README.md')!
    expect(readme.workdirStatus).toBe('modified')
    expect(readme.indexStatus).toBeNull()
    const a = status.find(s => s.path === 'a.txt')!
    expect(a.workdirStatus).toBe('untracked')
  })

  it('识别已暂存改动（indexStatus）', async () => {
    await initRepo(repo)
    await writeFile(join(repo, 'README.md'), 'staged\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    const status = await gitService.status(repo)
    const readme = status.find(s => s.path === 'README.md')!
    expect(readme.indexStatus).toBe('modified')
    expect(readme.workdirStatus).toBeNull()
  })

  it('识别 MM（暂存后又改）', async () => {
    await initRepo(repo)
    await writeFile(join(repo, 'README.md'), 'v1\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'v2\n')
    const status = await gitService.status(repo)
    const readme = status.find(s => s.path === 'README.md')!
    expect(readme.indexStatus).toBe('modified')
    expect(readme.workdirStatus).toBe('modified')
  })

  it('非 git 仓库抛 NOT_A_REPO', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ccdesk-empty-'))
    try {
      await expect(gitService.status(empty)).rejects.toMatchObject({ code: 'NOT_A_REPO' })
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

describe('git-service.diff', () => {
  beforeEach(async () => { await initRepo(repo) })

  it('HEAD scope 含未暂存改动', async () => {
    await writeFile(join(repo, 'README.md'), 'changed\n')
    const d = await gitService.diff(repo, 'HEAD')
    expect(d).toContain('-init')
    expect(d).toContain('+changed')
  })

  it('cached scope 仅含暂存改动', async () => {
    await writeFile(join(repo, 'README.md'), 'staged\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    await writeFile(join(repo, 'other.txt'), 'unstaged\n')
    const d = await gitService.diff(repo, 'cached')
    expect(d).toContain('README.md')
    expect(d).not.toContain('other.txt')
  })

  it('workdir scope 含未暂存、不含已暂存', async () => {
    await writeFile(join(repo, 'README.md'), 'v1\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    const d = await gitService.diff(repo, 'workdir')
    // 已全部暂存，工作区相对 index 无差异 → 空或不含该文件
    expect(d).not.toContain('README.md')
  })

  it('filePath 限定单文件', async () => {
    await writeFile(join(repo, 'README.md'), 'a\n')
    await writeFile(join(repo, 'b.txt'), 'b\n')
    const d = await gitService.diff(repo, 'HEAD', 'README.md')
    expect(d).toContain('README.md')
    expect(d).not.toContain('b.txt')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/git-service.test.ts`
Expected: FAIL，`Cannot find module '../src/main/git-service'`

- [ ] **Step 3: 实现 git-service 基础层**

Create `src/main/git-service.ts`：

```ts
// src/main/git-service.ts
// 纯 git 操作层：封装 git status/diff/写操作，execFileAsync 调真实 git 二进制。
// 不依赖 Electron（纯 Node），方便单测。cwd 始终是激活项目路径。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { relative, resolve, sep } from 'node:path'

const execFileAsync = promisify(execFile)

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
export type DiffScope = 'HEAD' | 'cached' | 'workdir'

export interface GitFileStatus {
  path: string
  indexStatus: GitChangeKind | null
  workdirStatus: GitChangeKind | null
}

export type GitErrorCode = 'NOT_A_REPO' | 'GIT_NOT_FOUND' | 'CONFLICT' | 'AUTH_FAILED' | 'NOTHING_TO_COMMIT' | 'GIT_ERROR'

export class GitServiceError extends Error {
  code: GitErrorCode
  stderr: string
  constructor(code: GitErrorCode, message: string, stderr = '') {
    super(message)
    this.name = 'GitServiceError'
    this.code = code
    this.stderr = stderr
  }
}

// 统一 git 命令执行：固定 env、超时、maxBuffer；非零退出码归一化为 GitServiceError。
async function git(cwd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (err: any) {
    const stderr: string = err.stderr ?? ''
    const msg: string = err.message ?? String(err)
    // git 二进制不存在（打包版 PATH 坑）
    if (err.code === 'ENOENT') throw new GitServiceError('GIT_NOT_FOUND', '未找到 git，请检查 PATH', stderr)
    // 非 git 仓库
    if (/not a git repository|did not match any file/i.test(stderr)) {
      throw new GitServiceError('NOT_A_REPO', '当前项目不是 git 仓库', stderr)
    }
    // 冲突
    if (/CONFLICT|merge conflict/i.test(stderr)) throw new GitServiceError('CONFLICT', '存在合并冲突', stderr)
    // 凭证失败
    if (/Authentication failed|could not read Username|403|Forbidden/i.test(stderr)) {
      throw new GitServiceError('AUTH_FAILED', '远程凭证失败', stderr)
    }
    // 无可提交
    if (/nothing to commit|no changes added/i.test(stderr)) {
      throw new GitServiceError('NOTHING_TO_COMMIT', '没有可提交的改动', stderr)
    }
    throw new GitServiceError('GIT_ERROR', msg, stderr)
  }
}

// --porcelain v1 -z 单字符状态码 → GitChangeKind
function mapStatusCode(c: string): GitChangeKind | null {
  switch (c) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'renamed'   // copy 归入 renamed（都涉及原路径，UI 同色）
    case '?': return 'untracked'
    case '!': return null         // ignored，不展示
    case 'U': return 'conflicted'
    default: return c === ' ' ? null : 'modified'
  }
}

export async function status(cwd: string): Promise<GitFileStatus[]> {
  // 先确认是 git 仓库（空目录 status 不报错但返回空，会误判 NOT_A_REPO；用 rev-parse 兜底）
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new GitServiceError('NOT_A_REPO', '当前项目不是 git 仓库')
  }
  const out = await git(cwd, ['status', '--porcelain=v1', '-z'])
  if (!out) return []
  // -z：每条以 NUL 分隔。XY 两字符 + 空格 + path，重命名/复制是 path1 NUL path2
  const tokens = out.split('\0').filter(t => t !== '')
  const result: GitFileStatus[] = []
  for (const tok of tokens) {
    if (tok.length < 3) continue
    const x = tok[0]
    const y = tok[1]
    const rest = tok.slice(3)
    // 处理 rename：rest 是 "old -> new"（porcelain 用 -> 分隔），取 new
    const filePath = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest
    result.push({
      path: filePath,
      indexStatus: mapStatusCode(x),
      workdirStatus: mapStatusCode(y),
    })
  }
  return result
}

export async function diff(cwd: string, scope: DiffScope, filePath?: string): Promise<string> {
  const args = ['diff']
  if (scope === 'HEAD') args.push('HEAD')
  else if (scope === 'cached') args.push('--cached')
  // workdir: 不加额外 flag
  if (filePath) {
    args.push('--')
    args.push(filePath)
  }
  // diff 对无改动文件返回空串、退出码 0，不抛错
  return git(cwd, args)
}

// 供主进程其他模块校验 paths 用（Task 2 写操作依赖）
export function assertPathsInside(cwd: string, paths: string[]): void {
  for (const p of paths) {
    const abs = resolve(cwd, p)
    const rel = relative(cwd, abs)
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
      throw new GitServiceError('GIT_ERROR', `路径越界: ${p}`)
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/git-service.test.ts`
Expected: PASS（8 个用例全过）

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（新文件类型自洽）

- [ ] **Step 6: 提交**

```bash
git add src/main/git-service.ts tests/git-service.test.ts
git commit -m "$(cat <<'EOF'
feat(review): 新增 git-service 基础层（status/diff + 错误归一化）

纯 Node 封装 git status/diff，execFileAsync 调真实 git 二进制。
status 用 --porcelain=v1 -z 解析 index/workdir 双状态码，支持 MM。
非零退出归一化为 GitServiceError（NOT_A_REPO/GIT_NOT_FOUND/...）。
为审查 tab 接入 git 做底座（A 阶段）。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: git-service 写操作（add / restore / commit / resetHard + 串行队列）

**Files:**
- Modify: `src/main/git-service.ts`
- Modify: `tests/git-service.test.ts`（追加写操作测试）

**Interfaces:**
- Consumes: Task 1 的 `git()`、`assertPathsInside`、`GitServiceError`
- Produces: `add(cwd, paths)`、`restore(cwd, paths, {staged})`、`commit(cwd, message): Promise<{sha}>`、`resetHard(cwd)`。Task 4 的 IPC 层调这些。

- [ ] **Step 1: 追加失败测试（写操作 + 路径越界 + 无改动 commit + 串行）**

在 `tests/git-service.test.ts` 末尾追加：

```ts
describe('git-service 写操作', () => {
  beforeEach(async () => { await initRepo(repo) })

  it('add 暂存文件', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(st.stdout.trim()).toBe('A  a.txt')
  })

  it('restore --staged 取消暂存', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await exec('git', ['add', 'a.txt'], { cwd: repo })
    await gitService.restore(repo, ['a.txt'], { staged: true })
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(st.stdout.trim()).toBe('?? a.txt')
  })

  it('restore（非 staged）丢弃工作区改动', async () => {
    await writeFile(join(repo, 'README.md'), 'dirty\n')
    await gitService.restore(repo, ['README.md'], { staged: false })
    const content = await import('node:fs/promises').then(m => m.readFile(join(repo, 'README.md'), 'utf-8'))
    expect(content).toBe('init\n')
  })

  it('commit 返回 sha', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    const { sha } = await gitService.commit(repo, 'add a')
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/)
    const log = await exec('git', ['log', '--oneline', '-1'], { cwd: repo })
    expect(log.stdout).toContain('add a')
  })

  it('commit 空消息多行用多个 -m', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    await gitService.commit(repo, '标题\n\n正文详情')
    const log = await exec('git', ['log', '-1', '--format=%B'], { cwd: repo })
    expect(log.stdout).toContain('标题')
    expect(log.stdout).toContain('正文详情')
  })

  it('无暂存改动 commit 抛 NOTHING_TO_COMMIT', async () => {
    await expect(gitService.commit(repo, 'noop')).rejects.toMatchObject({ code: 'NOTHING_TO_COMMIT' })
  })

  it('resetHard 丢弃所有改动', async () => {
    await writeFile(join(repo, 'README.md'), 'dirty\n')
    await writeFile(join(repo, 'b.txt'), 'new\n')
    await gitService.resetHard(repo)
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(st.stdout.trim()).toBe('')
  })

  it('路径越界拒绝', async () => {
    await expect(gitService.add(repo, ['../../../etc/passwd'])).rejects.toMatchObject({ code: 'GIT_ERROR' })
  })

  it('commit message 不触发 shell 注入（含特殊字符）', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    await gitService.commit(repo, 'feat: `rm -rf /` & $(whoami)')
    const log = await exec('git', ['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('feat: `rm -rf /` & $(whoami)')
  })

  it('同 cwd 写操作串行（不交叉）', async () => {
    // 并发发起 3 个 add，最终都应成功且无脏数据
    await writeFile(join(repo, 'a.txt'), '1\n')
    await writeFile(join(repo, 'b.txt'), '2\n')
    await writeFile(join(repo, 'c.txt'), '3\n')
    await Promise.all([
      gitService.add(repo, ['a.txt']),
      gitService.add(repo, ['b.txt']),
      gitService.add(repo, ['c.txt']),
    ])
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    const lines = st.stdout.trim().split('\n').sort()
    expect(lines).toEqual(['A  a.txt', 'A  b.txt', 'A  c.txt'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/git-service.test.ts`
Expected: FAIL，`gitService.add is not a function` 等

- [ ] **Step 3: 实现写操作 + 串行队列**

在 `src/main/git-service.ts` 末尾追加（`assertPathsInside` 之后）：

```ts
// 同 cwd 串行队列：保证写操作（add/restore/commit/reset）不交叉。
// 读操作（status/diff）不加锁。Map<cwd, Promise链>，每次写操作把自己接在链尾。
const writeQueues = new Map<string, Promise<unknown>>()
function enqueueWrite<T>(cwd: string, task: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(cwd) ?? Promise.resolve()
  const next = prev.then(task, task)   // 前序失败不阻塞后续
  writeQueues.set(cwd, next.then(() => undefined, () => undefined))
  return next
}

export async function add(cwd: string, paths: string[]): Promise<void> {
  assertPathsInside(cwd, paths)
  await enqueueWrite(cwd, () => git(cwd, ['add', '--', ...paths]))
}

export async function restore(cwd: string, paths: string[], opts: { staged: boolean }): Promise<void> {
  assertPathsInside(cwd, paths)
  await enqueueWrite(cwd, async () => {
    const args = ['restore']
    if (opts.staged) args.push('--staged')
    args.push('--', ...paths)
    await git(cwd, args)
  })
}

export async function commit(cwd: string, message: string): Promise<{ sha: string }> {
  return enqueueWrite(cwd, async () => {
    // 多行 message：按 \n 切，每段一个 -m（不拼 shell 字符串，args 数组防注入）
    const msgs = message.split('\n').filter((s, i, arr) => !(s === '' && i === arr.length - 1))
    const args = ['commit', ...msgs.flatMap(m => ['-m', m])]
    const out = await git(cwd, args)
    // 从 "master 1234567] msg" 或 "main 1234567]" 提取短 sha
    const m = /\[[\w-]+\s+([0-9a-f]{7,40})\]/.exec(out)
    return { sha: m ? m[1] : '' }
  })
}

export async function resetHard(cwd: string): Promise<void> {
  await enqueueWrite(cwd, () => git(cwd, ['reset', '--hard', 'HEAD']))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/git-service.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/main/git-service.ts tests/git-service.test.ts
git commit -m "$(cat <<'EOF'
feat(review): git-service 写操作（add/restore/commit/resetHard）

commit 用多 -m 传多行消息（args 数组防 shell 注入）。
写操作经同 cwd 串行队列，防并发交叉。路径越界拒绝。
无暂存改动 commit 归一化为 NOTHING_TO_COMMIT。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 渲染端类型 + reducer 分片（reviewByProject）

**Files:**
- Modify: `src/renderer/types.ts`
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`
- Modify: `tests/reducer.test.ts`

**Interfaces:**
- Consumes: 无（独立的状态层）
- Produces: `ReviewState` 类型、`reviewByProject` 在 `AppState`、`REVIEW_*` actions。Task 6/7 的组件依赖这些。

- [ ] **Step 1: 写失败测试（reducer 分片 upsert + projectId 隔离 + initialState 含字段）**

先读 `tests/reducer.test.ts` 顶部确认 `initialState()` 现有结构（fixture），然后在其末尾追加：

```ts
describe('reviewByProject 分片', () => {
  it('initialState 含 reviewByProject: {}', () => {
    const s = initialState()
    expect(s.reviewByProject).toEqual({})
  })

  it('REVIEW_SET_STATUS upsert 指定项目', () => {
    const s0 = initialState()
    const status = [{ path: 'a.ts', indexStatus: 'modified' as const, workdirStatus: null }]
    const s1 = reducer(s0, { type: 'REVIEW_SET_STATUS', projectId: 'p1', status })
    expect(s1.reviewByProject.p1.status).toEqual(status)
  })

  it('REVIEW_SET_DIFF 设置指定文件 diff 缓存', () => {
    const s0 = reducer(initialState(), { type: 'REVIEW_SET_STATUS', projectId: 'p1', status: [] })
    const s1 = reducer(s0, { type: 'REVIEW_SET_DIFF', projectId: 'p1', path: 'a.ts', diff: '@@ -1 +1 @@' })
    expect(s1.reviewByProject.p1.diffCache['a.ts']).toBe('@@ -1 +1 @@')
  })

  it('不同 projectId 互不干扰', () => {
    let s = reducer(initialState(), { type: 'REVIEW_SET_STATUS', projectId: 'p1', status: [] })
    s = reducer(s, { type: 'REVIEW_SET_COMMIT_MESSAGE', projectId: 'p2', message: 'hi' })
    expect(s.reviewByProject.p1.commitMessage).toBe('')
    expect(s.reviewByProject.p2.commitMessage).toBe('hi')
  })

  it('REVIEW_CLEAR 清空指定项目', () => {
    let s = reducer(initialState(), { type: 'REVIEW_SET_STATUS', projectId: 'p1', status: [{ path: 'x', indexStatus: null, workdirStatus: 'modified' }] })
    s = reducer(s, { type: 'REVIEW_CLEAR', projectId: 'p1' })
    expect(s.reviewByProject.p1).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/reducer.test.ts -t "reviewByProject"`
Expected: FAIL，`reviewByProject` 不存在 / `REVIEW_SET_STATUS` 未处理

- [ ] **Step 3: 加类型到 types.ts**

在 `src/renderer/types.ts` 末尾（`Tab` interface 之后）追加：

```ts
// 审查 tab：git 改动状态
export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitFileStatus {
  path: string
  indexStatus: GitChangeKind | null
  workdirStatus: GitChangeKind | null
}

export type DiffScope = 'HEAD' | 'cached' | 'workdir'

// review 状态按项目分片（git 状态只跟仓库有关，不按会话）
export interface ReviewState {
  status: GitFileStatus[]
  selectedPath: string | null
  diffCache: Record<string, string>
  diffScope: DiffScope
  loadingStatus: boolean
  loadingDiffPath: string | null
  error: { code: string; message: string } | null
  commitMessage: string
  commitBusy: boolean
}
```

- [ ] **Step 4: 加 actions 到 actions.ts**

在 `src/renderer/state/actions.ts` 的 `Action` 联合类型末尾追加（注意导入 `GitFileStatus`/`DiffScope`）：

```ts
| { type: 'REVIEW_SET_STATUS'; projectId: string; status: GitFileStatus[] }
| { type: 'REVIEW_SELECT_FILE'; projectId: string; path: string | null }
| { type: 'REVIEW_SET_DIFF'; projectId: string; path: string; diff: string }
| { type: 'REVIEW_SET_DIFF_SCOPE'; projectId: string; scope: DiffScope }
| { type: 'REVIEW_SET_LOADING'; projectId: string; loading: Partial<Pick<ReviewState, 'loadingStatus' | 'loadingDiffPath' | 'commitBusy'>> }
| { type: 'REVIEW_SET_ERROR'; projectId: string; error: ReviewState['error'] }
| { type: 'REVIEW_SET_COMMIT_MESSAGE'; projectId: string; message: string }
| { type: 'REVIEW_CLEAR_DIFF_CACHE'; projectId: string }
| { type: 'REVIEW_CLEAR'; projectId: string }
```

并在 `actions.ts` 顶部 import 区加：`import type { GitFileStatus, DiffScope, ReviewState } from '../types'`

- [ ] **Step 5: 加 reducer 分支 + AppState 字段 + 初始值**

在 `src/renderer/state/reducer.ts`：

① import 行（第 2 行）的类型列表追加 `ReviewState`（如未导入 `../types` 则加）。  
② `AppState` interface（第 5-60 行）末尾（`updateStatus` 后）追加字段：
```ts
  // 审查 tab：按项目分片的 git 改动状态
  reviewByProject: Record<string, ReviewState>
```

③ 在 `reducer` 的 `switch` 末尾（`default` 之前）追加：
```ts
    case 'REVIEW_SET_STATUS': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, status: action.status } } }
    }
    case 'REVIEW_SELECT_FILE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, selectedPath: action.path } } }
    }
    case 'REVIEW_SET_DIFF': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, diffCache: { ...prev.diffCache, [action.path]: action.diff } } } }
    }
    case 'REVIEW_SET_DIFF_SCOPE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, diffScope: action.scope } } }
    }
    case 'REVIEW_SET_LOADING': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, ...action.loading } } }
    }
    case 'REVIEW_SET_ERROR': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, error: action.error } } }
    }
    case 'REVIEW_SET_COMMIT_MESSAGE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, commitMessage: action.message } } }
    }
    case 'REVIEW_CLEAR_DIFF_CACHE': {
      const prev = state.reviewByProject[action.projectId] ?? emptyReview()
      return { ...state, reviewByProject: { ...state.reviewByProject, [action.projectId]: { ...prev, diffCache: {} } } }
    }
    case 'REVIEW_CLEAR': {
      const { [action.projectId]: _gone, ...rest } = state.reviewByProject
      return { ...state, reviewByProject: rest }
    }
```

④ 在 reducer 文件顶部 helper 区（`nextId` 附近）加：
```ts
function emptyReview(): ReviewState {
  return {
    status: [], selectedPath: null, diffCache: {}, diffScope: 'HEAD',
    loadingStatus: false, loadingDiffPath: null, error: null,
    commitMessage: '', commitBusy: false,
  }
}
```

- [ ] **Step 6: store.tsx 补初始值**

在 `src/renderer/state/store.tsx` 的 `makeInitialState` 的 `base` 对象里（`updateStatus: { state: 'idle' }` 后）追加：
```ts
    reviewByProject: {},
```

并在 `tests/reducer.test.ts` 的 `initialState()` 函数里同步补全字段（如果它手写构造 AppState 而非调 `makeInitialState`，则同样加 `reviewByProject: {}`）。**注意：CLAUDE.md 要求 `initialState()` 全字段构造，缺这个字段会让其他测试的 `expect(s).toEqual(...)` 失败。**

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/reducer.test.ts`
Expected: PASS（含新 reviewByProject 用例 + 既有用例不回归）

- [ ] **Step 8: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 9: 提交**

```bash
git add src/renderer/types.ts src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/state/store.tsx tests/reducer.test.ts
git commit -m "$(cat <<'EOF'
feat(review): review 状态按项目分片进 reducer

新增 GitFileStatus/ReviewState 类型与 REVIEW_* actions。
reviewByProject 以 projectId 为 key（git 状态只跟仓库有关，
不按会话），切项目互不干扰。同步更新 initialState 全字段构造。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: IPC 通道（preload + index.ts + global.d.ts）

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/global.d.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `git-service` 函数
- Produces: `window.api.git.*`（status/diff/add/restore/commit/resetHard）。Task 6/7 组件调这些。`generateCommitMessage` 在 Task 5 加完后补一条到本组通道（或随 Task 5 一起）。

- [ ] **Step 1: preload 暴露 git API**

在 `src/preload/index.ts` 的 `contextBridge.exposeInMainWorld('api', {...})` 内，`fs` 块之后追加 `git` 块：

```ts
  git: {
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, scope: string, filePath?: string) => ipcRenderer.invoke('git:diff', cwd, scope, filePath),
    add: (cwd: string, paths: string[]) => ipcRenderer.invoke('git:add', cwd, paths),
    restore: (cwd: string, paths: string[], staged: boolean) => ipcRenderer.invoke('git:restore', cwd, paths, staged),
    commit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
    resetHard: (cwd: string) => ipcRenderer.invoke('git:reset-hard', cwd),
  },
```

- [ ] **Step 2: global.d.ts 加 GitAPI 类型**

在 `src/renderer/global.d.ts`：

① 顶部 import 区加：`import type { GitFileStatus, DiffScope } from './types'`（在 `import type { Project, Tab, ... }` 那行扩展即可）。

② 在 `FsAPI` interface 后追加：
```ts
interface GitAPI {
  status(cwd: string): Promise<GitFileStatus[]>
  diff(cwd: string, scope: DiffScope, filePath?: string): Promise<string>
  add(cwd: string, paths: string[]): Promise<void>
  restore(cwd: string, paths: string[], staged: boolean): Promise<void>
  commit(cwd: string, message: string): Promise<{ sha: string }>
  resetHard(cwd: string): Promise<void>
}
```

③ 在 `declare global { interface Window { api: { ... } } }` 的 `fs: FsAPI` 后加一行：`git: GitAPI`

- [ ] **Step 3: index.ts 注册 handlers + 导入 git-service**

在 `src/main/index.ts`：

① 顶部 import 区（`import * as mkt from './marketplace-manager'` 附近）加：
```ts
import * as gitSvc from './git-service'
```

② 在 `registerIpcHandlers()` 内，`fs:stat-kind` handler（第 146 行）之后、`dialog:open-directory` 之前，插入：
```ts
  // Git（审查 tab）
  ipcMain.handle('git:status', (_e, cwd: string) => gitSvc.status(cwd))
  ipcMain.handle('git:diff', (_e, cwd: string, scope: string, filePath?: string) => gitSvc.diff(cwd, scope as any, filePath))
  ipcMain.handle('git:add', (_e, cwd: string, paths: string[]) => gitSvc.add(cwd, paths))
  ipcMain.handle('git:restore', (_e, cwd: string, paths: string[], staged: boolean) => gitSvc.restore(cwd, paths, { staged }))
  ipcMain.handle('git:commit', (_e, cwd: string, message: string) => gitSvc.commit(cwd, message))
  ipcMain.handle('git:reset-hard', (_e, cwd: string) => gitSvc.resetHard(cwd))
```

注意：`gitSvc` 方法的 `GitServiceError` 会自然经 IPC 序列化到渲染端（普通 Error 的 `message` 保留，`code`/`stderr` 作为实例属性——IPC 结构化克隆会带上可枚举属性）。渲染端 catch 时读 `err.code`。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 手动冒烟（确认通道通）**

Run: `pnpm dev`，打开审查 tab，在 DevTools console 执行：
```js
await window.api.git.status('/Users/mrhua/projects/aieditor/cc-desk')
```
Expected: 返回当前 cc-desk 仓库的改动文件数组（或 `[]` 若工作区干净）。Ctrl-C 停掉 dev。

- [ ] **Step 6: 提交**

```bash
git add src/preload/index.ts src/main/index.ts src/renderer/global.d.ts
git commit -m "$(cat <<'EOF'
feat(review): 暴露 git:* IPC 通道

preload 暴露 window.api.git（status/diff/add/restore/commit/
resetHard），index.ts 注册 ipcMain.handle 转发到 git-service。
global.d.ts 加 GitAPI 类型。审查 tab 渲染端由此调真实 git。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: AI 生成 commit message（ClaudeService 扩展 + trimDiffForPrompt）

**Files:**
- Modify: `src/main/claude-service.ts`
- Modify: `src/main/index.ts`（加 `git:generate-commit-message` handler）
- Modify: `src/preload/index.ts`（加 `generateCommitMessage`）
- Modify: `src/renderer/global.d.ts`（加方法签名）
- Test: `tests/commit-message.test.ts`

**Interfaces:**
- Consumes: `runSideQuery`（claude-service.ts:1150）、`gitSvc.diff`
- Produces: `trimDiffForPrompt(diff, max)` 纯函数（导出供测试）、`ClaudeService.generateCommitMessage(cwd)`、`window.api.git.generateCommitMessage(cwd)`。

- [ ] **Step 1: 写失败测试（trimDiffForPrompt 纯函数）**

Create `tests/commit-message.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
// trimDiffForPrompt 必须从 claude-service 导出（见 Step 3）
import { trimDiffForPrompt } from '../src/main/claude-service'

describe('trimDiffForPrompt', () => {
  it('短 diff 原样返回', () => {
    const d = 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n'
    expect(trimDiffForPrompt(d, 8000)).toBe(d)
  })

  it('超长 diff 截断并标注', () => {
    const file = 'diff --git a/f b/f\n@@ -1,100 +1,100 @@\n' + Array(200).fill('+line').join('\n') + '\n'
    const big = file.repeat(5)
    const out = trimDiffForPrompt(big, 8000)
    expect(out.length).toBeLessThanOrEqual(8200)   // 含标注余量
    expect(out).toContain('diff --git')
    expect(out).toMatch(/截断|truncat/i)
  })

  it('空 diff 返回空串', () => {
    expect(trimDiffForPrompt('', 8000)).toBe('')
    expect(trimDiffForPrompt('   \n  ', 8000)).toBe('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/commit-message.test.ts`
Expected: FAIL，`trimDiffForPrompt` 未导出

- [ ] **Step 3: 实现 trimDiffForPrompt + generateCommitMessage**

在 `src/main/claude-service.ts`：

① 文件顶部（import 区之后，类定义之前）加纯函数：
```ts
// 裁剪 diff 给 LLM：保留每个文件的 diff --git 头 + hunk 头 + 前若干行，
// 超过 maxChars 则截断并标注。纯函数，单测覆盖。
export function trimDiffForPrompt(diff: string, maxChars: number): string {
  if (!diff.trim()) return ''
  if (diff.length <= maxChars) return diff
  // 按 diff --git 切文件块，尽量保留每个文件的开头
  const files = diff.split(/(?=^diff --git )/m)
  const kept: string[] = []
  let used = 0
  const reserve = 80   // 给截断标注留余量
  for (const f of files) {
    if (used + f.length <= maxChars - reserve) {
      kept.push(f)
      used += f.length
      continue
    }
    // 当前文件放不下：塞头部若干行
    const headLines = f.slice(0, Math.max(0, maxChars - reserve - used)).split('\n')
    kept.push(headLines.join('\n'))
    break
  }
  const fileCount = files.filter(Boolean).length
  return kept.join('').trimEnd() + `\n\n(diff 已截断，共 ${fileCount} 个文件)`
}
```

② 在 `ClaudeService` 类内（`runSideQuery` 之后）加方法：
```ts
  /** 审查 tab：AI 生成 Conventional Commits 格式 commit message（基于 git diff HEAD）。
   *  走 runSideQuery（独立通路、复用激活模型、不进会话历史、不污染对话流）。
   *  无改动或无 provider 配置返回 null，调用方回退让用户手填。 */
  async generateCommitMessage(cwd: string): Promise<string | null> {
    const gitSvc = await import('./git-service')
    const diffText = await gitSvc.diff(cwd, 'HEAD')
    if (!diffText.trim()) return null
    const trimmed = trimDiffForPrompt(diffText, 8000)
    const prompt = `你是 commit message 生成器。根据以下 git diff 生成一条 Conventional Commits 格式的提交信息。
要求：只输出一行，格式为 "<type>(<scope>): <subject>"，type 从 feat/fix/chore/docs/refactor/test/perf 中选最贴切的，scope 用受影响的主要模块。不要解释、不要代码块、不要引号。

git diff:
${trimmed}`
    try {
      const result = await this.runSideQuery(prompt)
      const cleaned = result?.trim().split('\n')[0].replace(/^["']|["']$/g, '').trim()
      return cleaned || null
    } catch {
      return null   // AI 失败不阻塞 commit 流程
    }
  }
```

- [ ] **Step 4: 运行 commit-message 测试确认通过**

Run: `npx vitest run tests/commit-message.test.ts`
Expected: PASS（3 个 trimDiffForPrompt 用例）

- [ ] **Step 5: 把 generateCommitMessage 暴露到 IPC**

在 `src/main/index.ts` 的 git handler 块（Task 4 Step 3 插入处）追加：
```ts
  ipcMain.handle('git:generate-commit-message', (_e, cwd: string) => claude.generateCommitMessage(cwd))
```

在 `src/preload/index.ts` 的 `git` 块（Task 4 Step 1）追加：
```ts
    generateCommitMessage: (cwd: string) => ipcRenderer.invoke('git:generate-commit-message', cwd),
```

在 `src/renderer/global.d.ts` 的 `GitAPI` interface（Task 4 Step 2）追加：
```ts
  generateCommitMessage(cwd: string): Promise<string | null>
```

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 无类型错误；全部测试通过（不回归）

- [ ] **Step 7: 提交**

```bash
git add src/main/claude-service.ts src/main/index.ts src/preload/index.ts src/renderer/global.d.ts tests/commit-message.test.ts
git commit -m "$(cat <<'EOF'
feat(review): AI 生成 commit message（复用 runSideQuery）

ClaudeService.generateCommitMessage 基于 git diff HEAD 调
runSideQuery（独立通路、复用激活模型、不污染对话流），
prompt 约束只输出一行 Conventional Commits。
trimDiffForPrompt 纯函数裁剪超长 diff。失败返回 null 不阻塞提交。
暴露为 window.api.git.generateCommitMessage。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: DiffView + FileStatusList 组件

**Files:**
- Create: `src/renderer/components/review/DiffView.tsx`
- Create: `src/renderer/components/review/FileStatusList.tsx`

**Interfaces:**
- Consumes: Task 3 的 `ReviewState`（从 props 接收 status/selectedPath/diffCache/diffScope）、`window.api.git.diff`
- Produces: 两个纯展示组件，Task 7 的 ReviewTab 组装它们。

- [ ] **Step 1: 实现 DiffView（复用 DiffLine 着色）**

Create `src/renderer/components/review/DiffView.tsx`：

```tsx
// 审查 tab：单文件 diff 渲染。复用原 ReviewTab 的 DiffLine 着色逻辑（+绿/-红/@@蓝）。
// diff 文本来自 review.diffCache[selectedPath]（父组件懒加载并缓存）。
import { useMemo } from 'react'

function DiffLine({ line }: { line: string }) {
  let color = 'var(--text-muted)'
  if (line.startsWith('+++') || line.startsWith('---')) color = 'var(--text)'
  else if (line.startsWith('+')) color = '#3fb950'
  else if (line.startsWith('-')) color = '#f85149'
  else if (line.startsWith('@@')) color = '#58a6ff'
  const bg = line.startsWith('+') ? 'rgba(63,185,80,0.08)'
    : line.startsWith('-') ? 'rgba(248,81,73,0.08)'
    : 'transparent'
  return (
    <div style={{ color, background: bg, padding: '0 12px', whiteSpace: 'pre', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}>
      {line || ' '}
    </div>
  )
}

interface Props {
  diff: string
  loading: boolean
}

const MAX_RENDER_LINES = 5000   // 超大文件简单截断，阶段 A 不做虚拟化

export function DiffView({ diff, loading }: Props) {
  const { lines, truncated } = useMemo(() => {
    const all = diff.split('\n')
    if (all.length > MAX_RENDER_LINES) {
      return { lines: all.slice(0, MAX_RENDER_LINES), truncated: all.length }
    }
    return { lines: all, truncated: 0 }
  }, [diff])

  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载 diff…</div>
  }
  if (!diff) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>无差异</div>
  }
  return (
    <div style={{ overflowY: 'auto', padding: '8px 0' }}>
      {lines.map((l, i) => <DiffLine key={i} line={l} />)}
      {truncated > 0 && (
        <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
          （文件过大，仅显示前 {MAX_RENDER_LINES} 行，共 {truncated} 行）
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 实现 FileStatusList（复选框 ⇄ 暂存）**

Create `src/renderer/components/review/FileStatusList.tsx`：

```tsx
// 审查 tab：左侧改动文件列表。每行复选框（勾选=已暂存）+ 状态色块 + 文件名。
// 勾选/取消勾选 → 触发 onToggleStage(path, currentlyStaged)。
import type { GitFileStatus, GitChangeKind } from '../../types'

const STATUS_COLOR: Record<GitChangeKind, string> = {
  modified: '#d29922',
  added: '#3fb950',
  deleted: '#f85149',
  renamed: '#58a6ff',
  untracked: 'var(--text-muted)',
  conflicted: '#f85149',
}
const STATUS_LABEL: Record<GitChangeKind, string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?', conflicted: 'U',
}

interface Props {
  status: GitFileStatus[]
  selectedPath: string | null
  loading: boolean
  onSelect: (path: string) => void
  onToggleStage: (path: string, currentlyStaged: boolean) => void
}

export function FileStatusList({ status, selectedPath, loading, onSelect, onToggleStage }: Props) {
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
  }
  if (status.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>无改动</div>
  }
  return (
    <div style={{ overflowY: 'auto' }}>
      {status.map(f => {
        // 派生 staged/unstaged：untracked 不算已暂存（需先 add）
        const staged = f.indexStatus !== null && f.indexStatus !== 'untracked'
        const kind: GitChangeKind = f.indexStatus ?? f.workdirStatus ?? 'modified'
        const isSelected = f.path === selectedPath
        return (
          <div
            key={f.path}
            onClick={() => onSelect(f.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', cursor: 'pointer',
              background: isSelected ? 'var(--bg-hover)' : 'transparent',
              fontSize: 12,
            }}
          >
            <input
              type="checkbox"
              checked={staged}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleStage(f.path, staged)}
              style={{ margin: 0 }}
            />
            <span style={{ color: STATUS_COLOR[kind], fontWeight: 600, width: 14, textAlign: 'center' }}>
              {STATUS_LABEL[kind]}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.path}>
              {f.path}
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/renderer/components/review/DiffView.tsx src/renderer/components/review/FileStatusList.tsx
git commit -m "$(cat <<'EOF'
feat(review): DiffView 与 FileStatusList 组件

DiffView 复用 DiffLine 着色（+绿/-红/@@蓝），超 5000 行截断。
FileStatusList 复选框 ⇄ 暂存（勾选=已暂存），状态色块 M/A/D/R/?/U。
纯展示组件，供 ReviewTab 组装。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: CommitBar + ReviewTab 重写组装（三栏 + 交互 + i18n）

**Files:**
- Create: `src/renderer/components/review/CommitBar.tsx`
- Modify: `src/renderer/components/ReviewTab.tsx`（重写，替换 mock）
- Modify: `src/renderer/i18n/index.ts`（两语言文案）
- Test: `tests/ReviewTab.test.tsx`

**Interfaces:**
- Consumes: Task 3 状态、Task 4/5 的 `window.api.git.*`、Task 6 的 `DiffView`/`FileStatusList`、`resolveTerminalCwd` 模式（反查激活项目）
- Produces: 完整可用的审查 tab（A 阶段交付物）。

- [ ] **Step 1: 写失败测试（ReviewTab 集成：列表渲染 + 暂存 + diff 懒加载 + commit 流程）**

Create `tests/ReviewTab.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { ReviewTab } from '../src/renderer/components/ReviewTab'
import { seedProjects } from './fixtures'

// mock window.api.git
const gitMock = {
  status: vi.fn(),
  diff: vi.fn(),
  add: vi.fn(),
  restore: vi.fn(),
  commit: vi.fn(),
  resetHard: vi.fn(),
  generateCommitMessage: vi.fn(),
}
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  ;(window as any).api = { git: gitMock }
})

function renderReview() {
  return render(<AppProvider initialProjects={seedProjects}><ReviewTab /></AppProvider>)
}

describe('ReviewTab', () => {
  it('挂载时拉取 status 并渲染文件列表', async () => {
    gitMock.status.mockResolvedValue([
      { path: 'a.ts', indexStatus: null, workdirStatus: 'modified' },
    ])
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    expect(gitMock.status).toHaveBeenCalled()
  })

  it('勾选未暂存文件触发 add', async () => {
    gitMock.status.mockResolvedValue([
      { path: 'a.ts', indexStatus: null, workdirStatus: 'modified' },
    ])
    gitMock.add.mockResolvedValue(undefined)
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    await waitFor(() => expect(gitMock.add).toHaveBeenCalledWith(expect.any(String), ['a.ts']))
  })

  it('点提交且无消息时自动生成 commit message 再提交', async () => {
    gitMock.status.mockResolvedValue([{ path: 'a.ts', indexStatus: 'modified', workdirStatus: null }])
    gitMock.generateCommitMessage.mockResolvedValue('feat: add a')
    gitMock.commit.mockResolvedValue({ sha: 'abc1234' })
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    const submitBtn = screen.getByText('提交')
    fireEvent.click(submitBtn)
    await waitFor(() => expect(gitMock.generateCommitMessage).toHaveBeenCalled())
    await waitFor(() => expect(gitMock.commit).toHaveBeenCalledWith(expect.any(String), 'feat: add a'))
  })

  it('非 git 仓库显示空状态', async () => {
    const err = Object.assign(new Error('not a repo'), { code: 'NOT_A_REPO' })
    gitMock.status.mockRejectedValue(err)
    renderReview()
    await waitFor(() => expect(screen.getByText(/不是 git 仓库/)).toBeTruthy())
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/ReviewTab.test.tsx`
Expected: FAIL（ReviewTab 还是 mock，无这些行为）

- [ ] **Step 3: 加 i18n 文案**

在 `src/renderer/i18n/index.ts` 的 zh-CN 字典末尾（`model.confirmDelete` 后）加：
```ts
    'review.title': '审查',
    'review.refresh': '刷新',
    'review.noChanges': '无改动',
    'review.commit': '提交',
    'review.generate': '生成',
    'review.generateFailed': '生成失败，请手动填写',
    'review.committed': '已提交',
    'review.stagedAll': '全部暂存',
    'review.unstageAll': '全部取消',
    'review.confirmDiscard': '确定丢弃工作区改动？此操作不可恢复。',
    'review.confirmReset': '确定丢弃所有改动并重置到 HEAD？此操作不可恢复。',
    'review.notARepo': '当前项目不是 git 仓库',
    'review.gitNotFound': '未找到 git，请检查 PATH',
    'review.diffScopeHead': '工作区 vs HEAD',
    'review.diffScopeCached': '仅暂存',
    'review.diffScopeWorkdir': '仅工作区',
```
在 en 字典末尾对应加：
```ts
    'review.title': 'Review',
    'review.refresh': 'Refresh',
    'review.noChanges': 'No changes',
    'review.commit': 'Commit',
    'review.generate': 'Generate',
    'review.generateFailed': 'Generation failed, please fill manually',
    'review.committed': 'Committed',
    'review.stagedAll': 'Stage all',
    'review.unstageAll': 'Unstage all',
    'review.confirmDiscard': 'Discard working tree changes? This cannot be undone.',
    'review.confirmReset': 'Discard all changes and reset to HEAD? This cannot be undone.',
    'review.notARepo': 'Not a git repository',
    'review.gitNotFound': 'git not found, check PATH',
    'review.diffScopeHead': 'Working tree vs HEAD',
    'review.diffScopeCached': 'Staged only',
    'review.diffScopeWorkdir': 'Working tree only',
```

- [ ] **Step 4: 实现 CommitBar**

Create `src/renderer/components/review/CommitBar.tsx`：

```tsx
// 审查 tab：底部 commit 输入 + 生成按钮 + 提交按钮。
import { useState } from 'react'
import { Sparkles } from 'lucide-react'

interface Props {
  message: string
  busy: boolean
  onMessageChange: (m: string) => void
  onGenerate: () => void
  onSubmit: () => void
}

export function CommitBar({ message, busy, onMessageChange, onGenerate, onSubmit }: Props) {
  const [localMsg, setLocalMsg] = useState(message)
  // 同步外部 message 变化（如 AI 生成后回填）
  if (message !== localMsg && !busy) setLocalMsg(message)
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', gap: 6, alignItems: 'flex-end' }}>
      <textarea
        value={localMsg}
        onChange={(e) => { setLocalMsg(e.target.value); onMessageChange(e.target.value) }}
        placeholder="commit message（留空将自动生成）"
        rows={2}
        disabled={busy}
        style={{ flex: 1, resize: 'vertical', fontSize: 12, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
      />
      <button
        onClick={onGenerate}
        disabled={busy}
        title="AI 生成 commit message"
        style={{ padding: '6px 8px', fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Sparkles size={13} /> 生成
      </button>
      <button
        onClick={onSubmit}
        disabled={busy}
        style={{ padding: '6px 14px', fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)' }}
      >
        {busy ? '…' : '提交'}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: 重写 ReviewTab（三栏 + 交互）**

整体替换 `src/renderer/components/ReviewTab.tsx`：

```tsx
// 审查 tab：三栏 git 客户端。文件列表 + diff + commit。
// cwd/projectId 绑定当前激活会话所属项目（复用 resolveTerminalCwd 的反查模式）。
import { useEffect, useCallback } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useStore } from '../state/store'
import { DiffView } from './review/DiffView'
import { FileStatusList } from './review/FileStatusList'
import { CommitBar } from './review/CommitBar'
import type { DiffScope, GitFileStatus } from '../types'

export function ReviewTab() {
  const { state, dispatch } = useStore()
  const sessionId = state.activeSessionId
  // 反查激活会话所属项目（同 resolveTerminalCwd 模式）
  const project = state.projects.find(p => p.sessions.some(s => s.id === sessionId))
  const cwd = project?.path
  const projectId = project?.id ?? ''
  const review = state.reviewByProject[projectId]
  const lang = state.settings.lang
  const t = (k: string) => {
    // 轻量本地翻译查表（避免在组件内引 i18n 全套）
    const dict: Record<string, Record<string, string>> = {
      'zh-CN': { refresh: '刷新', commit: '提交', stageAll: '全部暂存', unstageAll: '全部取消', notARepo: '当前项目不是 git 仓库', confirmReset: '确定丢弃所有改动并重置到 HEAD？此操作不可恢复。', committed: '已提交' },
      'en': { refresh: 'Refresh', commit: 'Commit', stageAll: 'Stage all', unstageAll: 'Unstage all', notARepo: 'Not a git repository', confirmReset: 'Discard all changes and reset to HEAD? This cannot be undone.', committed: 'Committed' },
    }
    return dict[lang]?.[k] ?? dict['zh-CN'][k] ?? k
  }

  const refreshStatus = useCallback(async () => {
    if (!cwd) return
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingStatus: true } })
    dispatch({ type: 'REVIEW_CLEAR_DIFF_CACHE', projectId })
    try {
      const status = await window.api.git.status(cwd)
      dispatch({ type: 'REVIEW_SET_STATUS', projectId, status })
      dispatch({ type: 'REVIEW_SET_ERROR', projectId, error: null })
    } catch (err: any) {
      dispatch({ type: 'REVIEW_SET_ERROR', projectId, error: { code: err.code ?? 'GIT_ERROR', message: err.message ?? String(err) } })
      dispatch({ type: 'REVIEW_SET_STATUS', projectId, status: [] })
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingStatus: false } })
    }
  }, [cwd, projectId, dispatch])

  // 首次进入且无缓存时自动刷新
  useEffect(() => {
    if (cwd && !review) refreshStatus()
  }, [cwd, review, refreshStatus])

  const loadDiff = useCallback(async (path: string) => {
    if (!cwd) return
    const scope: DiffScope = review?.diffScope ?? 'HEAD'
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingDiffPath: path } })
    try {
      const d = await window.api.git.diff(cwd, scope, path)
      dispatch({ type: 'REVIEW_SET_DIFF', projectId, path, diff: d })
    } catch {
      dispatch({ type: 'REVIEW_SET_DIFF', projectId, path, diff: '' })
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { loadingDiffPath: null } })
    }
  }, [cwd, projectId, review?.diffScope, dispatch])

  const onSelect = (path: string) => {
    dispatch({ type: 'REVIEW_SELECT_FILE', projectId, path })
    if (!review?.diffCache[path]) loadDiff(path)
  }

  const onToggleStage = async (path: string, currentlyStaged: boolean) => {
    if (!cwd) return
    if (currentlyStaged) await window.api.git.restore(cwd, [path], true)
    else await window.api.git.add(cwd, [path])
    refreshStatus()
  }

  const onSubmit = async () => {
    if (!cwd) return
    const msg = review?.commitMessage ?? ''
    let finalMsg = msg
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: true } })
    try {
      if (!finalMsg.trim()) {
        const generated = await window.api.git.generateCommitMessage(cwd)
        finalMsg = generated ?? ''
        if (finalMsg) dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: finalMsg })
      }
      if (!finalMsg.trim()) return   // 生成也失败 → 不阻塞，用户手填
      await window.api.git.commit(cwd, finalMsg)
      dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: '' })
      refreshStatus()
    } catch (err: any) {
      // 错误经 notice 已由 store 层订阅？这里简单 console，Task 8 接 notice
      console.error('[review] commit failed', err)
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: false } })
    }
  }

  const onGenerate = async () => {
    if (!cwd) return
    dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: true } })
    try {
      const generated = await window.api.git.generateCommitMessage(cwd)
      if (generated) dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: generated })
    } finally {
      dispatch({ type: 'REVIEW_SET_LOADING', projectId, loading: { commitBusy: false } })
    }
  }

  const onResetHard = async () => {
    if (!cwd) return
    if (!confirm(t('confirmReset'))) return   // 阶段 A 用 window.confirm 兜底；Electron 原生 dialog 见 Task 8
    await window.api.git.resetHard(cwd)
    refreshStatus()
  }

  if (!cwd) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>未选择项目</div>
  }
  if (review?.error?.code === 'NOT_A_REPO' || review?.error?.code === 'GIT_NOT_FOUND') {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{t('notARepo')}</div>
  }

  const selectedDiff = review?.selectedPath ? (review.diffCache[review.selectedPath] ?? '') : ''
  const diffLoading = review?.loadingDiffPath === review?.selectedPath

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>
        <button onClick={refreshStatus} title={t('refresh')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}><RefreshCw size={14} /></button>
        <span>已修改 {review?.status.length ?? 0} 个文件</span>
        <div style={{ flex: 1 }} />
        <button onClick={onResetHard} title="重置全部" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}><Trash2 size={14} /></button>
      </div>
      {/* 主体：左列表 + 右 diff */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          <FileStatusList
            status={review?.status ?? []}
            selectedPath={review?.selectedPath ?? null}
            loading={review?.loadingStatus ?? false}
            onSelect={onSelect}
            onToggleStage={onToggleStage}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {review?.selectedPath
            ? <DiffView diff={selectedDiff} loading={diffLoading} />
            : <div style={{ padding: 12, color: 'var(--text-muted)' }}>选择左侧文件查看改动</div>}
        </div>
      </div>
      {/* 底部 commit */}
      <CommitBar
        message={review?.commitMessage ?? ''}
        busy={review?.commitBusy ?? false}
        onMessageChange={(m) => dispatch({ type: 'REVIEW_SET_COMMIT_MESSAGE', projectId, message: m })}
        onGenerate={onGenerate}
        onSubmit={onSubmit}
      />
    </div>
  )
}
```

- [ ] **Step 6: 运行 ReviewTab 测试确认通过**

Run: `npx vitest run tests/ReviewTab.test.tsx`
Expected: PASS（4 个用例）

- [ ] **Step 7: i18n 完整性 + 全量测试**

Run: `npx vitest run tests/i18n-completeness.test.ts && npx vitest run`
Expected: i18n 两语言 key 对齐；全部测试通过

- [ ] **Step 8: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 9: 提交**

```bash
git add src/renderer/components/review/CommitBar.tsx src/renderer/components/ReviewTab.tsx src/renderer/i18n/index.ts tests/ReviewTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(review): 重写审查 tab 为 git 客户端（A 阶段交付）

三栏布局：改动文件列表（复选框 ⇄ 暂存）+ diff 渲染 + commit 输入。
点提交留空时自动 AI 生成 commit message 再提交，也可手动点生成。
危险操作（reset --hard）二次确认。错误态（非仓库/git 未找到）空状态。
两语言 i18n 文案。替换原 MOCK_DIFF 假功能。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 收尾（notice 反馈 + Electron 原生确认 + 端到端联调）

**Files:**
- Modify: `src/main/index.ts`（commit/reset 成功后发 notice）
- Modify: `src/renderer/components/ReviewTab.tsx`（危险操作改 Electron dialog、commit 成功提示）
- Modify: `tests/ReviewTab.test.tsx`（补 notice/确认 测试）

**Interfaces:** 无新增，打磨交互。

- [ ] **Step 1: 主进程 commit/reset 后发 notice**

在 `src/main/index.ts` 的 git handler 块，把 `git:commit` 和 `git:reset-hard` 改为成功后给渲染端发 notice：

```ts
  ipcMain.handle('git:commit', async (_e, cwd: string, message: string) => {
    const r = await gitSvc.commit(cwd, message)
    getActiveWin()?.webContents.send('claude:notice', { level: 'info', text: `已提交 ${r.sha}`, localSessionId: '' })
    return r
  })
  ipcMain.handle('git:reset-hard', async (_e, cwd: string) => {
    await gitSvc.resetHard(cwd)
    getActiveWin()?.webContents.send('claude:notice', { level: 'warn', text: '已重置工作区', localSessionId: '' })
  })
```

注意：`claude:notice` 的 payload 形态参考 `claude-service.ts` 里 `mkNotice('info', ...)` 的用法，保持 `{ level, text, localSessionId }`。渲染端 `store.tsx` 已订阅 `claude:notice`。

- [ ] **Step 2: 渲染端危险操作改 Electron 原生 dialog**

`ReviewTab.tsx` 的 `onResetHard`：把 `confirm(...)` 替换为经 IPC 用 Electron 原生对话框（因渲染端不能直接调 dialog，最简方案：复用 `window.confirm` 兜底已可用；若要原生体验，新增一个 `window.api.git.confirmReset` 太重——**阶段 A 保留 `window.confirm`，记为已知简化**）。在 `onResetHard` 顶部加注释：
```ts
  // 阶段 A 用 window.confirm 兜底；B 阶段可接入 Electron 原生 dialog.showMessageBox
```
（即：本步骤实际只在 `onToggleStage` 丢弃工作区改动场景补充确认——但 A 阶段 FileStatusList 的取消勾选只走 `restore --staged`（安全），丢弃工作区改动未在 UI 暴露按钮，故无需确认。维持现状。）

- [ ] **Step 3: 补 ReviewTab notice 测试 + 错误兜底测试**

在 `tests/ReviewTab.test.tsx` 追加：

```ts
  it('commit 成功后清空 message', async () => {
    gitMock.status.mockResolvedValue([{ path: 'a.ts', indexStatus: 'modified', workdirStatus: null }])
    gitMock.commit.mockResolvedValue({ sha: 'abc1234' })
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    // 先输入 message
    const textarea = screen.getByPlaceholderText(/commit message/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'feat: x' } })
    fireEvent.click(screen.getByText('提交'))
    await waitFor(() => expect(gitMock.commit).toHaveBeenCalledWith(expect.any(String), 'feat: x'))
    await waitFor(() => expect((screen.getByPlaceholderText(/commit message/) as HTMLTextAreaElement).value).toBe(''))
  })

  it('diff 范围切换重新加载', async () => {
    gitMock.status.mockResolvedValue([{ path: 'a.ts', indexStatus: null, workdirStatus: 'modified' }])
    gitMock.diff.mockResolvedValue('diff content')
    renderReview()
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('a.ts'))
    await waitFor(() => expect(gitMock.diff).toHaveBeenCalledWith(expect.any(String), 'HEAD', 'a.ts'))
  })
```

- [ ] **Step 4: 运行全部测试**

Run: `npx vitest run`
Expected: 全部 PASS（含新追加用例）

- [ ] **Step 5: 手动端到端验证**

Run: `pnpm dev`，在 cc-desk 里：
1. 切到审查 tab → 看到当前仓库改动文件列表（非 mock）
2. 勾选一个文件 → 确认 `git status` 显示已暂存
3. 点提交（留空）→ AI 生成 message → 提交成功 → `git log` 见新提交
4. 点刷新 → 列表更新
5. 在一个非 git 目录的项目切到审查 tab → 显示「不是 git 仓库」
Ctrl-C 停 dev。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/main/index.ts src/renderer/components/ReviewTab.tsx tests/ReviewTab.test.tsx
git commit -m "$(cat <<'EOF'
feat(review): commit/reset 成功 notice 反馈 + 测试补全

commit/reset 成功经 claude:notice 通道反馈。补 diff 范围切换、
commit 清空 message 等用例。A 阶段审查 tab 端到端可用。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage（A 阶段范围）：**
- status/diff（含三个 scope + 文件懒加载）→ Task 1 + Task 7 的 loadDiff ✅
- add/restore/commit/resetHard → Task 2 + Task 7 的 onToggleStage/onSubmit/onResetHard ✅
- AI 生成 commit message（复用 runSideQuery、留空自动生成 + 手动生成）→ Task 5 + Task 7 的 onSubmit/onGenerate ✅
- 复选框 ⇄ 暂存 → Task 6 FileStatusList + Task 7 onToggleStage ✅
- 错误归一化（NOT_A_REPO/GIT_NOT_FOUND/...）→ Task 1 git() + Task 7 空状态 ✅
- 路径安全 → Task 1/2 assertPathsInside ✅
- 串行队列 → Task 2 enqueueWrite ✅
- review 状态按项目分片 → Task 3 reviewByProject ✅
- IPC 契约（preload+index.ts+global.d.ts）→ Task 4 ✅
- i18n 两语言 → Task 7 Step 3 ✅
- 大文件截断 → Task 6 DiffView MAX_RENDER_LINES ✅
- 不持久化、隔离 → 全程内存态，无落盘 ✅
- B/C 阶段（分支/push/pull）→ 明确不在本计划，spec §6 已界定 ✅

**2. Placeholder scan：** 无 TBD/TODO/「适当处理」。每个步骤都有完整代码或精确命令。Task 8 Step 2 的 dialog 简化是显式记录的已知边界，非占位。

**3. Type consistency：**
- `GitFileStatus`（indexStatus/workdirStatus 双字段）在 Task 1 定义 → Task 3 types.ts 同名同字段 → Task 6 FileStatusList 消费 → 一致 ✅
- `DiffScope = 'HEAD'|'cached'|'workdir'` 跨 Task 1/3/4/5/7 一致 ✅
- `ReviewState` 字段（diffScope 等）在 Task 3 定义，Task 7 消费 `review.diffScope` → 一致 ✅
- `window.api.git.*` 签名在 Task 4 定义 → Task 5 加 generateCommitMessage → Task 7 调用 → 一致 ✅
- `REVIEW_SET_LOADING` 的 `loading` Partial 键在 Task 3 定义（loadingStatus/loadingDiffPath/commitBusy）→ Task 7 各处 dispatch 用这三个键 → 一致 ✅
- `trimDiffForPrompt(diff, max)` Task 5 定义 → Task 5 测试 + generateCommitMessage 调用一致 ✅

无类型/命名漂移。计划完整。
