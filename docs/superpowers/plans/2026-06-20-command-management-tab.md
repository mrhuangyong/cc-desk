# 命令管理 Tab 视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 命令管理重构为三 Tab（自定义/插件/内置），自定义命令支持完整 CRUD（新建/编辑/删除），插件和内置命令可点击查看详情。

**Architecture:** 后端扩展 claude-config.ts 新增 createCommand/getCommandFile/saveCommandFile/deleteCommand 四个函数。前端重构 CommandSettings.tsx 为三 Tab + 新增 CreateCommandDialog 和 CommandEditModal 组件。

**Tech Stack:** TypeScript, Electron (IPC/preload), React + 内联样式, vitest

---

## 文件结构

**新建：**
- `src/renderer/components/settings/CreateCommandDialog.tsx` — 新建命令弹窗（名称 + 描述输入）
- `src/renderer/components/settings/CommandEditModal.tsx` — 命令编辑/查看弹窗（Monaco，复用技能弹窗模式）

**修改：**
- `src/main/claude-config.ts` — 新增 createCommand/getCommandFile/saveCommandFile/deleteCommand
- `src/main/index.ts` — 注册新 IPC handler
- `src/preload/index.ts` — 新增 commands.create/getFile/saveFile/delete
- `src/renderer/global.d.ts` — 新增类型声明
- `src/renderer/components/settings/CommandSettings.tsx` — 重构为三 Tab
- `tests/settings-pages.test.tsx` — 更新命令测试适配三 Tab

---

## Task 1: 后端 — createCommand + getCommandFile + saveCommandFile + deleteCommand

**Files:**
- Modify: `src/main/claude-config.ts`
- Test: `tests/command-crud.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/command-crud.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm, readFile, existsSync } from 'fs/promises'

const TMP_DIR = join(tmpdir(), `cmd-${Math.random().toString(36).slice(2)}-${Date.now()}`)
let origDir: string | undefined

beforeEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true })
  await mkdir(TMP_DIR, { recursive: true })
  origDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = TMP_DIR
  vi.resetModules()
})
afterEach(async () => {
  if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = origDir
  vi.resetModules()
  await rm(TMP_DIR, { recursive: true, force: true })
})

describe('createCommand', () => {
  it('创建成功：文件存在 + frontmatter 正确', async () => {
    const { createCommand } = await import('../src/main/claude-config')
    const result = await createCommand('my-cmd', '测试命令')
    expect(result.success).toBe(true)
    const content = await readFile(join(TMP_DIR, 'commands', 'my-cmd.md'), 'utf-8')
    expect(content).toContain('description: 测试命令')
  })
  it('重名报错', async () => {
    const { createCommand } = await import('../src/main/claude-config')
    await createCommand('my-cmd', 'first')
    const r2 = await createCommand('my-cmd', 'second')
    expect(r2.success).toBe(false)
    expect(r2.message).toContain('已存在')
  })
  it('非法 name 报错', async () => {
    const { createCommand } = await import('../src/main/claude-config')
    const r = await createCommand('My Command!', 'bad')
    expect(r.success).toBe(false)
    expect(r.message).toContain('格式')
  })
})

describe('getCommandFile', () => {
  it('自定义命令读取成功', async () => {
    const { createCommand, getCommandFile } = await import('../src/main/claude-config')
    await createCommand('read-test', 'desc')
    const content = await getCommandFile('user', 'read-test')
    expect(content).toContain('description: desc')
  })
  it('builtin 返回空串', async () => {
    const { getCommandFile } = await import('../src/main/claude-config')
    const content = await getCommandFile('builtin', 'init')
    expect(content).toBe('')
  })
})

describe('saveCommandFile', () => {
  it('写回成功', async () => {
    const { createCommand, saveCommandFile, getCommandFile } = await import('../src/main/claude-config')
    await createCommand('save-test', 'old')
    await saveCommandFile('save-test', '---\ndescription: new\n---\nNew body')
    const content = await getCommandFile('user', 'save-test')
    expect(content).toContain('New body')
    expect(content).toContain('description: new')
  })
})

describe('deleteCommand', () => {
  it('删除成功', async () => {
    const { createCommand, deleteCommand } = await import('../src/main/claude-config')
    await createCommand('del-test', 'desc')
    const path = join(TMP_DIR, 'commands', 'del-test.md')
    expect(existsSync(path)).toBe(true)
    await deleteCommand('del-test')
    expect(existsSync(path)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/command-crud.test.ts`
Expected: FAIL — 函数未定义

- [ ] **Step 3: 实现四个函数**

在 `src/main/claude-config.ts` 的 `getCommands` 函数之后追加：

```typescript
// ---- 命令 CRUD（仅自定义命令：~/.cc-desk/claude/commands/*.md）----

// 命令名称 → 文件名（去掉 / 前缀）
function commandNameToFile(name: string): string {
  const stripped = name.replace(/^\//, '')
  return `${stripped}.md`
}

// 命令名称合法校验：仅小写字母、数字、连字符
const COMMAND_NAME_RE = /^[a-z0-9-]+$/

export async function createCommand(name: string, description: string): Promise<{ success: boolean; message: string }> {
  const cleanName = name.trim().replace(/^\//, '')
  if (!COMMAND_NAME_RE.test(cleanName)) {
    return { success: false, message: `命令名称格式无效：仅允许小写字母、数字、连字符（如 my-command）` }
  }
  const filePath = join(CLAUDE_DIR, 'commands', `${cleanName}.md`)
  if (existsSync(filePath)) {
    return { success: false, message: `命令 /${cleanName} 已存在` }
  }
  const content = `---\ndescription: ${description}\n---\n\n`
  await writeJson(filePath, content) // writeJson 会 mkdir -p
  // writeJson 追加 \n，但命令文件需要精确控制，改用直接 writeFile
  await writeFile(filePath, content, 'utf-8')
  return { success: true, message: `命令 /${cleanName} 创建成功` }
}

export async function getCommandFile(source: string, name: string): Promise<string> {
  const cleanName = name.replace(/^\//, '')
  if (source === 'builtin') return ''
  if (source === 'user') {
    const filePath = join(CLAUDE_DIR, 'commands', `${cleanName}.md`)
    if (!existsSync(filePath)) return ''
    try { return await readFile(filePath, 'utf-8') } catch { return '' }
  }
  // source 为插件名：找插件 installPath
  const plugins = await getPlugins()
  const plugin = plugins.find(p => p.name === source)
  if (!plugin) return ''
  const filePath = join(plugin.installPath, 'commands', `${cleanName}.md`)
  if (!existsSync(filePath)) return ''
  try { return await readFile(filePath, 'utf-8') } catch { return '' }
}

export async function saveCommandFile(name: string, content: string): Promise<void> {
  const cleanName = name.replace(/^\//, '')
  const filePath = join(CLAUDE_DIR, 'commands', `${cleanName}.md`)
  await writeFile(filePath, content, 'utf-8')
}

export async function deleteCommand(name: string): Promise<void> {
  const cleanName = name.replace(/^\//, '')
  const filePath = join(CLAUDE_DIR, 'commands', `${cleanName}.md`)
  if (existsSync(filePath)) {
    await rm(filePath, { force: true }).catch(() => {})
  }
}
```

注意：`writeFile` 和 `rm` 已在 claude-config.ts 顶部 import（Task 5 时已加 `cp, rm`）。但需确认 `writeJson` 不用于命令文件（命令文件不做 JSON 序列化），改用直接 `writeFile`。`mkdir` 已在 import 中，但 `createCommand` 里先调用了一次错误的 `writeJson`——实际实现去掉那行，只保留 `writeFile`。修正版 createCommand：

```typescript
export async function createCommand(name: string, description: string): Promise<{ success: boolean; message: string }> {
  const cleanName = name.trim().replace(/^\//, '')
  if (!COMMAND_NAME_RE.test(cleanName)) {
    return { success: false, message: `命令名称格式无效：仅允许小写字母、数字、连字符（如 my-command）` }
  }
  const dir = join(CLAUDE_DIR, 'commands')
  const filePath = join(dir, `${cleanName}.md`)
  if (existsSync(filePath)) {
    return { success: false, message: `命令 /${cleanName} 已存在` }
  }
  await mkdir(dir, { recursive: true })
  const content = `---\ndescription: ${description}\n---\n\n`
  await writeFile(filePath, content, 'utf-8')
  return { success: true, message: `命令 /${cleanName} 创建成功` }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/command-crud.test.ts`
Expected: PASS — 全部测试通过

- [ ] **Step 5: 提交**

```bash
git add src/main/claude-config.ts tests/command-crud.test.ts
git commit -m "feat(commands): createCommand/getCommandFile/saveCommandFile/deleteCommand"
```

---

## Task 2: IPC handler + preload + global.d.ts

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: 注册 IPC handler**

在 `src/main/index.ts` 的 `cc:commands:get` handler 之后追加：

```typescript
  ipcMain.handle('cc:command:create', (_e, name: string, desc: string) => cc.createCommand(name, desc))
  ipcMain.handle('cc:command:get-file', (_e, source: string, name: string) => cc.getCommandFile(source, name))
  ipcMain.handle('cc:command:save', (_e, name: string, content: string) => cc.saveCommandFile(name, content))
  ipcMain.handle('cc:command:delete', (_e, name: string) => cc.deleteCommand(name))
```

- [ ] **Step 2: preload 暴露 API**

在 `src/preload/index.ts` 的 `commands:` 对象里，从单行改为多方法：

```typescript
    commands: {
      get: () => ipcRenderer.invoke('cc:commands:get'),
      create: (name: string, description: string) => ipcRenderer.invoke('cc:command:create', name, description),
      getFile: (source: string, name: string) => ipcRenderer.invoke('cc:command:get-file', source, name),
      saveFile: (name: string, content: string) => ipcRenderer.invoke('cc:command:save', name, content),
      delete: (name: string) => ipcRenderer.invoke('cc:command:delete', name),
    },
```

- [ ] **Step 3: global.d.ts 类型声明**

在 `src/renderer/global.d.ts` 中，把 `commands: { get(): Promise<ClaudeCommand[]> }` 改为：

```typescript
  commands: {
    get(): Promise<ClaudeCommand[]>
    create(name: string, description: string): Promise<{ success: boolean; message: string }>
    getFile(source: string, name: string): Promise<string>
    saveFile(name: string, content: string): Promise<void>
    delete(name: string): Promise<void>
  }
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无新类型错误（预存的 4 个 dataPath/bump-version 错误不计）

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(ipc): 命令 CRUD IPC 通道"
```

---

## Task 3: CreateCommandDialog 组件

**Files:**
- Create: `src/renderer/components/settings/CreateCommandDialog.tsx`

- [ ] **Step 1: 实现新建命令弹窗**

```tsx
// src/renderer/components/settings/CreateCommandDialog.tsx
// 新建自定义命令弹窗：名称输入（校验 ^[a-z0-9-]+$）+ 描述输入。
import { useState } from 'react'

interface Props {
  onCreated: (name: string) => void
  onClose: () => void
}

const labelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
}
const primaryBtn: React.CSSProperties = {
  padding: '7px 18px', fontSize: 12, cursor: 'pointer',
  border: 'none', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, cursor: 'pointer',
  border: 'none', background: 'transparent', color: 'var(--text-muted)',
}

const NAME_RE = /^[a-z0-9-]+$/

export function CreateCommandDialog({ onCreated, onClose }: Props) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameValid = NAME_RE.test(name.trim())
  const canSubmit = nameValid && !loading

  const handleCreate = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api?.cc.commands.create(name.trim(), desc.trim())
      if (result?.success) {
        onCreated(name.trim())
        onClose()
      } else {
        setError(result?.message || '创建失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 440, maxWidth: '90vw',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-float)',
        padding: 20,
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text)', fontSize: 15, margin: '0 0 16px 0' }}>新建命令</h3>

        <div>
          <div style={labelStyle}>命令名称</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/</span>
            <input
              placeholder="my-command"
              value={name} onChange={e => setName(e.target.value)}
              style={inputStyle} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleCreate() }}
            />
          </div>
          <div style={{ marginTop: 4, fontSize: 11, color: name && !nameValid ? 'var(--danger, #e57373)' : 'var(--text-muted)' }}>
            仅小写字母、数字、连字符
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={labelStyle}>描述</div>
          <input
            placeholder="命令用途说明"
            value={desc} onChange={e => setDesc(e.target.value)}
            style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleCreate() }}
          />
        </div>

        {error && (
          <div style={{ marginTop: 10, color: 'var(--danger, #e57373)', fontSize: 12, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={ghostBtn}>取消</button>
          <button onClick={handleCreate} disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5 }}>
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/CreateCommandDialog.tsx
git commit -m "feat(ui): CreateCommandDialog 新建命令弹窗"
```

---

## Task 4: CommandEditModal 组件

**Files:**
- Create: `src/renderer/components/settings/CommandEditModal.tsx`

- [ ] **Step 1: 实现命令编辑/查看弹窗**

复用 SkillModal 的 Monaco + 防抖自动保存模式。支持可编辑（自定义）和只读（插件/内置）两种模式。

```tsx
// src/renderer/components/settings/CommandEditModal.tsx
// 命令编辑/查看弹窗：Monaco 编辑器 + 防抖自动保存（自定义命令）或只读展示（插件/内置命令）。
// 复用 SkillModal 的 autosave 模式。
import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X } from 'lucide-react'
import { useStore } from '../../state/store'
import { monacoThemeFor } from '../../editor/monacoEnv'
import type { ClaudeCommand } from '../../../main/claude-config'

type SaveStatus = 'saved' | 'saving' | 'unsaved'

const AUTOSAVE_DEBOUNCE = 1200

interface Props {
  command: ClaudeCommand
  onClose: () => void
}

export function CommandEditModal({ command, onClose }: Props) {
  const { state } = useStore()
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [error, setError] = useState<string | null>(null)

  const contentRef = useRef<string>('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef<boolean>(false)

  const isEditable = command.source === 'user'

  // 拉取命令 .md 全文
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // name 格式为 /xxx，getFile 接受 source + name（含 /）
    window.api?.cc.commands.getFile(command.source, command.name)
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
  }, [command.source, command.name])

  // 写盘（仅自定义命令）
  const flush = async () => {
    if (!dirtyRef.current || !isEditable) return
    setStatus('saving')
    try {
      await window.api?.cc.commands.saveFile(command.name, contentRef.current)
      dirtyRef.current = false
      setStatus('saved')
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${msg}`)
      setStatus('unsaved')
    }
  }

  // 卸载兜底 flush
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (v: string | undefined) => {
    const next = v ?? ''
    setContent(next)
    contentRef.current = next
    if (!isEditable) return
    dirtyRef.current = true
    setStatus('unsaved')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE)
  }

  const theme = monacoThemeFor(state?.settings?.theme)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 720, maxWidth: '92vw', height: 520, maxHeight: '85vh',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{command.name}</span>
            {!isEditable && (
              <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                {command.source === 'builtin' ? '内置' : command.source}
              </span>
            )}
            {isEditable && (
              <span style={{ fontSize: 11, color: status === 'saved' ? 'var(--text-muted)' : status === 'saving' ? 'var(--accent)' : 'var(--danger, #e57373)' }}>
                {status === 'saved' ? '已保存' : status === 'saving' ? '保存中…' : '未保存'}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* 内置命令无文件内容，特殊展示 */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>
        ) : command.source === 'builtin' ? (
          <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
            <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 8 }}>{command.desc}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              类型：{command.builtinAction?.type || 'unknown'}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Editor
              value={content}
              language="markdown"
              theme={theme}
              onChange={handleChange}
              options={{ readOnly: !isEditable, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false }}
            />
          </div>
        )}

        {error && (
          <div style={{ padding: '4px 16px', color: 'var(--danger, #e57373)', fontSize: 11 }}>{error}</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/CommandEditModal.tsx
git commit -m "feat(ui): CommandEditModal 命令编辑/查看弹窗（Monaco + autosave）"
```

---

## Task 5: CommandSettings.tsx 重构为三 Tab

**Files:**
- Modify: `src/renderer/components/settings/CommandSettings.tsx`
- Modify: `tests/settings-pages.test.tsx`

- [ ] **Step 1: 重写 CommandSettings.tsx**

```tsx
// src/renderer/components/settings/CommandSettings.tsx
// 命令管理设置页：三 Tab（自定义 / 插件 / 内置）。
// 自定义 Tab：完整 CRUD（新建/编辑/删除）。插件和内置 Tab：只读 + 可点击查看详情。
import { useEffect, useState, useCallback } from 'react'
import type { ClaudeCommand } from '../../../main/claude-config'
import { CreateCommandDialog } from './CreateCommandDialog'
import { CommandEditModal } from './CommandEditModal'
import { Plus, Pencil, Trash2, FileText } from 'lucide-react'
import { Tooltip } from '../Tooltip'

const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
  marginRight: 4,
})
const iconBtn: React.CSSProperties = {
  padding: '4px 6px', fontSize: 13, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1,
}
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'transparent', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', outline: 'none', marginBottom: 14,
}
const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 0', borderBottom: '1px solid var(--border)',
}

type TabKey = 'custom' | 'plugin' | 'builtin'

export function CommandSettings() {
  const [commands, setCommands] = useState<ClaudeCommand[]>([])
  const [tab, setTab] = useState<TabKey>('custom')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ClaudeCommand | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    window.api?.cc?.commands.get().then(list => { setCommands(list); setLoading(false) })
  }, [])
  useEffect(() => { reload() }, [reload])

  // 分类
  const custom = commands.filter(c => c.source === 'user')
  const plugin = commands.filter(c => c.source !== 'user' && c.source !== 'builtin')
  const builtin = commands.filter(c => c.source === 'builtin')

  const handleDelete = async () => {
    if (!confirmDelete) return
    await window.api?.cc?.commands.delete(confirmDelete)
    setConfirmDelete(null)
    reload()
  }

  const handleCreated = (name: string) => {
    reload()
    // 创建后自动打开编辑弹窗
    setTimeout(() => {
      // commands 刷新后找到新命令
      window.api?.cc?.commands.get().then(list => {
        const created = list.find(c => c.name === `/${name}`)
        if (created) setEditing(created)
      })
    }, 100)
  }

  const currentList = tab === 'custom' ? custom : tab === 'plugin' ? plugin : builtin

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>命令管理</h2>
        {tab === 'custom' && (
          <button style={primaryBtn} onClick={() => setShowCreate(true)}><Plus size={14} /> 新建命令</button>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        自定义命令存储在 ~/.cc-desk/claude/commands/，SDK 运行时自动加载。
      </div>

      {/* Tab 栏 */}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <button style={segBtn(tab === 'custom')} onClick={() => setTab('custom')}>自定义({custom.length})</button>
        <button style={segBtn(tab === 'plugin')} onClick={() => setTab('plugin')}>插件({plugin.length})</button>
        <button style={segBtn(tab === 'builtin')} onClick={() => setTab('builtin')}>内置({builtin.length})</button>
      </div>

      <CommandList
        commands={currentList}
        loading={loading}
        mode={tab === 'custom' ? 'editable' : 'readonly'}
        showSource={tab === 'plugin'}
        onEdit={c => setEditing(c)}
        onDelete={c => setConfirmDelete(c.name.replace(/^\//, ''))}
      />

      {showCreate && <CreateCommandDialog onCreated={handleCreated} onClose={() => setShowCreate(false)} />}
      {editing && <CommandEditModal command={editing} onClose={() => { setEditing(null); reload() }} />}

      {/* 删除确认框 */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ width: 400, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 16 }}>
              确定删除 /{confirmDelete}？此操作不可撤销。
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}>取消</button>
              <button onClick={handleDelete} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--danger, #e57373)', color: '#fff' }}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 命令列表渲染 ----

function CommandList({ commands, loading, mode, showSource, onEdit, onDelete }: {
  commands: ClaudeCommand[]
  loading: boolean
  mode: 'editable' | 'readonly'
  showSource: boolean
  onEdit: (cmd: ClaudeCommand) => void
  onDelete?: (name: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = commands.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) || c.desc.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div>
      <input placeholder="搜索命令..." value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
      {loading && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配命令</div>}
      {filtered.map(c => (
        <div key={c.id} style={rowStyle}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{c.name}</span>
              {showSource && (
                <span style={{ padding: '0px 6px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{c.source}</span>
              )}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{c.desc}</div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {mode === 'editable' ? (
              <>
                <Tooltip label="编辑">
                  <button onClick={() => onEdit(c)} style={iconBtn}><Pencil size={13} /></button>
                </Tooltip>
                <Tooltip label="删除">
                  <button onClick={() => onDelete?.(c.name)} style={iconBtn}><Trash2 size={13} /></button>
                </Tooltip>
              </>
            ) : (
              <Tooltip label="详情">
                <button onClick={() => onEdit(c)} style={iconBtn}><FileText size={13} /></button>
              </Tooltip>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 更新 settings-pages 测试**

在 `tests/settings-pages.test.tsx` 中找到命令相关的测试（搜索 `CommandSettings`），更新 mock 和断言：

```typescript
// 命令 mock 需要补充 create/getFile/saveFile/delete
const cmdCreate = vi.fn()
const cmdGetFile = vi.fn()
const cmdSaveFile = vi.fn()
const cmdDelete = vi.fn()

// 在 setApi 的 cc 对象里：
commands: { get: commandsGet, create: cmdCreate, getFile: cmdGetFile, saveFile: cmdSaveFile, delete: cmdDelete }
```

更新命令搜索测试：placeholder 从 `搜索命令` 保持不变（CommandList 用的就是这个）。但需要确认命令数据里 source 字段正确分组——自定义 Tab 只显示 `source === 'user'` 的命令。

如果原测试用 `EntryListSection` 渲染，现在改成三 Tab 后需调整断言（默认 Tab 是 custom，只显示 source='user' 的命令）。如果原测试的 mock 命令 source 不是 'user'，需要调整 mock 数据或切换 Tab。

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 4: 运行全部测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/settings/CommandSettings.tsx tests/settings-pages.test.tsx
git commit -m "feat(ui): CommandSettings 重构为三 Tab + 自定义命令 CRUD"
```

---

## Task 6: 最终集成验证

**Files:** 无新文件

- [ ] **Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 仅预存的 4 个 dataPath/bump-version 错误

- [ ] **Step 3: 提交（如有遗漏的改动）**

```bash
git add -A
git commit -m "feat: 命令管理三 Tab 视图完整实现"
```
