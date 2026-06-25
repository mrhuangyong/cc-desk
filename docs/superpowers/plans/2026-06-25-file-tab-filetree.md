# 右侧栏文件 Tab 内置文件树+内容浏览 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右侧栏「文件」tab 从依赖外部投喂 `filePath` 的单文件编辑器，改造为内置「左文件树 + 右文件内容」两栏浏览体验。

**Architecture:** 将 `FileTab.tsx` 拆为三个单元：`FileTab`（两栏容器+状态协调）、`FileExplorerPanel`（左栏按需展开文件树，新增）、`FileEditorPane`（右栏 Monaco 编辑器，逻辑迁移自现 FileTab）。文件树根取当前项目 `project.path`（回退 `settings.cwd`），点文件在当前 tab 右栏切换内容（不新开 tab）。状态保持在组件局部，不进全局 store，不动 reducer。

**Tech Stack:** React + TypeScript、`@monaco-editor/react`、`lucide-react`、inline style + CSS 变量（无 tailwind）、vitest + @testing-library/react（jsdom）、复用 `window.api.fs.*`（readTree/readFile/writeFile）。

## Global Constraints

- **样式约定**：纯 inline `style` + CSS 变量（`var(--bg-sidebar)` / `var(--border)` / `var(--bg-hover)` / `var(--text)` / `var(--text-muted)` / `var(--radius)`），图标用 `lucide-react`。无 tailwind / styled-components / CSS Modules。
- **flex 防撑破**：所有 flex 容器及子项必须带 `minHeight:0` / `minWidth:0`（项目强约定）。
- **文件树根目录推导**：`const cwd = activeProject?.path || state.settings?.cwd`，其中 `activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))`。
- **readTree 行为**：`window.api.fs.readTree(dirPath)` 主进程默认 `depth=3` 递归返回 `FileNode[]`，前端按需只渲染第一层（沿用现有 `FileTree.tsx` 的 `readLayer` 模式，不透传 depth）。
- **FileNode 类型**：`{ name: string; path: string; isDir: boolean; children?: FileNode[] }`（`src/renderer/types.ts:158`）。
- **不动全局 store / reducer**：本计划不改 `state/reducer.ts`、`state/actions.ts`。
- **提交规范**：Conventional Commits（`feat:` / `refactor:` / `test:`），每任务结束提交。
- **i18n**：本计划新增的提示文案先用中文硬编码（与现 FileTab 第 111 行 `(未指定文件)` 风格一致），不引入新 i18n key（YAGNI）。
- **测试约定**：组件测试在 jsdom，mock `window.api.fs`（参考 `tests/ReviewTab.test.tsx`）；不涉及落盘，无需 `withFakeConfigDir`。

---

### Task 1: 抽出 FileEditorPane（Monaco 编辑器，逻辑迁移自 FileTab）

**Files:**
- Create: `src/renderer/components/FileEditorPane.tsx`
- Test: `tests/FileEditorPane.test.tsx`

**Interfaces:**
- Consumes: `useStore()`（取 `state.settings.codePreview`、`state.theme`、`dispatch`）；`window.api.fs.readFile/writeFile`；`monacoThemeFor/monacoLanguageFor`（`../editor/monacoEnv`）；`MarkdownRenderer`（`./markdown/MarkdownRenderer`）。
- Produces: `FileEditorPane` 组件，props `{ filePath?: string; tabId: string }`，`forwardRef<FileEditorPaneHandle>` 暴露 `save(): Promise<boolean>`。供 Task 3 的 `FileTab` 通过 ref 链转发给 TabBar。

- [ ] **Step 1: 写失败测试**

创建 `tests/FileEditorPane.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { FileEditorPane } from '../src/renderer/components/FileEditorPane'
import { seedProjects } from './fixtures'

const fsMock = { readFile: vi.fn(), writeFile: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  ;(window as any).api = { fs: fsMock }
})

// 给种子项目补 path（FileEditorPane 自身不读 cwd，但 AppProvider 需要 store 正常初始化）
function seedWithPath() {
  return seedProjects.map(p => ({ ...p, path: p.path ?? '/proj' }))
}

describe('FileEditorPane', () => {
  it('filePath 为空时显示选择提示', () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" /></AppProvider>)
    expect(screen.getByText('选择一个文件')).toBeTruthy()
  })

  it('有 filePath 时加载并显示内容', async () => {
    fsMock.readFile.mockResolvedValue('hello world')
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/a.ts" /></AppProvider>)
    await waitFor(() => expect(fsMock.readFile).toHaveBeenCalledWith('/proj/a.ts'))
  })

  it('读取失败时显示错误', async () => {
    fsMock.readFile.mockRejectedValue(new Error('boom'))
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/a.ts" /></AppProvider>)
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy())
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/FileEditorPane.test.tsx`
Expected: FAIL —— `FileEditorPane` 模块不存在（无法 import）。

- [ ] **Step 3: 实现 FileEditorPane**

创建 `src/renderer/components/FileEditorPane.tsx`，把现 `FileTab.tsx`（第 1–162 行）的加载/保存/编辑/预览/脏标/Cmd+S 逻辑整体迁入，唯一改动：空态文案从 `(未指定文件)` 改为 `选择一个文件`，并接收 `filePath` 作 prop：

```tsx
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type MonacoNS from 'monaco-editor'
import { Eye, Pencil } from 'lucide-react'
import { useStore } from '../state/store'
import { monacoThemeFor, monacoLanguageFor } from '../editor/monacoEnv'
import { MarkdownRenderer } from './markdown/MarkdownRenderer'

export interface FileEditorPaneHandle {
  save: () => Promise<boolean>
}

interface Props {
  filePath?: string
  tabId: string
}

function isMarkdown(filePath?: string): boolean {
  if (!filePath) return false
  return /\.(md|markdown|mdown|mkd)$/i.test(filePath)
}

export const FileEditorPane = forwardRef<FileEditorPaneHandle, Props>(function FileEditorPane({ filePath, tabId }, ref) {
  const { state, dispatch } = useStore()
  const codePreview = state.settings.codePreview
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>(() => isMarkdown(filePath) ? 'preview' : 'edit')
  const contentRef = useRef<string>('')
  const loadedRef = useRef<string>('')
  const tabIdRef = useRef<string>(tabId)
  const filePathRef = useRef<string | undefined>(filePath)
  useEffect(() => { tabIdRef.current = tabId }, [tabId])
  useEffect(() => { filePathRef.current = filePath }, [filePath])

  // 加载文件
  useEffect(() => {
    if (!filePath) { setContent(''); loadedRef.current = ''; contentRef.current = ''; return }
    let cancelled = false
    setLoading(true)
    setError(null)
    window.api?.fs.readFile(filePath)
      .then(text => {
        if (cancelled) return
        setContent(text)
        contentRef.current = text
        loadedRef.current = text
      })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filePath])

  const doSave = async (): Promise<boolean> => {
    const fp = filePathRef.current
    if (!fp) return false
    try {
      await window.api?.fs.writeFile(fp, contentRef.current)
      loadedRef.current = contentRef.current
      dispatch({ type: 'TAB_DIRTY', tabId: tabIdRef.current, dirty: false })
      setError(null)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      return false
    }
  }

  useImperativeHandle(ref, () => ({ save: doSave }), [])

  const handleMount = (ed: editor.IStandaloneCodeEditor, monacoInstance: typeof MonacoNS) => {
    const KeyMod = monacoInstance.KeyMod
    const KeyCode = monacoInstance.KeyCode
    ed.addCommand(
      // eslint-disable-next-line no-bitwise
      KeyMod.CtrlCmd | KeyCode.KeyS,
      () => { void doSave() }
    )
  }

  const handleChange = (value: string | undefined) => {
    const v = value ?? ''
    contentRef.current = v
    setContent(v)
    dispatch({ type: 'TAB_DIRTY', tabId: tabIdRef.current, dirty: v !== loadedRef.current })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void doSave()
    }
  }

  if (!filePath) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>选择一个文件</div>
  }
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
  }
  if (error && !content) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{error}</div>
  }

  const showMdToggle = isMarkdown(filePath)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 }} onKeyDown={onKeyDown}>
      {error && (
        <div style={{ padding: '6px 10px', background: 'rgba(220,38,38,.12)', color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>
      )}
      {showMdToggle && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => setViewMode(m => m === 'preview' ? 'edit' : 'preview')}
            title={viewMode === 'preview' ? '切换到编辑' : '切换到预览'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)' }}
          >
            {viewMode === 'preview' ? <Pencil size={13} /> : <Eye size={13} />}
            {viewMode === 'preview' ? '编辑' : '预览'}
          </button>
        </div>
      )}
      {showMdToggle && viewMode === 'preview' ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 12, minHeight: 0 }}>
          <MarkdownRenderer text={content} />
        </div>
      ) : (
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
      )}
    </div>
  )
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/FileEditorPane.test.tsx`
Expected: PASS（3 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/FileEditorPane.tsx tests/FileEditorPane.test.tsx
git commit -m "refactor: 抽出 FileEditorPane（Monaco 编辑器逻辑迁移自 FileTab)"
```

---

### Task 2: 新增 FileExplorerPanel（左栏按需展开文件树）

**Files:**
- Create: `src/renderer/components/FileExplorerPanel.tsx`
- Test: `tests/FileExplorerPanel.test.tsx`

**Interfaces:**
- Consumes: `window.api.fs.readTree`；`FileNode`（`../types`）；`lucide-react`（Folder/File/ChevronRight）。
- Produces: `FileExplorerPanel` 组件，props `{ cwd?: string; currentFilePath?: string; onOpenFile: (path: string) => void }`。供 Task 3 的 `FileTab` 使用。

- [ ] **Step 1: 写失败测试**

创建 `tests/FileExplorerPanel.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { FileExplorerPanel } from '../src/renderer/components/FileExplorerPanel'
import type { FileNode } from '../src/renderer/types'

const fsMock = { readTree: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  ;(window as any).api = { fs: fsMock }
})

describe('FileExplorerPanel', () => {
  it('无 cwd 时显示空态', () => {
    render(<FileExplorerPanel onOpenFile={() => {}} />)
    expect(screen.getByText('未选择工作区')).toBeTruthy()
  })

  it('有 cwd 时拉取并渲染顶层文件', async () => {
    const tree: FileNode[] = [
      { name: 'a.ts', path: '/proj/a.ts', isDir: false },
      { name: 'src', path: '/proj/src', isDir: true },
    ]
    fsMock.readTree.mockResolvedValue(tree)
    render(<FileExplorerPanel cwd="/proj" onOpenFile={() => {}} />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    expect(screen.getByText('src')).toBeTruthy()
  })

  it('点击文件触发 onOpenFile', async () => {
    fsMock.readTree.mockResolvedValue([{ name: 'a.ts', path: '/proj/a.ts', isDir: false }])
    const onOpen = vi.fn()
    render(<FileExplorerPanel cwd="/proj" onOpenFile={onOpen} />)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('a.ts'))
    expect(onOpen).toHaveBeenCalledWith('/proj/a.ts')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/FileExplorerPanel.test.tsx`
Expected: FAIL —— `FileExplorerPanel` 模块不存在。

- [ ] **Step 3: 实现 FileExplorerPanel**

创建 `src/renderer/components/FileExplorerPanel.tsx`（沿用 `FileTree.tsx` 的 readLayer/Node 模型，但去掉 `OPEN_FILE_TAB` dispatch，改为回调 `onOpenFile`；去掉 onBack/project 切换语义）：

```tsx
import { useEffect, useState } from 'react'
import { Folder, File as FileIcon, ChevronRight, ChevronDown } from 'lucide-react'
import type { FileNode } from '../types'

interface Props {
  cwd?: string
  currentFilePath?: string
  onOpenFile: (path: string) => void
}

// 读单层目录（沿用 FileTree.tsx 的 readLayer 模式：readTree 默认 depth=3，前端只渲染第一层）
async function readLayer(dirPath: string): Promise<FileNode[]> {
  const tree = await window.api?.fs.readTree(dirPath)
  return tree ?? []
}

function Node({ node, depth, currentFilePath, onOpenFile }: {
  node: FileNode; depth: number; currentFilePath?: string; onOpenFile: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const willOpen = !open
    setOpen(willOpen)
    if (willOpen && children === null) {
      setLoading(true)
      try {
        const layer = await readLayer(node.path)
        setChildren(layer)
      } catch { setChildren([]) }
      finally { setLoading(false) }
    }
  }

  const pad = { paddingLeft: 8 + depth * 14 }
  const isActive = !node.isDir && node.path === currentFilePath

  if (node.isDir) {
    return (
      <div>
        <div
          onClick={toggle}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', cursor: 'pointer', ...pad, color: 'var(--text)', borderRadius: 'var(--radius)' }}
          className="ft-row"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={14} />
          <span style={{ fontSize: 13 }}>{node.name}</span>
          {loading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>…</span>}
        </div>
        {open && children && children.length > 0 && (
          <div>
            {children.map(c => (
              <Node key={c.path} node={c} depth={depth + 1} currentFilePath={currentFilePath} onOpenFile={onOpenFile} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => onOpenFile(node.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', cursor: 'pointer', ...pad,
        color: 'var(--text)', borderRadius: 'var(--radius)',
        background: isActive ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      <span style={{ width: 13 }} />
      <FileIcon size={14} />
      <span style={{ fontSize: 13 }}>{node.name}</span>
    </div>
  )
}

export function FileExplorerPanel({ cwd, currentFilePath, onOpenFile }: Props) {
  const [tree, setTree] = useState<FileNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cwd) { setTree(null); return }
    let cancelled = false
    setLoading(true); setError(null)
    readLayer(cwd)
      .then(t => { if (!cancelled) setTree(t) })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cwd])

  if (!cwd) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>未选择工作区</div>
  }
  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>
  }
  if (error) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>{error}</div>
  }
  if (!tree || tree.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>（空目录）</div>
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '4px 0' }}>
      {tree.map(n => (
        <Node key={n.path} node={n} depth={0} currentFilePath={currentFilePath} onOpenFile={onOpenFile} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/FileExplorerPanel.test.tsx`
Expected: PASS（3 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/FileExplorerPanel.tsx tests/FileExplorerPanel.test.tsx
git commit -m "feat: 新增 FileExplorerPanel（按需展开文件树，左栏组件）"
```

---

### Task 3: 改造 FileTab 为两栏容器（接入 Explorer + EditorPane + 未保存切文件确认）

**Files:**
- Modify: `src/renderer/components/FileTab.tsx`（整体重写为容器，原逻辑已迁至 Task 1/2）
- Test: `tests/FileTab.test.tsx`（新建）

**Interfaces:**
- Consumes: `FileEditorPane`（Task 1，`FileEditorPaneHandle`）、`FileExplorerPanel`（Task 2）、`useStore()`、`window.confirm`（未保存切换确认）。
- Produces: `FileTab`（`forwardRef<FileTabHandle>`，props `{ tabId: string; filePath?: string }`，`FileTabHandle.save()` 转发到内部 `FileEditorPane`）。TabBar 现有引用（`ref` 回调写入 `fileTabRefs.current[t.id]`、`filePath={t.filePath}`）**保持不变**。

- [ ] **Step 1: 写失败测试**

创建 `tests/FileTab.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { FileTab } from '../src/renderer/components/FileTab'
import { seedProjects } from './fixtures'

const fsMock = { readTree: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  ;(global as any).window = (global as any).window || {}
  ;(window as any).api = { fs: fsMock }
  fsMock.readTree.mockResolvedValue([{ name: 'a.ts', path: '/proj/a.ts', isDir: false }])
})

function seedWithPath() {
  return seedProjects.map(p => ({ ...p, path: p.path ?? '/proj' }))
}

describe('FileTab 两栏', () => {
  it('无 filePath 时渲染文件树 + 空态提示', async () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileTab tabId="t1" /></AppProvider>)
    await waitFor(() => expect(fsMock.readTree).toHaveBeenCalled())
    expect(screen.getByText('选择一个文件')).toBeTruthy()
  })

  it('点击文件树文件后右栏加载内容', async () => {
    fsMock.readFile.mockResolvedValue('hello')
    render(<AppProvider initialProjects={seedWithPath()}><FileTab tabId="t1" /></AppProvider>)
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('a.ts'))
    await waitFor(() => expect(fsMock.readFile).toHaveBeenCalledWith('/proj/a.ts'))
  })

  it('有 filePath 时右栏直接加载该文件', async () => {
    fsMock.readFile.mockResolvedValue('preset')
    render(<AppProvider initialProjects={seedWithPath()}><FileTab tabId="t1" filePath="/proj/a.ts" /></AppProvider>)
    await waitFor(() => expect(fsMock.readFile).toHaveBeenCalledWith('/proj/a.ts'))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/FileTab.test.tsx`
Expected: FAIL —— 当前 `FileTab` 无 `filePath` 时返回 `(未指定文件)`，找不到 `选择一个文件`。

- [ ] **Step 3: 重写 FileTab 为两栏容器**

整体替换 `src/renderer/components/FileTab.tsx`（保留 `FileTabHandle` 导出名称与签名，TabBar 不用改）：

```tsx
import { useRef, useState, useEffect } from 'react'
import { useStore } from '../state/store'
import { FileExplorerPanel } from './FileExplorerPanel'
import { FileEditorPane } from './FileEditorPane'
import type { FileEditorPaneHandle } from './FileEditorPane'

export interface FileTabHandle {
  save: () => Promise<boolean>
}

interface Props {
  tabId: string
  filePath?: string
}

export function FileTab({ tabId, filePath }: Props) {
  const { state } = useStore()
  const [currentFilePath, setCurrentFilePath] = useState<string | undefined>(filePath)

  // 外部投喂的 filePath 变化时同步（理论上一个 tab 的 filePath 不变，稳妥起见）
  useEffect(() => { setCurrentFilePath(filePath) }, [filePath])

  // 当前项目根目录（沿用项目通用推导）
  const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const cwd = activeProject?.path || state.settings?.cwd

  const editorRef = useRef<FileEditorPaneHandle>(null)

  // 切换文件前若有未保存改动，弹确认
  const openFile = (path: string) => {
    if (state.dirtyTabIds?.[tabId]) {
      const ok = window.confirm('当前文件有未保存改动，是否丢弃并切换？')
      if (!ok) return
    }
    setCurrentFilePath(path)
  }

  // forwardRef：把 save() 转发给内部 FileEditorPane
  // （FileTab 不再用 forwardRef + useImperativeHandle，改用 ref 对象由 TabBar 直接持有——
  //  为保持 TabBar 现有 ref 回调签名 (h: FileTabHandle | null) 兼容，这里用 forwardRef 包一层）
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, minWidth: 0 }}>
      {/* 左栏：文件树，固定宽度 */}
      <div style={{
        width: 220, minWidth: 160, maxWidth: 400,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-sidebar)',
        display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
      }}>
        <FileExplorerPanel cwd={cwd} currentFilePath={currentFilePath} onOpenFile={openFile} />
      </div>
      {/* 右栏：编辑器，flex:1 */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FileEditorPane ref={editorRef} filePath={currentFilePath} tabId={tabId} />
      </div>
    </div>
  )
}

// 兼容 TabBar 的 ref 回调：把它适配成 FileTabHandle（转发 save）
import { forwardRef } from 'react'
export const FileTabRef = forwardRef<FileTabHandle, Props>((props, ref) => {
  return <FileTabWithHandle {...props} externalRef={ref} />
})

// 为保持导出名 FileTab 同时兼容 ref，用 forwardRef 重导出
```

> **注意（实现者必读）**：上面代码块末尾的 `forwardRef` 适配是示意。实际实现时，把 `FileTab` 直接写成 `forwardRef<FileTabHandle, Props>`，内部 `useImperativeHandle(ref, () => ({ save: async () => editorRef.current?.save() ?? false }), [])` 转发到 `FileEditorPane`。完整正确实现如下，用它替换上面整个文件：

```tsx
import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useStore } from '../state/store'
import { FileExplorerPanel } from './FileExplorerPanel'
import { FileEditorPane } from './FileEditorPane'
import type { FileEditorPaneHandle } from './FileEditorPane'

export interface FileTabHandle {
  save: () => Promise<boolean>
}

interface Props {
  tabId: string
  filePath?: string
}

export const FileTab = forwardRef<FileTabHandle, Props>(function FileTab({ tabId, filePath }, ref) {
  const { state } = useStore()
  const [currentFilePath, setCurrentFilePath] = useState<string | undefined>(filePath)
  useEffect(() => { setCurrentFilePath(filePath) }, [filePath])

  const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const cwd = activeProject?.path || state.settings?.cwd

  const editorRef = useRef<FileEditorPaneHandle>(null)

  // save() 转发给内部 FileEditorPane，保持 TabBar 关闭确认流程可用
  useImperativeHandle(ref, () => ({
    save: async () => editorRef.current?.save() ?? false,
  }), [])

  const openFile = (path: string) => {
    if (state.dirtyTabIds?.[tabId]) {
      const ok = window.confirm('当前文件有未保存改动，是否丢弃并切换？')
      if (!ok) return
    }
    setCurrentFilePath(path)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, minWidth: 0 }}>
      <div style={{
        width: 220, minWidth: 160, maxWidth: 400,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-sidebar)',
        display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
      }}>
        <FileExplorerPanel cwd={cwd} currentFilePath={currentFilePath} onOpenFile={openFile} />
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FileEditorPane ref={editorRef} filePath={currentFilePath} tabId={tabId} />
      </div>
    </div>
  )
})
```

> 实现时只保留这第二个（`forwardRef` 版）代码块，删除第一个示意块。确认 `state.dirtyTabIds` 字段存在于 `AppState`（核对 `src/renderer/state/reducer.ts`，若字段名不同按实际改）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/FileTab.test.tsx`
Expected: PASS（3 个用例全过）。

- [ ] **Step 5: 核对 TabBar 引用未受影响**

检查 `src/renderer/components/TabBar.tsx` 中 `<FileTab ref={...} tabId filePath />` 的用法仍兼容（`FileTabHandle.save` 签名不变）。无需改 TabBar。

- [ ] **Step 6: 运行全量默认测试套件确认无回归**

Run: `npx vitest run`
Expected: 全部 PASS（含 reducer.test.ts、ReviewTab.test.tsx 等既有用例）。

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/components/FileTab.tsx tests/FileTab.test.tsx
git commit -m "feat: 文件 tab 改造为内置文件树+内容两栏浏览"
```

---

### Task 4: 手动验证 + 清理

**Files:** 无（验证任务）

- [ ] **Step 1: 启动 dev 跑通主流程**

Run: `pnpm dev`
验证清单（人工）：
1. 右栏 `+` 新增「文件」tab → 左侧出现当前项目文件树，右侧「选择一个文件」空态。
2. 点文件树某文件 → 右侧加载内容（Monaco），文件名高亮。
3. 编辑内容 → tab 标题出现脏标；Cmd+S 保存 → 脏标消失。
4. markdown 文件 → 「预览/编辑」切换按钮正常。
5. 未保存时点另一文件 → 弹确认框。
6. 左栏 FileTree 点文件（老路径 `OPEN_FILE_TAB`）→ 右栏 tab 仍正常显示该文件。
7. 切换不同 tab 再切回 → 文件树与编辑器状态不丢。

- [ ] **Step 2: 若有 UI 微调，修正后补充提交**

```bash
git add -A
git commit -m "fix: 文件 tab 两栏 UI 微调"
```

（无问题则跳过本步）

- [ ] **Step 3: 更新 CLAUDE.md（如有架构变化需记录）**

本改造未引入新 IPC / 新 store 字段 / 新持久化，`FileTab.tsx` 的「单文件编辑器」描述需在 CLAUDE.md「渲染端状态」或相关处补充一句「文件 tab 现内置文件树浏览」。按需提交：

```bash
git add CLAUDE.md
git commit -m "docs: 更新 FileTab 现为内置文件树浏览的说明"
```

---

## Self-Review

**1. Spec coverage：**
- 目标1（FileTab 内置两栏）→ Task 3 ✓
- 目标2（根目录=当前项目）→ Task 3 `cwd` 推导 ✓
- 目标3（可编辑 Monaco）→ Task 1 迁移全部能力 ✓
- 目标4（点文件当前 tab 切换）→ Task 3 `openFile`/`setCurrentFilePath` ✓
- 目标5（复用 fs.*）→ Task 2 readTree、Task 1 readFile/writeFile ✓
- 非目标（不改 reducer/store、左栏不动、无 watch、固定宽度）→ 均遵守 ✓
- 错误处理（未保存确认/>200KB/无 cwd）→ Task 3 openFile、Task 1 catch、Task 2 空态 ✓
- 测试（FileExplorerPanel + FileTab 浏览模式）→ Task 2、Task 3 ✓

**2. Placeholder scan：** Task 3 Step 3 含两段代码块（第一段示意 + 第二段正确实现），已明确标注「只保留第二个」。无 TBD/TODO。Task 4 为人工验证，步骤具体。✓

**3. Type consistency：**
- `FileEditorPaneHandle.save(): Promise<boolean>`（Task 1）↔ Task 3 `editorRef.current?.save()` ✓
- `FileTabHandle.save` 签名（Task 3）与 TabBar 现有 `handle.save()` 一致 ✓
- `FileExplorerPanel` props（Task 2）↔ Task 3 调用 `{ cwd, currentFilePath, onOpenFile }` ✓
- `FileNode` 字段（Global Constraints）↔ Task 2 测试与实现一致 ✓
- 待实现者核对项：`state.dirtyTabIds` 字段名（Task 3 Step 3 已标注「按 reducer.ts 实际改」）。
