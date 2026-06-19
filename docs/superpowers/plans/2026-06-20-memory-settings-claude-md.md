# 记忆设置（CLAUDE.md 编辑器）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页新增「记忆」子页，用 Monaco 编辑器编辑 cc-desk 全局 `~/.cc-desk/claude/CLAUDE.md`，内容变更后防抖 1.2 秒自动保存，失焦兜底。

**Architecture:** 主进程通过新 IPC 通道 `cc:memory:get`/`cc:memory:save` 读写 `CLAUDE_CONFIG_DIR` 下的 `CLAUDE.md`（复用 `claude-config.ts` 的文件读写模式）；渲染端新增 `MemorySettings.tsx` 复用 Monaco 编辑器，`onChange` 防抖 1.2s 自动保存，`onBlur` flush 兜底，标题处显示保存状态。

**Tech Stack:** Electron IPC、React、`@monaco-editor/react`、Vitest（jsdom + 临时 CLAUDE_CONFIG_DIR 隔离）。

**参考设计：** [docs/superpowers/specs/2026-06-20-memory-settings-claude-md-design.md](../specs/2026-06-20-memory-settings-claude-md-design.md)

---

## 文件结构

- **新建** `src/renderer/components/settings/MemorySettings.tsx` — 记忆设置子页：Monaco 编辑器 + 防抖自动保存 + 状态指示。
- **新建** `src/main/memory-file.ts` — 读写 `CLAUDE_CONFIG_DIR/CLAUDE.md` 的纯函数模块（getMemoryFile/saveMemoryFile），与 claude-config 同目录同级，职责单一。
- **修改** `src/renderer/types.ts` — `SettingsSection` 加 `'memory'`。
- **修改** `src/renderer/components/settings/SettingsMenu.tsx` — `ITEMS` 加记忆菜单项（model 之后）。
- **修改** `src/renderer/components/settings/SettingsPage.tsx` — switch 加 `case 'memory'`。
- **修改** `src/preload/index.ts` — `cc` 命名空间加 `memory: { get, save }`。
- **修改** `src/main/index.ts` — 注册 `cc:memory:get`/`cc:memory:save` handler。
- **修改** `src/renderer/i18n/index.ts` — 加 `settings.memory` zh-CN/en。
- **修改** `tests/settings-pages.test.tsx` — 加 MemorySettings 渲染用例（mock Monaco）。
- **新建** `tests/memory-file.test.ts` — 主进程读写隔离测试。

---

### Task 1: 主进程读写模块

**Files:**
- Create: `src/main/memory-file.ts`
- Test: `tests/memory-file.test.ts`

- [ ] **Step 1: 写失败测试（隔离 CLAUDE_CONFIG_DIR，验证读写往返 + 文件不存在返回空串）**

创建 `tests/memory-file.test.ts`：

```typescript
// 主进程 memory-file 读写测试：隔离到 os.tmpdir()，不触碰真实 ~/.cc-desk/claude。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'

async function withFakeConfigDir() {
  const fakeDir = join(tmpdir(), `cc-mem-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = fakeDir
  vi.resetModules()
  const mod = await import('../src/main/memory-file')
  return { mod, fakeDir }
}

describe('memory-file 读写', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CLAUDE_CONFIG_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = origDir
    vi.resetModules()
  })

  it('文件不存在时 getMemoryFile 返回空串', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    expect(existsSync(join(fakeDir, 'CLAUDE.md'))).toBe(false)
    const content = await mod.getMemoryFile()
    expect(content).toBe('')
  })

  it('saveMemoryFile 写入后 getMemoryFile 读回一致', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    const text = '# 记忆\n\n- 这是全局指令\n- 中文内容'
    await mod.saveMemoryFile(text)
    const onDisk = await readFile(join(fakeDir, 'CLAUDE.md'), 'utf-8')
    expect(onDisk).toBe(text)
    const back = await mod.getMemoryFile()
    expect(back).toBe(text)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/memory-file.test.ts`
Expected: FAIL，`Cannot find module '../src/main/memory-file'`。

- [ ] **Step 3: 写最小实现**

创建 `src/main/memory-file.ts`：

```typescript
// src/main/memory-file.ts
// 全局记忆文件 CLAUDE.md 的读写：落在 CLAUDE_CONFIG_DIR（~/.cc-desk/claude）下，
// 与 Claude Agent SDK 运行时同一目录，确保设置页编辑即实际生效。
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { CLAUDE_CONFIG_DIR } from './paths'

const MEMORY_PATH = join(CLAUDE_CONFIG_DIR, 'CLAUDE.md')

// 读取全局记忆文件。文件不存在时返回空串（首次进入记忆设置页的场景），不报错。
export async function getMemoryFile(): Promise<string> {
  if (!existsSync(MEMORY_PATH)) return ''
  try {
    return await readFile(MEMORY_PATH, 'utf-8')
  } catch {
    return ''
  }
}

// 写入全局记忆文件。目录由 ensureClaudeConfigDir 保证存在，直接写。
export async function saveMemoryFile(content: string): Promise<void> {
  await writeFile(MEMORY_PATH, content, 'utf-8')
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/memory-file.test.ts`
Expected: PASS，2 个用例通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/memory-file.ts tests/memory-file.test.ts
git commit -m "feat(main): 新增 memory-file 模块，读写全局 CLAUDE.md"
```

---

### Task 2: IPC 通道注册（主进程 handler + preload 桥接）

**Files:**
- Modify: `src/main/index.ts:101-104`（cc handler 区块）
- Modify: `src/preload/index.ts`（cc 命名空间）

- [ ] **Step 1: 主进程注册 handler**

修改 `src/main/index.ts`，在顶部 import 区加（与 `import * as cc from './claude-config'` 同处）：

```typescript
import { getMemoryFile, saveMemoryFile } from './memory-file'
```

在 `cc:general:save` handler 之后（约 `src/main/index.ts:107`，紧跟在 `ipcMain.handle('cc:general:save', ...)` 行后）加：

```typescript
  // 全局记忆文件 CLAUDE.md（读写 ~/.cc-desk/claude/CLAUDE.md）
  ipcMain.handle('cc:memory:get', () => getMemoryFile())
  ipcMain.handle('cc:memory:save', (_e, content: string) => saveMemoryFile(content))
```

- [ ] **Step 2: preload 暴露 API**

修改 `src/preload/index.ts`，在 `cc` 命名空间对象内（`hooks` 之后、`model` 之前，与现有键排列一致）加：

```typescript
    memory: {
      get: () => ipcRenderer.invoke('cc:memory:get'),
      save: (content: string) => ipcRenderer.invoke('cc:memory:save', content),
    },
```

具体插入位置：`hooks: { ... },` 闭合的 `}` 之后、`model: {` 之前。

- [ ] **Step 3: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误（只加了 import 和两个简单 handler）。

- [ ] **Step 4: 提交**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat(ipc): 注册 cc:memory:get/save 通道，暴露给渲染端"
```

---

### Task 3: 类型 + 菜单 + 路由 + i18n

**Files:**
- Modify: `src/renderer/types.ts:165-167`（SettingsSection）
- Modify: `src/renderer/components/settings/SettingsMenu.tsx`（ITEMS）
- Modify: `src/renderer/components/settings/SettingsPage.tsx:25-35`（switch）
- Modify: `src/renderer/i18n/index.ts`

- [ ] **Step 1: 扩展 SettingsSection 类型**

修改 `src/renderer/types.ts`，把 SettingsSection 从：

```typescript
export type SettingsSection =
  | 'general' | 'code-preview' | 'model' | 'skills'
  | 'mcp' | 'plugins' | 'commands' | 'hooks' | 'archived'
```

改为：

```typescript
export type SettingsSection =
  | 'general' | 'code-preview' | 'model' | 'memory' | 'skills'
  | 'mcp' | 'plugins' | 'commands' | 'hooks' | 'archived'
```

- [ ] **Step 2: 菜单加记忆项**

修改 `src/renderer/components/settings/SettingsMenu.tsx` 的 `ITEMS` 数组，在 `model` 之后插入一行：

```typescript
const ITEMS: MenuItem[] = [
  { id: 'back', labelKey: 'settings.back' },
  { id: 'general', labelKey: 'settings.general' },
  { id: 'code-preview', labelKey: 'settings.codePreview' },
  { id: 'model', labelKey: 'settings.model' },
  { id: 'memory', labelKey: 'settings.memory' },
  { id: 'skills', labelKey: 'settings.skills' },
  { id: 'mcp', labelKey: 'settings.mcp' },
  { id: 'plugins', labelKey: 'settings.plugins' },
  { id: 'commands', labelKey: 'settings.commands' },
  { id: 'hooks', labelKey: 'settings.hooks' },
  { id: 'archived', labelKey: 'settings.archived' }
]
```

- [ ] **Step 3: 路由 switch 加 case**

修改 `src/renderer/components/settings/SettingsPage.tsx`，在顶部 import 区加：

```typescript
import { MemorySettings } from './MemorySettings'
```

在 `renderSection` 的 switch 内，`case 'model':` 之后加：

```typescript
      case 'memory': return <MemorySettings />
```

- [ ] **Step 4: i18n 加文案**

修改 `src/renderer/i18n/index.ts`，在 zh-CN 字典的 `'settings.model': '模型设置',` 之后加：

```typescript
    'settings.memory': '记忆',
```

在 en 字典的 `'settings.model': 'Model',` 之后加：

```typescript
    'settings.memory': 'Memory',
```

- [ ] **Step 5: 验证类型检查通过**

Run: `npx tsc --noEmit`
Expected: 报错 `Cannot find module './MemorySettings'`（下一个 Task 创建），其余无新增错误。

- [ ] **Step 6: 提交（类型/菜单/路由/i18n 一起，因 import MemorySettings 尚未存在会 tsc 报错，与 Task 4 合并提交更安全——此处先不单独提交）**

本 Task 不单独提交，与 Task 4 合并提交（否则中间状态 tsc 会因缺少 MemorySettings 报错）。

---

### Task 4: MemorySettings 组件（含自动保存）

**Files:**
- Create: `src/renderer/components/settings/MemorySettings.tsx`

- [ ] **Step 1: 创建组件**

创建 `src/renderer/components/settings/MemorySettings.tsx`：

```typescript
import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type MonacoNS from 'monaco-editor'
import { useStore } from '../../state/store'
import { useI18n } from '../../i18n/useI18n'
import { monacoThemeFor } from '../../editor/monacoEnv'

type SaveStatus = 'saved' | 'saving' | 'unsaved'

// 自动保存防抖时长（ms）：内容变更后静置此时长才写盘，避免高频写文件。
const AUTOSAVE_DEBOUNCE = 1200

export function MemorySettings() {
  const { state } = useStore()
  const { t } = useI18n()
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [error, setError] = useState<string | null>(null)

  const contentRef = useRef<string>('')        // 编辑器当前值，防抖回调读取，避免闭包过期
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef<boolean>(false)       // 是否有未保存内容，卸载/失焦 flush 时判断

  // 拉取初始内容
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    window.api?.cc.memory.get()
      .then((text: string) => {
        if (cancelled) return
        const v = text ?? ''
        setContent(v)
        contentRef.current = v
        setStatus('saved')
      })
      .catch((err: unknown) => { if (!cancelled) setError(String(err instanceof Error ? err.message : err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // 实际写盘
  const flush = async () => {
    if (!dirtyRef.current) return
    setStatus('saving')
    try {
      await window.api?.cc.memory.save(contentRef.current)
      dirtyRef.current = false
      setStatus('saved')
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      setStatus('unsaved')
    }
  }

  // 卸载时兜底 flush（切走菜单 / 关闭页面）
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scheduleSave = (value: string) => {
    contentRef.current = value
    dirtyRef.current = true
    setStatus('unsaved')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flush() }, AUTOSAVE_DEBOUNCE)
  }

  const handleChange = (value: string | undefined) => {
    const v = value ?? ''
    setContent(v)
    scheduleSave(v)
  }

  const handleMount = (ed: editor.IStandaloneCodeEditor, monacoInstance: typeof MonacoNS) => {
    // 编辑器失焦立即 flush（兜底防抖窗口内的未保存内容）
    ed.onDidBlurEditorWidget(() => { void flush() })
  }

  if (loading) {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>加载中…</div>
  }
  if (error && !content && contentRef.current === '') {
    return <div style={{ padding: 12, color: 'var(--text-muted)' }}>{error}</div>
  }

  const statusText = status === 'saved' ? '已保存' : status === 'saving' ? '保存中…' : '未保存'
  const statusColor = status === 'saved' ? 'var(--text-muted)' : status === 'saving' ? 'var(--text-muted)' : 'var(--accent, #2563eb)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{t('settings.memory')}</h2>
        <span style={{ fontSize: 12, color: statusColor }}>{statusText}</span>
      </div>
      {error && (
        <div style={{ padding: '6px 10px', background: 'rgba(220,38,38,.12)', color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <Editor
          language="markdown"
          theme={monacoThemeFor(state.theme)}
          value={content}
          onChange={handleChange}
          onMount={handleMount}
          options={{
            fontSize: 13,
            wordWrap: 'on',
            lineNumbers: 'on',
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS（此时 Task 3 的 import 也得到满足，整体类型干净）。

- [ ] **Step 3: 提交（Task 3 + Task 4 合并）**

```bash
git add src/renderer/types.ts src/renderer/components/settings/SettingsMenu.tsx src/renderer/components/settings/SettingsPage.tsx src/renderer/i18n/index.ts src/renderer/components/settings/MemorySettings.tsx
git commit -m "feat(settings): 新增记忆子页，Monaco 编辑 CLAUDE.md + 防抖自动保存"
```

---

### Task 5: 渲染端测试

**Files:**
- Modify: `tests/settings-pages.test.tsx`

- [ ] **Step 1: 写失败测试（mock Monaco，验证 MemorySettings 拉取并渲染初始内容 + 路由命中）**

在 `tests/settings-pages.test.tsx` 顶部 vi.mock 区（其他组件 import 之前）加 Monaco mock：

```typescript
// Monaco 在 jsdom 下无法真实渲染，mock 成轻量受控文本域，验证编辑器接线即可。
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco-mock"
      value={value}
      onChange={e => onChange?.(e.target.value)}
    />
  ),
}))
```

在文件底部（`describe('SettingsPage routing', ...)` 之前或之后均可）加测试块：

```typescript
describe('MemorySettings', () => {
  beforeEach(() => {
    dispatch.mockClear()
    mockState = { settings: baseSettings(), activeSettingsSection: 'memory', projects: [] }
  })

  it('拉取并渲染初始 CLAUDE.md 内容', async () => {
    const memoryGet = vi.fn().mockResolvedValue('# 全局记忆\n\n这是指令')
    const memorySave = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { memory: { get: memoryGet, save: memorySave } } })

    const { MemorySettings } = await import('../src/renderer/components/settings/MemorySettings')
    render(<MemorySettings />)

    const ta = await screen.findByTestId('monaco-mock')
    expect(ta).toBeTruthy()
    await waitFor(() => expect(memoryGet).toHaveBeenCalled())
    await waitFor(() => expect((ta as HTMLTextAreaElement).value).toBe('# 全局记忆\n\n这是指令'))
  })

  it('内容变更后防抖触发保存', async () => {
    vi.useFakeTimers()
    const memoryGet = vi.fn().mockResolvedValue('')
    const memorySave = vi.fn().mockResolvedValue(undefined)
    setApi({ cc: { memory: { get: memoryGet, save: memorySave } } })

    const { MemorySettings } = await import('../src/renderer/components/settings/MemorySettings')
    render(<MemorySettings />)
    await screen.findByTestId('monaco-mock')

    const ta = screen.getByTestId('monaco-mock')
    fireEvent.change(ta, { target: { value: '新指令' } })
    expect(memorySave).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1200)
    await waitFor(() => expect(memorySave).toHaveBeenCalledWith('新指令'))
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/settings-pages.test.tsx`
Expected: FAIL（MemorySettings 尚未 import 或 Monaco mock 未生效，取决于 Task 4 是否已完成——若按序执行 Task 4 已完成，此处应聚焦于测试逻辑是否正确匹配组件行为）。

- [ ] **Step 3: 运行测试确认通过**

Run: `npx vitest run tests/settings-pages.test.tsx`
Expected: PASS（含原有用例 + 2 个新用例）。

- [ ] **Step 4: 提交**

```bash
git add tests/settings-pages.test.tsx
git commit -m "test(settings): 补充记忆子页渲染与防抖保存测试"
```

---

### Task 6: 全量验证

**Files:**
- 无修改，仅验证

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 全部通过（含新增 memory-file.test.ts 和 settings-pages.test.tsx 新用例）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建成功，无错误。

- [ ] **Step 4（可选）：dev 手测**

Run: `pnpm dev`
进入 设置 → 记忆，确认：空内容（文件不存在）正常显示；输入内容停顿 1.2s 后右上角「已保存」；切走菜单再回来内容仍在；`cat ~/.cc-desk/claude/CLAUDE.md` 确认落盘。
