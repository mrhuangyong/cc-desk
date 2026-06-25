# 文件树二进制过滤 + 图片预览 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文件树点击二进制文件不打开（灰显拦截）；图片文件在右栏用 `<img>` 居中预览（不走 Monaco）；其余文件默认走 Monaco。

**Architecture:** 新增纯函数 `fileKindOf(path)` / `toFileUrl(path)`（`src/renderer/components/fileKind.ts`，无 React 依赖、可独立单测）。两个消费点：`FileExplorerPanel`（点击时拦截 binary + 灰显）、`FileEditorPane`（image 走 `<img src="file://...">` 预览分支，binary 显示「不支持预览」兜底）。判定策略：二进制黑名单 + 图片白名单 + 默认文本。

**Tech Stack:** React + TypeScript、vitest + @testing-library/react（组件 jsdom）、纯函数测试默认 node 环境、复用 `file://` 协议加载本地图片（无 CSP、webPreferences 允许）。

## Global Constraints

- **判定策略**：二进制扩展名**黑名单**命中 → `'binary'`；图片扩展名**白名单**命中 → `'image'`；其余（含无扩展名）→ `'text'`。大小写不敏感（扩展名 `toLowerCase()`）。
- **图片 src**：`<img src="file://<绝对路径>">`，绝对路径用 `toFileUrl` 转换（posix `/a/b`→`file:///a/b`，Windows `C:\a\b`→`file:///C:/a/b`）。**不改主进程 IPC、不改 `readFileContent`**（它是 utf-8 文本读 + >200KB 抛错，不能用于图片）。
- **webPreferences**：`nodeIntegration:false` + `contextIsolation:true`（`src/main/index.ts:250-256`），渲染端不能直接 `readFileSync`，故用 file:// 而非 base64。
- **范围限定**：只改右栏 `FileExplorerPanel` 与 `FileEditorPane`。**不改左栏老 `FileTree.tsx`**、不改 `FileTab.tsx`、不改 reducer/store/IPC。
- **样式约定**：inline style + CSS 变量（`var(--text-faint)` / `var(--text)` / `var(--text-muted)` / `var(--bg)`），flex 容器带 `minHeight:0/minWidth:0`。图标 `lucide-react`。
- **测试约定**：纯函数测试（`tests/fileKind.test.ts`）默认 node 环境无需 mock；组件测试 jsdom，mock `window.api.fs`（参考 `tests/FileEditorPane.test.tsx` 现有写法）。不涉及落盘。
- **提交规范**：Conventional Commits（`feat:` / `test:` / `refactor:`），每任务结束提交。
- **YAGNI**：不做图片缩放/点击放大、不做 hex 预览、不做 magic bytes 嗅探、不加二进制特殊图标/tooltip（灰显足够）、不做 svg 预览/编辑切换。
- **i18n**：提示文案中文硬编码，与现有 FileEditorPane 风格一致，不引入新 i18n key。
- **pre-existing 失败**：全量套件有 4 个 HEAD 既有失败（store-readwrite×3 + claude-service-autocompact×1），与本特性无关，不修、不干扰，只关心本任务自己的测试。

---

### Task 1: 新增 fileKind 纯函数（fileKindOf + toFileUrl）

**Files:**
- Create: `src/renderer/components/fileKind.ts`
- Test: `tests/fileKind.test.ts`

**Interfaces:**
- Consumes: 无（纯函数，无依赖）。
- Produces: `fileKindOf(filePath: string): FileKind`（`FileKind = 'binary' | 'image' | 'text'`）、`toFileUrl(absPath: string): string`。供 Task 2/3 import。

- [ ] **Step 1: 写失败测试**

创建 `tests/fileKind.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { fileKindOf, toFileUrl } from '../src/renderer/components/fileKind'

describe('fileKindOf', () => {
  it('图片扩展名 → image', () => {
    expect(fileKindOf('/a/b.png')).toBe('image')
    expect(fileKindOf('/a/b.JPG')).toBe('image')          // 大小写不敏感
    expect(fileKindOf('/a/b.svg')).toBe('image')
    expect(fileKindOf('/a/b.webp')).toBe('image')
  })

  it('二进制扩展名 → binary', () => {
    expect(fileKindOf('/a/x.zip')).toBe('binary')
    expect(fileKindOf('/a/x.DMG')).toBe('binary')
    expect(fileKindOf('/a/x.pdf')).toBe('binary')
    expect(fileKindOf('/a/x.woff2')).toBe('binary')
    expect(fileKindOf('/a/x.exe')).toBe('binary')
  })

  it('文本扩展名 / 无扩展名 → text', () => {
    expect(fileKindOf('/a/c.ts')).toBe('text')
    expect(fileKindOf('/a/c.md')).toBe('text')
    expect(fileKindOf('/a/c.json')).toBe('text')
    expect(fileKindOf('/a/c.rs')).toBe('text')            // 陌生源码后缀也算文本
    expect(fileKindOf('/a/Makefile')).toBe('text')        // 无扩展名 → text
    expect(fileKindOf('/a/.gitignore')).toBe('text')      // 点文件无常规扩展名 → text
  })
})

describe('toFileUrl', () => {
  it('posix 绝对路径', () => {
    expect(toFileUrl('/a/b.png')).toBe('file:///a/b.png')
  })
  it('Windows 盘符路径', () => {
    expect(toFileUrl('C:\\a\\b.png')).toBe('file:///C:/a/b.png')
  })
})
```

> **注意 `.gitignore` 用例**：`lastIndexOf('.')` 返回 0（点在开头），`slice(0)` = `'.gitignore'`，不在两个集合里 → `'text'`。实现时确认这个语义符合（点开头文件视为无常规扩展名→text）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/fileKind.test.ts`
Expected: FAIL —— `fileKind` 模块不存在（无法 import）。

- [ ] **Step 3: 实现 fileKind.ts**

创建 `src/renderer/components/fileKind.ts`：

```ts
export type FileKind = 'binary' | 'image' | 'text'

const BINARY_EXTS = new Set([
  // 压缩 / 打包
  '.dmg', '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz',
  // 可执行 / 库
  '.exe', '.msi', '.dll', '.so', '.dylib', '.class', '.jar', '.bin',
  // Office 文档（二进制格式）
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 字体
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // 音视频
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.flac', '.wav', '.aac', '.ogg', '.webm',
  // 数据库 / 其它
  '.sqlite', '.db', '.lock', '.pyc', '.o',
])

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'])

export function fileKindOf(filePath: string): FileKind {
  const dot = filePath.lastIndexOf('.')
  if (dot <= 0) return 'text'                         // 无扩展名或点开头文件 → text
  const ext = filePath.slice(dot).toLowerCase()       // 大小写不敏感
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'text'
}

// 绝对路径 → file:// URL（跨平台，处理反斜杠/盘符）
export function toFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  return /^([a-zA-Z]:)/.test(normalized)
    ? `file:///${normalized}`
    : `file://${normalized}`
}
```

> **实现要点**：`dot <= 0` 同时处理「无点」（`-1`）和「点在开头」（`0`，如 `.gitignore`）两种情况，都视为 text。`dot > 0` 才取扩展名匹配。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/fileKind.test.ts`
Expected: PASS（全部用例通过）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/fileKind.ts tests/fileKind.test.ts
git commit -m "feat: 新增 fileKind 纯函数（二进制/图片/文本分类 + toFileUrl）"
```

---

### Task 2: FileExplorerPanel 点击拦截 + 二进制灰显

**Files:**
- Modify: `src/renderer/components/FileExplorerPanel.tsx`（文件行节点，约第 60-75 行）
- Modify: `tests/FileExplorerPanel.test.tsx`（补用例）

**Interfaces:**
- Consumes: `fileKindOf`（Task 1，`./fileKind`）。
- Produces: `FileExplorerPanel` 点击二进制文件不触发 `onOpenFile`；二进制文件名灰显。

- [ ] **Step 1: 写失败测试（补到现有 describe 内）**

在 `tests/FileExplorerPanel.test.tsx` 的 `describe('FileExplorerPanel', ...)` 内**追加**两个用例（保留现有 3 个用例不动）：

```tsx
  it('点击二进制文件不触发 onOpenFile', async () => {
    const tree = [
      { name: 'a.ts', path: '/proj/a.ts', isDir: false },
      { name: 'pkg.zip', path: '/proj/pkg.zip', isDir: false },
    ]
    fsMock.readTree.mockResolvedValue(tree)
    const onOpen = vi.fn()
    render(<FileExplorerPanel cwd="/proj" onOpenFile={onOpen} />)
    await waitFor(() => expect(screen.getByText('pkg.zip')).toBeTruthy())
    fireEvent.click(screen.getByText('pkg.zip'))
    expect(onOpen).not.toHaveBeenCalled()              // 二进制：拦截
  })

  it('点击图片文件触发 onOpenFile', async () => {
    fsMock.readTree.mockResolvedValue([{ name: 'pic.png', path: '/proj/pic.png', isDir: false }])
    const onOpen = vi.fn()
    render(<FileExplorerPanel cwd="/proj" onOpenFile={onOpen} />)
    await waitFor(() => expect(screen.getByText('pic.png')).toBeTruthy())
    fireEvent.click(screen.getByText('pic.png'))
    expect(onOpen).toHaveBeenCalledWith('/proj/pic.png')
  })
```

> 确认 `tests/FileExplorerPanel.test.tsx` 顶部已 import `vi`、`firefly`/`fireEvent`、`screen`、`waitFor`、`FileExplorerPanel`、`FileNode`（Task 1 阶段的现有测试已有，本任务只追加用例）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/FileExplorerPanel.test.tsx`
Expected: FAIL —— 新增的「点击二进制不触发」用例失败（当前点击任意文件都触发 onOpenFile）。

- [ ] **Step 3: 改 FileExplorerPanel 实现拦截 + 灰显**

修改 `src/renderer/components/FileExplorerPanel.tsx`：

(a) 顶部加 import：
```tsx
import { fileKindOf } from './fileKind'
```

(b) `Node` 组件的**文件行**（当前是 `onClick={() => onOpenFile(node.path)}`，文件名 `<span>`）改为：
```tsx
  const isBinary = fileKindOf(node.path) === 'binary'

  return (
    <div
      onClick={() => {
        if (isBinary) return                // 二进制：拦截，不触发 onOpenFile
        onOpenFile(node.path)
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', cursor: 'pointer', ...pad,
        color: 'var(--text)', borderRadius: 'var(--radius)',
        background: isActive ? 'var(--bg-hover)' : 'transparent',
      }}
    >
      <span style={{ width: 13 }} />
      <FileIcon size={14} />
      <span style={{ fontSize: 13, color: isBinary ? 'var(--text-faint)' : 'var(--text)' }}>{node.name}</span>
    </div>
  )
```

> 只改文件行（非目录）的渲染分支，不动目录 `toggle` 分支。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/FileExplorerPanel.test.tsx`
Expected: PASS（全部用例，含新增 2 个）。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/FileExplorerPanel.tsx tests/FileExplorerPanel.test.tsx
git commit -m "feat: 文件树点击二进制文件拦截 + 灰显"
```

---

### Task 3: FileEditorPane 图片预览分支 + binary 兜底

**Files:**
- Modify: `src/renderer/components/FileEditorPane.tsx`（在现有 markdown/Monaco 逻辑前插入分支）
- Modify: `tests/FileEditorPane.test.tsx`（补用例）

**Interfaces:**
- Consumes: `fileKindOf`、`toFileUrl`（Task 1，`./fileKind`）。
- Produces: `FileEditorPane` 对 image 类型渲染 `<img>`，对 binary 类型显示「不支持预览」。

- [ ] **Step 1: 写失败测试（补到现有 describe 内）**

在 `tests/FileEditorPane.test.tsx` 的 `describe('FileEditorPane', ...)` 内**追加**两个用例（保留现有 3 个用例不动）：

```tsx
  it('图片类型渲染 <img> 预览', async () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/pic.png" /></AppProvider>)
    const img = await screen.findByRole('img')
    expect(img.getAttribute('src')).toContain('file://')
    expect(fsMock.readFile).not.toHaveBeenCalled()     // 图片不走 readFile
  })

  it('binary 类型显示不支持预览', async () => {
    render(<AppProvider initialProjects={seedWithPath()}><FileEditorPane tabId="t1" filePath="/proj/pkg.zip" /></AppProvider>)
    await waitFor(() => expect(screen.getByText('该文件类型不支持预览')).toBeTruthy())
    expect(fsMock.readFile).not.toHaveBeenCalled()     // binary 不走 readFile
  })
```

> 确认现有文件已 import `screen`、`waitFor`（已有）。图片用例用 `findByRole('img')`（异步等待渲染）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/FileEditorPane.test.tsx`
Expected: FAIL —— 新增用例失败（当前 FileEditorPane 对任意 filePath 都走 readFile/Monaco，图片分支不存在）。

- [ ] **Step 3: 改 FileEditorPane 加图片/binary 分支**

修改 `src/renderer/components/FileEditorPane.tsx`：

(a) 顶部加 import：
```tsx
import { fileKindOf, toFileUrl } from './fileKind'
```

(b) 在组件函数体内（与现有 `useState` 声明区一起）加图片错误态：
```tsx
const [imgError, setImgError] = useState(false)
```

(c) 加一个 useEffect：filePath 变化时重置 imgError（放在现有 `useEffect(() => { filePathRef.current = filePath }, [filePath])` 附近）：
```tsx
useEffect(() => { setImgError(false) }, [filePath])
```

(d) 在现有的「无文件 / 加载 / 错误态」早返回逻辑（`if (!filePath) {...}`、`if (loading) {...}`、`if (error && !content) {...}`）**之前**插入图片与 binary 分支：
```tsx
const kind = filePath ? fileKindOf(filePath) : 'text'

if (kind === 'image') {
  if (imgError) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>图片加载失败</div>
  }
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'auto', padding: 16, minHeight: 0, background: 'var(--bg)' }}>
      <img
        src={toFileUrl(filePath)}
        alt={filePath}
        onError={() => setImgError(true)}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}

if (kind === 'binary') {
  return <div style={{ padding: 12, color: 'var(--text-muted)' }}>该文件类型不支持预览</div>
}

// —— 以下保留原有：if (!filePath) / if (loading) / if (error && !content) / markdown 切换 / Monaco ——
```

> 关键顺序：image/binary 分支必须在 `if (!filePath)` 之前判断，但因为 `kind` 已用 `filePath ? ... : 'text'` 兜底，filePath 为空时 kind='text'，不会误进图片分支。`!filePath` 分支仍由原逻辑处理。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/FileEditorPane.test.tsx`
Expected: PASS（全部用例，含新增 2 个）。

- [ ] **Step 5: 类型检查 + 全量回归**

Run: `npx tsc --noEmit`
Expected: 无报错。

Run: `npx vitest run`
Expected: 除 4 个 pre-existing 失败外全部 PASS（零回归）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/FileEditorPane.tsx tests/FileEditorPane.test.tsx
git commit -m "feat: 编辑器支持图片预览(file://) + 二进制兜底"
```

---

### Task 4: 人工验证 + 清理

**Files:** 无（验证任务）

- [ ] **Step 1: 启动 dev 验证**

Run: `pnpm dev`
验证清单（人工）：
1. 文件树里 `.zip`/`.dmg`/`.pdf` 等文件名灰显，点击无反应（不打开）。
2. 文件树里 `.png`/`.jpg`/`.svg` 等点击 → 右栏居中显示图片（file://），大图可滚动。
3. `.ts`/`.md`/`.json`/无扩展名文件点击 → 右栏 Monaco 正常。
4. 不存在的图片路径 → 右栏「图片加载失败」。
5. （兜底）手动想办法让 binary 进入编辑器 → 显示「该文件类型不支持预览」。
6. svg 文件 → 按图片预览渲染。

- [ ] **Step 2: 若有 UI 微调，修正后补充提交**

```bash
git add -A
git commit -m "fix: 图片预览/灰显 UI 微调"
```

（无问题则跳过）

---

## Self-Review

**1. Spec coverage：**
- 目标1（fileKindOf 纯函数）→ Task 1 ✓
- 目标2（二进制拦截 + 灰显）→ Task 2 ✓
- 目标3（图片预览）→ Task 3 ✓
- 目标4（文本默认 Monaco）→ Task 1 默认 text + Task 3 不改原有 Monaco 路径 ✓
- 目标5（binary 兜底）→ Task 3 `if (kind === 'binary')` ✓
- 非目标（不改 IPC/左栏 FileTree/无缩放/无 hex/无嗅探）→ 均遵守 ✓
- 图片 src 方案（file://）→ Task 1 toFileUrl + Task 3 `<img src={toFileUrl}>` ✓
- 错误处理（图片 onError/binary 兜底/无扩展名 text/大小写/Windows）→ Task 1 + Task 3 ✓
- 测试（fileKind 单测 + Explorer 点击拦截 + EditorPane 图片/binary）→ Task 1/2/3 ✓

**2. Placeholder scan：** 无 TBD/TODO。Task 2/3 的测试用例和实现代码完整。Task 4 人工验证清单具体。✓

**3. Type consistency：**
- `fileKindOf(filePath: string): FileKind`（Task 1）↔ Task 2 import 调用 `fileKindOf(node.path) === 'binary'`、Task 3 `fileKindOf(filePath)` ✓
- `toFileUrl(absPath: string): string`（Task 1）↔ Task 3 `toFileUrl(filePath)` ✓
- `FileKind = 'binary' | 'image' | 'text'` 三任务一致 ✓
- Task 3 图片/binary 分支早返回顺序已说明，`kind` 兜底避免误进 ✓
