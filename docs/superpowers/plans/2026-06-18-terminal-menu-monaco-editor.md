# 右栏终端菜单 + FileTab Monaco 编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在右栏 `+` 添加菜单补上"终端"项（终端 cwd 落在当前项目目录），并把只读的 `FileTab` 升级为 Monaco 代码编辑器（语法高亮 / 行号 / 换行 / Cmd+S 原子写 / 脏标 / 脏 tab 关闭二次确认）。

**Architecture:** 终端项为纯接线（TerminalTab 已就绪）。Monaco 编辑器每个 file tab 一个 `@monaco-editor/react` 实例，脏状态走 reducer（`dirtyTabIds`）；保存经新增的 `fs:write-file` IPC 用 tmp+rename 原子写。关闭脏 tab 时弹保存/不保存/取消确认。

**Tech Stack:** React 18 + TypeScript、Electron（ipcMain/contextBridge）、`monaco-editor` + `@monaco-editor/react`、vitest。

---

## 文件结构总览

```
src/main/file-service.ts        新增 writeFileContent（原子写）
src/main/index.ts:81            新增 ipc handle fs:write-file
src/preload/index.ts:64         新增 fs.writeFile 暴露
src/renderer/global.d.ts:58-61  FsAPI 增加 writeFile
src/renderer/types.ts:81-89     Tab 增加 cwd?: string
src/renderer/state/actions.ts   OPEN_TAB 带 cwd；新增 TAB_DIRTY
src/renderer/state/reducer.ts   OPEN_TAB 透传 cwd；TAB_DIRTY / CLOSE_TAB 处理 dirtyTabIds；AppState 增字段
src/renderer/components/TabBar.tsx  ADD_OPTIONS 加终端；脏标；关闭确认；TerminalTab 传 cwd
src/renderer/components/FileTab.tsx 重写为 Monaco 编辑器
src/renderer/editor/monacoEnv.ts    [新] loader 配置 + 主题/语言映射
tests/file-service.test.ts      [新] 原子写测试
tests/reducer.test.ts           增加 cwd / dirty 用例
```

**新增依赖**：`monaco-editor`、`@monaco-editor/react`（先于实施任务安装）。

---

## Task 0: 安装 Monaco 依赖

**Files:** 无（仅 package.json）

- [ ] **Step 1: 安装依赖**

Run: `pnpm add monaco-editor @monaco-editor/react`
Expected: 两个包写入 `package.json` dependencies。

- [ ] **Step 2: 确认安装成功**

Run: `node -e "require('monaco-editor/package.json').version; require('@monaco-editor/react/package.json').version; console.log('ok')"`
Expected: 输出 `ok`。

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: 安装 monaco-editor 与 @monaco-editor/react"
```

---

## Task 1: 主进程原子写文件（TDD）

**Files:**
- Test: `tests/file-service.test.ts`
- Modify: `src/main/file-service.ts:2`（import）、`:39` 后新增函数

- [ ] **Step 1: 写失败测试**

Create `tests/file-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileContent } from '../src/main/file-service'
import { mkdtemp, rm, readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('writeFileContent', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ccdesk-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('写入新内容到不存在的文件', async () => {
    const f = join(dir, 'a.txt')
    await writeFileContent(f, 'hello')
    expect(await readFile(f, 'utf-8')).toBe('hello')
  })

  it('覆盖已有文件内容', async () => {
    const f = join(dir, 'b.txt')
    await writeFileContent(f, 'old')
    await writeFileContent(f, 'new')
    expect(await readFile(f, 'utf-8')).toBe('new')
  })

  it('写入后不留 tmp 残留文件', async () => {
    const f = join(dir, 'c.txt')
    await writeFileContent(f, 'x')
    await expect(stat(f + '.ccdesk-tmp')).rejects.toThrow()
  })

  it('目标目录不存在时抛错，且不产生 tmp 残留', async () => {
    const f = join(dir, 'nodir', 'd.txt')
    await expect(writeFileContent(f, 'x')).rejects.toThrow()
    // dir 下不应有 ccdesk-tmp 残留
    await expect(stat(join(dir, 'nodir'))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test tests/file-service.test.ts`
Expected: FAIL，`writeFileContent is not a function`（未导出）。

- [ ] **Step 3: 实现 writeFileContent**

Modify `src/main/file-service.ts`。把第 2 行 import 改为：

```ts
import { readdir, readFile, stat, writeFile, rename } from 'fs/promises'
```

在第 39 行（`readFileContent` 函数结束）后新增：

```ts
// 原子写：先写临时文件再 rename 覆盖，避免写一半崩溃损坏原文件。
// 任一步失败均不触碰原文件，并清理 tmp。
export async function writeFileContent(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.ccdesk-tmp`
  try {
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, filePath)
  } catch (err) {
    try { await rmQuiet(tmp) } catch { /* 忽略清理失败 */ }
    throw err
  }
}

async function rmQuiet(p: string): Promise<void> {
  const { unlink } = await import('fs/promises')
  try { await unlink(p) } catch { /* noop */ }
}
```

并把顶部第二个 import 行（第 3 行 `import { join } from 'path'`）之后无需改动。

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test tests/file-service.test.ts`
Expected: 4 个用例全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/file-service.ts tests/file-service.test.ts
git commit -m "feat(fs): 原子写文件 writeFileContent（tmp+rename）"
```

---

## Task 2: 暴露 fs:write-file IPC（主进程 + preload + 类型）

**Files:**
- Modify: `src/main/index.ts:81`
- Modify: `src/preload/index.ts:64`
- Modify: `src/renderer/global.d.ts:61`

- [ ] **Step 1: 主进程注册 IPC handle**

Modify `src/main/index.ts`。把第 5 行 import 改为：

```ts
import { readDirTree, readFileContent, searchFiles, writeFileContent } from './file-service'
```

在第 81 行（`ipcMain.handle('fs:search-files', ...)`）后新增：

```ts
  ipcMain.handle('fs:write-file', async (_e, filePath: string, content: string) => writeFileContent(filePath, content))
```

- [ ] **Step 2: preload 暴露 writeFile**

Modify `src/preload/index.ts`。在 `fs` 对象（第 61-65 行）的 `searchFiles` 行后新增一行：

```ts
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
```

修改后 `fs` 块为：

```ts
  fs: {
    readTree: (dirPath: string) => ipcRenderer.invoke('fs:read-tree', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
    searchFiles: (dirPath: string) => ipcRenderer.invoke('fs:search-files', dirPath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
  },
```

- [ ] **Step 3: global.d.ts 加类型**

Modify `src/renderer/global.d.ts`。把 `FsAPI`（第 58-61 行）改为：

```ts
interface FsAPI {
  readTree(dirPath: string): Promise<any[]>
  readFile(filePath: string): Promise<string>
  writeFile(filePath: string, content: string): Promise<void>
}
```

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(fs): 暴露 fs:write-file IPC（主进程/preload/类型）"
```

---

## Task 3: reducer 支持 OPEN_TAB 带 cwd（TDD）

**Files:**
- Test: `tests/reducer.test.ts`
- Modify: `src/renderer/types.ts:81-89`、`src/renderer/state/actions.ts:11`、`src/renderer/state/reducer.ts:168`

- [ ] **Step 1: 写失败测试**

在 `tests/reducer.test.ts` 的主 `describe('reducer', ...)` 内，紧接 `'OPEN_TAB 同类型可开多个'` 用例（约第 115 行）之后插入：

```ts
  it('OPEN_TAB terminal 类型携带 cwd 写入 Tab', () => {
    const state = initialState()
    const next = reducer(state, { type: 'OPEN_TAB', tabType: 'terminal', cwd: '/proj' })
    const tab = next.tabsBySession['s1'][0]
    expect(tab.type).toBe('terminal')
    expect(tab.cwd).toBe('/proj')
  })

  it('OPEN_TAB 未传 cwd 时 Tab.cwd 为 undefined', () => {
    const state = initialState()
    const next = reducer(state, { type: 'OPEN_TAB', tabType: 'browser' })
    expect(next.tabsBySession['s1'][0].cwd).toBeUndefined()
  })
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test tests/reducer.test.ts -t "terminal 类型携带 cwd"`
Expected: FAIL（`cwd` 属性不存在 / action 类型不接受 cwd）。

- [ ] **Step 3: 给 Tab 类型加 cwd 字段**

Modify `src/renderer/types.ts`。把 `Tab`（第 81-89 行）改为：

```ts
// Tab：右栏的一个面板
export interface Tab {
  id: string
  type: TabType
  title: string
  // file 类型独有：标识打开的文件路径，用于去重
  filePath?: string
  // browser 类型独有：当前网址
  url?: string
  // terminal 类型独有：终端工作目录
  cwd?: string
}
```

- [ ] **Step 4: 给 OPEN_TAB action 加 cwd**

Modify `src/renderer/state/actions.ts`。把第 11 行：

```ts
  | { type: 'OPEN_TAB'; tabType: TabType }
```

改为：

```ts
  | { type: 'OPEN_TAB'; tabType: TabType; cwd?: string }
```

- [ ] **Step 5: reducer 透传 cwd**

Modify `src/renderer/state/reducer.ts`。把 `OPEN_TAB` case（第 168-181 行）的 `newTab` 对象改为：

```ts
      const newTab: Tab = {
        id: nextId('t'),
        type: action.tabType,
        title: action.tabType === 'browser' ? '浏览器' : action.tabType === 'terminal' ? '终端' : action.tabType === 'review' ? '审查' : '文件',
        ...(action.cwd ? { cwd: action.cwd } : {})
      }
```

- [ ] **Step 6: 运行测试验证通过**

Run: `pnpm test tests/reducer.test.ts -t "terminal 类型携带 cwd"`
Expected: PASS。再跑全量 `pnpm test tests/reducer.test.ts` 确认无回归。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/types.ts src/renderer/state/actions.ts src/renderer/state/reducer.ts tests/reducer.test.ts
git commit -m "feat(tabs): OPEN_TAB 支持 cwd，Terminal 落项目目录"
```

---

## Task 4: reducer 支持 TAB_DIRTY / dirtyTabIds（TDD）

**Files:**
- Test: `tests/reducer.test.ts`
- Modify: `src/renderer/state/actions.ts`、`src/renderer/state/reducer.ts`（AppState + TAB_DIRTY + CLOSE_TAB 清理）

- [ ] **Step 1: 写失败测试**

在 `tests/reducer.test.ts` 主 describe 内插入：

```ts
  it('TAB_DIRTY 标记与清除 dirtyTabIds', () => {
    const state = initialState()
    const a = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const tabId = a.activeTabIdBySession['s1']!
    const dirty = reducer(a, { type: 'TAB_DIRTY', tabId, dirty: true })
    expect(dirty.dirtyTabIds[tabId]).toBe(true)
    const clean = reducer(dirty, { type: 'TAB_DIRTY', tabId, dirty: false })
    expect(clean.dirtyTabIds[tabId]).toBeFalsy()
  })

  it('CLOSE_TAB 清理对应 dirty 记录', () => {
    const state = initialState()
    const a = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const tabId = a.activeTabIdBySession['s1']!
    const dirty = reducer(a, { type: 'TAB_DIRTY', tabId, dirty: true })
    const closed = reducer(dirty, { type: 'CLOSE_TAB', tabId })
    expect(closed.dirtyTabIds[tabId]).toBeUndefined()
  })
```

同时在 `tests/reducer.test.ts` 的 `initialState()` helper（第 7-30 行）返回对象里，`pendingDialog: null,` 之后补一行：

```ts
    dirtyTabIds: {},
```

（否则既有 reducer 用例的 AppState 缺该字段；此处补上让 fixture 完整。）

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test tests/reducer.test.ts -t "TAB_DIRTY"`
Expected: FAIL（`TAB_DIRTY` action 类型不存在）。

- [ ] **Step 3: actions.ts 加 TAB_DIRTY**

Modify `src/renderer/state/actions.ts`。在第 12 行 `CLOSE_TAB` 行后新增：

```ts
  | { type: 'TAB_DIRTY'; tabId: string; dirty: boolean }
```

- [ ] **Step 4: AppState 加 dirtyTabIds**

Modify `src/renderer/state/reducer.ts`。在 `AppState` interface（第 5-29 行）的 `pendingDialog` 字段后新增：

```ts
  // 脏 tab 记录：key = tabId，value = true（未保存改动）。FileTab 上报，TabBar 读取消耗。
  dirtyTabIds: Record<string, boolean>
```

- [ ] **Step 5: 实现 TAB_DIRTY 与 CLOSE_TAB 清理**

Modify `src/renderer/state/reducer.ts`。

(a) 把 `OPEN_TAB` case 之后（第 181 行 `}` 之后）插入新 case：

```ts
    case 'TAB_DIRTY': {
      const dirtyTabIds = { ...state.dirtyTabIds }
      if (action.dirty) dirtyTabIds[action.tabId] = true
      else delete dirtyTabIds[action.tabId]
      return { ...state, dirtyTabIds }
    }
```

(b) 把 `CLOSE_TAB` case（第 182-195 行）的 return 语句改为同时清理 dirtyTabIds。整个 case 替换为：

```ts
    case 'CLOSE_TAB': {
      const activeSessionId = state.activeSessionId
      const tabs = (state.tabsBySession[activeSessionId] ?? []).filter(t => t.id !== action.tabId)
      const activeTabIdBySession = { ...state.activeTabIdBySession }
      const currentActive = activeTabIdOf(state)
      if (currentActive === action.tabId) {
        activeTabIdBySession[activeSessionId] = tabs.length > 0 ? tabs[tabs.length - 1].id : null
      }
      const dirtyTabIds = { ...state.dirtyTabIds }
      delete dirtyTabIds[action.tabId]
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [activeSessionId]: tabs },
        activeTabIdBySession,
        dirtyTabIds
      }
    }
```

- [ ] **Step 6: 运行测试验证通过**

Run: `pnpm test tests/reducer.test.ts`
Expected: 全量 PASS（含新 2 个 + 既有无回归）。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/state/actions.ts src/renderer/state/reducer.ts tests/reducer.test.ts
git commit -m "feat(tabs): TAB_DIRTY / dirtyTabIds，CLOSE_TAB 清理脏记录"
```

---

## Task 5: TabBar 添加终端菜单项 + 传 cwd

**Files:**
- Modify: `src/renderer/components/TabBar.tsx:14-18`（ADD_OPTIONS）、`:30-34`（renderContent 传 cwd）、`:36-39`（addTab 注入 cwd）

- [ ] **Step 1: ADD_OPTIONS 加终端项**

Modify `src/renderer/components/TabBar.tsx`。把第 14-18 行 `ADD_OPTIONS` 改为（终端放第一位，最常用）：

```ts
const ADD_OPTIONS: { type: TabType; label: string; icon: LucideIcon }[] = [
  { type: 'terminal', label: '终端', icon: SquareTerminal },
  { type: 'browser', label: '浏览器', icon: Globe },
  { type: 'review', label: '审查', icon: FileDiff },
  { type: 'file', label: '文件', icon: FileText }
]
```

- [ ] **Step 2: renderContent 给 TerminalTab 传 cwd**

Modify `src/renderer/components/TabBar.tsx`。把 `renderContent`（第 27-34 行）的 terminal 分支改为：

```ts
  const renderContent = () => {
    const active = tabs.find(t => t.id === activeTabId)
    if (!active) return <div style={{ display: 'grid', placeItems: 'center', flex: 1, color: 'var(--text-muted)' }}>暂无打开的面板</div>
    if (active.type === 'file') return <FileTab tabId={active.id} filePath={active.filePath} />
    if (active.type === 'browser') return <BrowserTab />
    if (active.type === 'review') return <ReviewTab />
    return <TerminalTab tabId={active.id} cwd={active.cwd} />
  }
```

（注意：file 分支已同步加上 `tabId={active.id}`，供 Task 7 FileTab 上报脏标用。）

- [ ] **Step 3: addTab 注入项目 cwd**

Modify `src/renderer/components/TabBar.tsx`。把 `addTab`（第 36-39 行）改为：

```ts
  const addTab = (type: TabType) => {
    // terminal：优先落当前会话所属项目目录，回退全局 cwd
    const cwd = type === 'terminal' ? resolveTerminalCwd(state) : undefined
    dispatch({ type: 'OPEN_TAB', tabType: type, ...(cwd ? { cwd } : {}) })
    setMenuOpen(false)
  }
```

并在 `TabBar` 函数体内、`addTab` 之前新增辅助函数：

```ts
  // 终端 cwd：当前激活会话所属项目的 path，无则回退 settings.cwd
  const resolveTerminalCwd = (s: typeof state): string | undefined => {
    const project = s.projects.find(p => p.sessions.some(sess => sess.id === s.activeSessionId))
    return project?.path || s.settings.cwd || undefined
  }
```

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无类型错误（FileTab 的 props 暂时还匹配旧的，Task 6 才改 FileTab 签名——此处 `tabId` 传参会在 Task 6 之前引发 TS 报错，因此把 Step 2 的 file 分支改动推迟到 Task 6 一起做）。

**修正**：为避免中途类型断档，Step 2 中 file 分支保持原样 `<FileTab filePath={active.filePath} />`，待 Task 6 重写 FileTab 时一并改为 `<FileTab tabId={active.id} filePath={active.filePath} />`。本任务 Step 2 仅修改 terminal 分支传 `cwd`。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TabBar.tsx
git commit -m "feat(tabs): 添加菜单加终端项，终端落当前项目目录"
```

---

## Task 6: 新建 monacoEnv（loader / 主题 / 语言映射）

**Files:**
- Create: `src/renderer/editor/monacoEnv.ts`

- [ ] **Step 1: 创建 monacoEnv.ts**

Create `src/renderer/editor/monacoEnv.ts`:

```ts
// Monaco 环境配置：loader 指向本地 node_modules（非 CDN）、主题映射、语言映射。
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// 让 Monaco 从打包的本地资源加载，不依赖 CDN
loader.config({ monaco })

// cc-desk 主题 → Monaco 内置主题
export function monacoThemeFor(themeId: string): string {
  return themeId === 'codex-dark' ? 'vs-dark' : 'vs'
}

// 扩展名 → Monaco 语言 id
const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown', '.markdown': 'markdown',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'html', '.htm': 'html',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
}

export function monacoLanguageFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  const ext = filePath.slice(dot).toLowerCase()
  return LANG_BY_EXT[ext] ?? 'plaintext'
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/editor/monacoEnv.ts
git commit -m "feat(editor): Monaco 环境配置（loader/主题/语言映射）"
```

---

## Task 7: FileTab 重写为 Monaco 编辑器 + 脏标 + Cmd+S

**Files:**
- Modify: `src/renderer/components/FileTab.tsx`（整文件重写）
- Modify: `src/renderer/components/TabBar.tsx`（file 分支补 tabId）

- [ ] **Step 1: 重写 FileTab.tsx**

Overwrite `src/renderer/components/FileTab.tsx` with:

```tsx
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useStore } from '../state/store'
import { monacoThemeFor, monacoLanguageFor } from '../editor/monacoEnv'
import '../editor/monacoEnv'

export interface FileTabHandle {
  // 保存当前编辑器内容到磁盘；成功返回 true。供关闭确认流程调用。
  save: () => Promise<boolean>
}

interface Props {
  tabId: string
  filePath?: string
}

export const FileTab = forwardRef<FileTabHandle, Props>(function FileTab({ tabId, filePath }, ref) {
  const { state, dispatch } = useStore()
  const codePreview = state.settings.codePreview
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const contentRef = useRef<string>('')   // 保存时读取最新值，避免闭包过期

  // 加载文件
  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api?.fs.readFile(filePath)
      .then(text => {
        if (cancelled) return
        setContent(text)
        contentRef.current = text
      })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filePath])

  // 保存实现
  const doSave = async (): Promise<boolean> => {
    if (!filePath) return false
    try {
      await window.api?.fs.writeFile(filePath, contentRef.current)
      dispatch({ type: 'TAB_DIRTY', tabId, dirty: false })
      setError(null)
      return true
    } catch (err) {
      setError(`保存失败：${String(err?.message ?? err)}`)
      return false
    }
  }

  // 暴露 save 给父组件（关闭确认用）
  useImperativeHandle(ref, () => ({ save: doSave }), [filePath, tabId])

  const handleMount = (ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed
    // Cmd/Ctrl+S 保存
    ed.addCommand(
      // eslint-disable-next-line no-bitwise
      (window as any).monaco?.KeyMod?.CtrlCmd | (window as any).monaco?.KeyCode?.KeyS,
      () => { void doSave() }
    )
  }

  const handleChange = (value: string | undefined) => {
    const v = value ?? ''
    contentRef.current = v
    if (v !== content) {
      // 内容相对已保存版本有改动 → 置脏
      dispatch({ type: 'TAB_DIRTY', tabId, dirty: true })
    }
  }

  // 无文件 / 加载 / 错误态
  if (!filePath) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>(未指定文件)</div>
  }
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
  }
  if (error && !content) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{error}</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {error && (
        <div style={{ padding: '6px 10px', background: 'rgba(220,38,38,.12)', color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>
      )}
      <Editor
        language={monacoLanguageFor(filePath)}
        theme={monacoThemeFor(state.theme)}
        value={content}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: codePreview.fontSize,
          wordWrap: codePreview.wordWrap ? 'on' : 'off',
          lineNumbers: codePreview.showLineNumbers ? 'on' : 'off',
          minimap: { enabled: false },
          automaticLayout: true,
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  )
})
```

- [ ] **Step 2: TabBar file 分支补 tabId**

Modify `src/renderer/components/TabBar.tsx` `renderContent` 的 file 分支（Task 5 Step 2 修正后仍是原样）：

```ts
    if (active.type === 'file') return <FileTab tabId={active.id} filePath={active.filePath} />
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/FileTab.tsx src/renderer/components/TabBar.tsx
git commit -m "feat(editor): FileTab 改 Monaco 编辑器，脏标 + Cmd+S 保存"
```

---

## Task 8: TabBar 渲染脏标 + 脏 tab 关闭确认

**Files:**
- Modify: `src/renderer/components/TabBar.tsx`（标题脏标圆点、关闭按钮确认、file tab ref 注册表）

- [ ] **Step 1: 引入 ref 注册表与确认逻辑**

Modify `src/renderer/components/TabBar.tsx`。把顶部 import 第 1 行改为：

```ts
import { useState, useRef } from 'react'
```

加 import（第 4 行后）：

```ts
import type { FileTabHandle } from './FileTab'
```

在 `TabBar` 函数体内、`const [menuOpen, setMenuOpen] = useState(false)` 之后新增：

```ts
  const fileTabRefs = useRef<Record<string, FileTabHandle | null>>({})
  const [confirmTabId, setConfirmTabId] = useState<string | null>(null)
```

- [ ] **Step 2: 渲染 file 分支用回调 ref 注册**

把 `renderContent` 的 file 分支改为（用回调 ref 注册 handle）：

```ts
    if (active.type === 'file') {
      return (
        <FileTab
          ref={(h: FileTabHandle | null) => { fileTabRefs.current[active.id] = h }}
          tabId={active.id}
          filePath={active.filePath}
        />
      )
    }
```

- [ ] **Step 3: 标题渲染脏标圆点**

把 tab map 内的标题 `<span>`（约第 56 行）改为在脏时显示圆点：

```tsx
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            {state.dirtyTabIds[t.id] && (
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            )}
```

- [ ] **Step 4: 关闭按钮触发确认**

把 tab map 内的关闭 `<button>`（约第 57 行）改为：

```tsx
            <button
              onClick={async (e) => {
                e.stopPropagation()
                const isDirty = !!state.dirtyTabIds[t.id]
                if (!isDirty) {
                  dispatch({ type: 'CLOSE_TAB', tabId: t.id })
                  return
                }
                setConfirmTabId(t.id)
              }}
              style={{ fontSize: 14, opacity: 0.6, lineHeight: 1 }}
              aria-label="关闭标签"
            >×</button>
```

- [ ] **Step 5: 渲染确认弹窗**

在 `TabBar` return 的最外层 `<div>` 内、`{renderContent()}` 之前（菜单块之后）插入确认对话框：

```tsx
        {confirmTabId && (
          <>
            <div onClick={() => setConfirmTabId(null)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
            <div style={{
              position: 'absolute', top: 36, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-float)', padding: 14,
              display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220
            }}>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>该文件有未保存的改动，是否保存？</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { dispatch({ type: 'CLOSE_TAB', tabId: confirmTabId }); setConfirmTabId(null) }} style={btnStyle}>不保存</button>
                <button onClick={() => setConfirmTabId(null)} style={btnStyle}>取消</button>
                <button onClick={async () => {
                  const handle = fileTabRefs.current[confirmTabId]
                  const ok = handle ? await handle.save() : false
                  if (ok) {
                    dispatch({ type: 'CLOSE_TAB', tabId: confirmTabId })
                    setConfirmTabId(null)
                  }
                  // 保存失败：留在编辑器，保持确认框关闭以露出错误条
                  setConfirmTabId(null)
                }} style={{ ...btnStyle, background: 'var(--accent)', color: '#fff', border: 'none' }}>保存</button>
              </div>
            </div>
          </>
        )}
```

并在文件底部（`TabBar` 函数外）新增按钮样式常量：

```ts
const btnStyle: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 'var(--radius)'
}
```

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/TabBar.tsx
git commit -m "feat(tabs): tab 脏标圆点 + 脏 tab 关闭二次确认"
```

---

## Task 9: 全量测试 + 手动验证

**Files:** 无

- [ ] **Step 1: 全量单元测试**

Run: `pnpm test`
Expected: 全绿（含 file-service、reducer 新用例）。

- [ ] **Step 2: 类型与构建**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 构建成功，无类型错误。

- [ ] **Step 3: 手动验证（启动 dev）**

Run: `pnpm dev`
逐项确认：
1. 右栏 `+` 菜单第一项是"终端"；新建终端后 `pwd` 输出为当前项目目录。
2. 文件树打开一个 `.ts` 文件 → Monaco 显示语法高亮、行号。
3. 编辑内容 → tab 标题出现圆点（脏标）。
4. `Cmd+S`（mac）/ `Ctrl+S`（win）→ 圆点消失，磁盘文件已更新（用编辑器/`cat` 复核）。
5. 改后点 `×` → 弹"保存/不保存/取消"：保存→存盘后关闭；不保存→直接关；取消→停留。
6. 改一个只读文件 → `Cmd+S` → 顶部错误条 + 圆点保留 + 不关 tab。
7. 切深色主题（设置）→ 编辑器配色变深。

- [ ] **Step 4: 收尾 commit（如有验证中修复）**

```bash
# 仅在手动验证发现问题并修复后
git add -A
git commit -m "fix: 手动验证修复"
```

---

## Self-Review 记录

**Spec coverage：**
- §一 终端项 → Task 5。✓
- §一 FileTab Monaco → Task 6/7。✓
- §五 终端 cwd 来源链 → Task 5 `resolveTerminalCwd`。✓
- §六 加载/语言/脏标/保存/主题/设置/实例生命周期 → Task 6/7。✓
- §七 原子写 → Task 1。✓ IPC → Task 2。✓
- §六.6 暴露 save() → Task 7 `useImperativeHandle` + Task 8 注册表。✓
- §八 关闭确认 → Task 8。✓
- §九 错误矩阵 → Task 7 错误条 + Task 8 保存失败不关。✓
- §十 单元测试（reducer cwd/dirty/CLOSE_TAB 清理、原子写 rename 失败）→ Task 1/3/4。✓

**Placeholder scan：** 无 TBD/TODO；所有 step 含完整代码或精确命令。

**Type consistency：** `FileTabHandle.save()`（Task 7）↔ Task 8 注册表 `FileTabHandle | null`、`handle.save()` 调用一致；`TAB_DIRTY { tabId, dirty }`（Task 4 action/reducer）↔ FileTab dispatch（Task 7）↔ TabBar `dirtyTabIds`（Task 8）一致；`Tab.cwd`（Task 3）↔ TabBar `active.cwd`（Task 5）↔ TerminalTab 既有 `cwd` prop 一致。

**注意点（实施时留意）：**
- Task 7 用 `(window as any).monaco` 取 KeyCode——`@monaco-editor/react` 通过 loader 注入 `window.monaco`，在 `onMount` 时刻已就绪。若 TS 报 `monaco` 未定义，可改为从 `monaco-editor` 直接 `import { KeyMod, KeyCode }` 在 `handleMount` 内引用。
- `forwardRef` + 回调 ref（Task 8 Step 2）：`@monaco-editor/react` 不涉及，FileTab 用 `forwardRef` 暴露 handle，回调 ref 接收 handle 存入注册表，符合 React 规范。
