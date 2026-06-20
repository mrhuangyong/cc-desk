# Hooks 设置真实接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hooks 设置从空壳（7 事件 checkbox）完整还原为 Claude 原生管理：27 事件全量 + 4 种 hook 类型（command/prompt/agent/http）统一表单 + 事件驱动主从布局 + 列表/JSON 双视图 + 插件来源区分（只读）。

**Architecture:** 后端 claude-config.ts 重写 hooks 读写为完整 CRUD + 插件 hooks 合并。前端拆为 HooksSettings（主从布局 + 双视图）、HookMatcherList（右侧 matcher 编辑区）、HookEditDialog（4 类型表单弹窗）。

**Tech Stack:** TypeScript, Electron (IPC), React, vitest

---

## 文件结构

**新建：**
- `src/renderer/components/settings/HookMatcherList.tsx` — 右侧 matcher + hooks 列表（插件只读）
- `src/renderer/components/settings/HookEditDialog.tsx` — 4 类型表单编辑弹窗

**修改：**
- `src/main/claude-config.ts` — 重写 hooks 数据模型 + CRUD + 插件 hooks 读取
- `src/main/index.ts` — IPC handler 改造（get/save/get-json/save-json）
- `src/preload/index.ts` — preload hooks API 改造
- `src/renderer/global.d.ts` — hooks API 类型声明
- `src/renderer/components/settings/HooksSettings.tsx` — 重写为主从布局 + 双视图
- `src/renderer/i18n/index.ts` — hooks 相关 i18n key
- `tests/settings-pages.test.tsx` — HooksSettings 测试重写
- `tests/store-readwrite.test.ts` — hooks 后端读写测试

**废弃删除：**
- `src/main/index.ts` 的 `cc:hook:set-enabled` handler
- `src/main/claude-config.ts` 的 `setHookEnabled` 函数
- `src/renderer/components/settings/HooksSettings.tsx` 对 `EntryListSection` 的依赖

---

## Task 1: 后端 — hooks 数据模型 + CRUD + 插件 hooks

**Files:**
- Modify: `src/main/claude-config.ts`

- [ ] **Step 1: 替换 ClaudeHook 接口 + 新增完整数据模型**

在 `src/main/claude-config.ts` 中，删除旧 `ClaudeHook` 接口（约 93-98 行），替换为：

```typescript
// ---- hooks（settings.json 的 hooks 字段，完整还原 Claude 原生结构）----

// hook 类型：4 种（command / prompt / agent / http）
export interface CommandHook {
  type: 'command'
  command: string
  if?: string
  shell?: 'bash' | 'powershell'
  timeout?: number
  statusMessage?: string
  once?: boolean
  async?: boolean
  asyncRewake?: boolean
}
export interface PromptHook {
  type: 'prompt'
  prompt: string
  if?: string
  timeout?: number
  model?: string
  statusMessage?: string
  once?: boolean
}
export interface AgentHook {
  type: 'agent'
  prompt: string
  if?: string
  timeout?: number
  model?: string
  statusMessage?: string
  once?: boolean
}
export interface HttpHook {
  type: 'http'
  url: string
  if?: string
  timeout?: number
  headers?: Record<string, string>
  allowedEnvVars?: string[]
  statusMessage?: string
  once?: boolean
}
export type HookEntry = CommandHook | PromptHook | AgentHook | HttpHook

export interface HookMatcher {
  matcher: string
  hooks: HookEntry[]
}

// 事件分组
export type HookGroup = 'tool' | 'session' | 'task' | 'permission' | 'system'

export interface HookEventView {
  eventName: string
  group: HookGroup
  matchers: HookMatcher[]
  source: 'custom' | string   // 'custom' 或 'plugin:插件名'
  isReadonly: boolean
}

export interface HooksFull {
  custom: HookEventView[]
  plugins: HookEventView[]
}
```

- [ ] **Step 2: 新增事件名 + 分组常量 + 校验函数**

在数据模型之后追加：

```typescript
export const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'PreCompact', 'PostCompact',
  'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
  'PermissionRequest', 'PermissionDenied', 'Elicitation', 'ElicitationResult',
  'Notification', 'Setup', 'TeammateIdle', 'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'InstructionsLoaded', 'CwdChanged', 'FileChanged',
] as const
export type HookEventName = typeof HOOK_EVENTS[number]

const HOOK_GROUP_MAP: Record<string, HookGroup> = {
  PreToolUse: 'tool', PostToolUse: 'tool', PostToolUseFailure: 'tool',
  UserPromptSubmit: 'session', SessionStart: 'session', SessionEnd: 'session', PreCompact: 'session', PostCompact: 'session',
  Stop: 'task', StopFailure: 'task', SubagentStart: 'task', SubagentStop: 'task', TaskCreated: 'task', TaskCompleted: 'task',
  PermissionRequest: 'permission', PermissionDenied: 'permission', Elicitation: 'permission', ElicitationResult: 'permission',
  Notification: 'system', Setup: 'system', TeammateIdle: 'system', ConfigChange: 'system', WorktreeCreate: 'system', WorktreeRemove: 'system', InstructionsLoaded: 'system', CwdChanged: 'system', FileChanged: 'system',
}

const VALID_HOOK_TYPES = ['command', 'prompt', 'agent', 'http']

// 校验 hooks 对象结构，返回错误消息数组（空=合法）
export function validateHooks(hooks: Record<string, any>): string[] {
  const errors: string[] = []
  for (const [eventName, matchers] of Object.entries(hooks)) {
    if (!HOOK_EVENTS.includes(eventName as HookEventName)) {
      errors.push(`未知事件名: ${eventName}`)
      continue
    }
    if (!Array.isArray(matchers)) {
      errors.push(`${eventName}: 值应为数组`)
      continue
    }
    matchers.forEach((m: any, mi: number) => {
      if (!m || typeof m !== 'object') { errors.push(`${eventName}[${mi}]: 应为对象`); return }
      if (!Array.isArray(m.hooks)) { errors.push(`${eventName}[${mi}]: hooks 应为数组`); return }
      m.hooks.forEach((h: any, hi: number) => {
        if (!h || !VALID_HOOK_TYPES.includes(h.type)) {
          errors.push(`${eventName}[${mi}].hooks[${hi}]: 未知 type "${h?.type}"`)
          return
        }
        if (h.type === 'command' && !h.command) errors.push(`${eventName}[${mi}].hooks[${hi}]: command 不能为空`)
        if (h.type === 'prompt' && !h.prompt) errors.push(`${eventName}[${mi}].hooks[${hi}]: prompt 不能为空`)
        if (h.type === 'agent' && !h.prompt) errors.push(`${eventName}[${mi}].hooks[${hi}]: prompt 不能为空`)
        if (h.type === 'http' && !h.url) errors.push(`${eventName}[${mi}].hooks[${hi}]: url 不能为空`)
      })
    })
  }
  return errors
}
```

- [ ] **Step 3: 重写 getHooks 为 getHooksFull + 新增 saveHooks / getHooksJson / saveHooksJson**

删除旧 `getHooks`、`setHookEnabled`、`HOOK_EVENTS` 旧常量（约 434-461 行），替换为：

```typescript
// 自定义 hooks：读 settings.json → 按 HOOK_EVENTS 生成完整事件视图
export async function getHooksFull(): Promise<HooksFull> {
  const settings = await getSettingsJson()
  const rawHooks: Record<string, any> = settings.hooks ?? {}

  // 自定义 hooks
  const custom: HookEventView[] = []
  for (const eventName of HOOK_EVENTS) {
    const matchers = Array.isArray(rawHooks[eventName]) ? rawHooks[eventName] as HookMatcher[] : []
    // 只展示有内容的自定义事件
    if (matchers.length > 0) {
      custom.push({ eventName, group: HOOK_GROUP_MAP[eventName], matchers, source: 'custom', isReadonly: false })
    }
  }

  // 插件 hooks
  const plugins = await getPluginHooks()

  return { custom, plugins }
}

// 插件 hooks：遍历已安装插件 manifest 的 hooks 字段
async function getPluginHooks(): Promise<HookEventView[]> {
  const installed = await readJson<{ plugins?: Record<string, InstalledPlugin[]> }>(INSTALLED_PLUGINS_PATH, { plugins: {} })
  const settings = await getSettingsJson()
  const enabledPlugins: Record<string, boolean> = settings.enabledPlugins ?? {}
  const out: HookEventView[] = []
  for (const [id, installs] of Object.entries(installed.plugins ?? {})) {
    if (!enabledPlugins[id]) continue   // 只读已启用插件的 hooks
    const inst = installs?.[0]
    if (!inst) continue
    const manifest = await readPluginManifest(inst.installPath)
    const pluginHooks = manifest?.hooks
    if (!pluginHooks || typeof pluginHooks !== 'object') continue
    const pluginName = manifest?.name ?? id.split('@')[0]
    for (const eventName of HOOK_EVENTS) {
      const matchers = Array.isArray(pluginHooks[eventName]) ? pluginHooks[eventName] as HookMatcher[] : []
      if (matchers.length > 0) {
        out.push({ eventName, group: HOOK_GROUP_MAP[eventName], matchers, source: `plugin:${pluginName}`, isReadonly: true })
      }
    }
  }
  return out
}

// 整体保存 hooks（结构校验后写回 settings.json）
export async function saveHooks(hooks: Record<string, any>): Promise<{ success: boolean; errors: string[] }> {
  const errs = validateHooks(hooks)
  if (errs.length > 0) return { success: false, errors: errs }
  await saveSettingsJson({ hooks })
  return { success: true, errors: [] }
}

// 获取 hooks 原始 JSON 文本
export async function getHooksJson(): Promise<string> {
  const settings = await getSettingsJson()
  return JSON.stringify(settings.hooks ?? {}, null, 2)
}

// 从 JSON 文本保存（解析 + 校验 + 写回）
export async function saveHooksJson(jsonText: string): Promise<{ success: boolean; errors: string[] }> {
  let parsed: Record<string, any>
  try {
    parsed = JSON.parse(jsonText)
  } catch (e) {
    return { success: false, errors: ['JSON 解析失败: ' + (e instanceof Error ? e.message : String(e))] }
  }
  return saveHooks(parsed)
}
```

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误（旧 ClaudeHook 被引用处会在后续 task 修复）

- [ ] **Step 5: 提交**

```bash
git add src/main/claude-config.ts
git commit -m "feat(hooks): 后端 hooks 完整数据模型 + CRUD + 插件 hooks 读取"
```

---

## Task 2: IPC + preload + 类型声明改造

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: 改造 IPC handler**

在 `src/main/index.ts` 中，找到 hooks 相关 handler（约 128-129 行）：

```typescript
  ipcMain.handle('cc:hooks:get', () => cc.getHooks())
  ipcMain.handle('cc:hook:set-enabled', (_e, name, enabled) => cc.setHookEnabled(name, enabled))
```

替换为：

```typescript
  ipcMain.handle('cc:hooks:get', () => cc.getHooksFull())
  ipcMain.handle('cc:hooks:save', (_e, hooks) => cc.saveHooks(hooks))
  ipcMain.handle('cc:hooks:get-json', () => cc.getHooksJson())
  ipcMain.handle('cc:hooks:save-json', (_e, jsonText) => cc.saveHooksJson(jsonText))
```

- [ ] **Step 2: 改造 preload**

在 `src/preload/index.ts` 中，找到 hooks 对象（约 78-80 行）：

```typescript
    hooks: {
      get: () => ipcRenderer.invoke('cc:hooks:get'),
      setEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('cc:hook:set-enabled', name, enabled),
    },
```

替换为：

```typescript
    hooks: {
      get: () => ipcRenderer.invoke('cc:hooks:get'),
      save: (hooks: any) => ipcRenderer.invoke('cc:hooks:save', hooks),
      getJson: () => ipcRenderer.invoke('cc:hooks:get-json'),
      saveJson: (jsonText: string) => ipcRenderer.invoke('cc:hooks:save-json', jsonText),
    },
```

- [ ] **Step 3: 改造 global.d.ts 类型声明**

在 `src/renderer/global.d.ts` 中，先更新 import（找到 ClaudeHook 的引用行）：

把 `ClaudeHook` 替换为新的类型导入：

```typescript
  ClaudeMcpServer, ClaudePlugin, ClaudeSkill, ClaudeCommand,
  HookEntry, HookMatcher, HookEventView, HooksFull,
```

然后把 hooks API 类型块（约 140-142 行）：

```typescript
  hooks: {
    get(): Promise<ClaudeHook[]>
    setEnabled(name: string, enabled: boolean): Promise<void>
  }
```

替换为：

```typescript
  hooks: {
    get(): Promise<HooksFull>
    save(hooks: Record<string, any>): Promise<{ success: boolean; errors: string[] }>
    getJson(): Promise<string>
    saveJson(jsonText: string): Promise<{ success: boolean; errors: string[] }>
  }
```

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 仅 HooksSettings.tsx 引用旧 API 的错误（下个 task 修复）

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(ipc): hooks IPC 改造（get/save/get-json/save-json）"
```

---

## Task 3: HookEditDialog 组件（4 类型表单弹窗）

**Files:**
- Create: `src/renderer/components/settings/HookEditDialog.tsx`

- [ ] **Step 1: 创建 HookEditDialog 组件**

创建 `src/renderer/components/settings/HookEditDialog.tsx`：

```typescript
// Hook 编辑弹窗：支持 command / prompt / agent / http 四种类型，切换 tab 展示不同字段。
import { useState } from 'react'
import { X } from 'lucide-react'
import type { HookEntry } from '../../../main/claude-config'

interface Props {
  entry: HookEntry | null       // null=新建
  onSave: (entry: HookEntry) => void
  onCancel: () => void
}

type HookType = 'command' | 'prompt' | 'agent' | 'http'

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
  display: 'grid', placeItems: 'center',
}
const dialogStyle: React.CSSProperties = {
  width: 520, maxHeight: '85vh', overflowY: 'auto',
  background: 'var(--bg-sidebar)', borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-float)', padding: 20,
}
const labelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4, marginTop: 12 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--bg)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
  fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
}
const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, resize: 'vertical', fontFamily: 'var(--font-mono)' }
const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 16px', fontSize: 12, cursor: 'pointer', border: 'none',
  background: 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
})
const primaryBtn: React.CSSProperties = {
  padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)',
}

export function HookEditDialog({ entry, onSave, onCancel }: Props) {
  const [type, setType] = useState<HookType>(entry?.type ?? 'command')
  // 各类型字段
  const [command, setCommand] = useState((entry as any)?.command ?? '')
  const [prompt, setPrompt] = useState((entry as any)?.prompt ?? '')
  const [url, setUrl] = useState((entry as any)?.url ?? '')
  const [ifCond, setIfCond] = useState((entry as any)?.if ?? '')
  const [timeout, setTimeoutVal] = useState<string>((entry as any)?.timeout != null ? String((entry as any).timeout) : '')
  const [model, setModel] = useState((entry as any)?.model ?? '')
  const [shell, setShell] = useState<'bash' | 'powershell'>((entry as any)?.shell ?? 'bash')
  const [statusMessage, setStatusMessage] = useState((entry as any)?.statusMessage ?? '')
  const [headers, setHeaders] = useState(
    (entry as any)?.headers ? Object.entries((entry as any).headers).map(([k, v]) => `${k}: ${v}`).join('\n') : ''
  )
  const [allowedEnvVars, setAllowedEnvVars] = useState(
    Array.isArray((entry as any)?.allowedEnvVars) ? ((entry as any).allowedEnvVars as string[]).join(', ') : ''
  )
  const [isAsync, setIsAsync] = useState((entry as any)?.async ?? false)
  const [asyncRewake, setAsyncRewake] = useState((entry as any)?.asyncRewake ?? false)
  const [once, setOnce] = useState((entry as any)?.once ?? false)
  const [error, setError] = useState<string | null>(null)

  const parseHeaderLines = (text: string): Record<string, string> => {
    const obj: Record<string, string> = {}
    ;(text || '').split('\n').forEach(line => {
      const i = line.indexOf(':')
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    })
    return obj
  }

  const handleSave = () => {
    setError(null)
    const base: any = { type }
    if (ifCond) base.if = ifCond
    if (timeout) { const n = Number(timeout); if (!isNaN(n) && n > 0) base.timeout = n }
    if (statusMessage) base.statusMessage = statusMessage
    if (once) base.once = true

    if (type === 'command') {
      if (!command.trim()) { setError('command 不能为空'); return }
      base.command = command
      base.shell = shell
      if (isAsync) base.async = true
      if (asyncRewake) base.asyncRewake = true
    } else if (type === 'prompt') {
      if (!prompt.trim()) { setError('prompt 不能为空'); return }
      base.prompt = prompt
      if (model) base.model = model
    } else if (type === 'agent') {
      if (!prompt.trim()) { setError('prompt 不能为空'); return }
      base.prompt = prompt
      if (model) base.model = model
    } else if (type === 'http') {
      if (!url.trim()) { setError('url 不能为空'); return }
      base.url = url
      const hdrs = parseHeaderLines(headers)
      if (Object.keys(hdrs).length) base.headers = hdrs
      const vars = allowedEnvVars.split(',').map(s => s.trim()).filter(Boolean)
      if (vars.length) base.allowedEnvVars = vars
    }
    onSave(base as HookEntry)
  }

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={dialogStyle} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{entry ? '编辑 Hook' : '新建 Hook'}</span>
          <button onClick={onCancel} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><X size={16} /></button>
        </div>

        {/* 类型 tab */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
          {(['command', 'prompt', 'agent', 'http'] as HookType[]).map(t => (
            <button key={t} onClick={() => setType(t)} style={tabStyle(type === t)}>{t}</button>
          ))}
        </div>

        {/* 类型特定字段 */}
        {type === 'command' && (
          <>
            <div style={labelStyle}>命令</div>
            <textarea value={command} onChange={e => setCommand(e.target.value)} placeholder="echo 'hook triggered'" style={textareaStyle} />
            <div style={labelStyle}>Shell</div>
            <select value={shell} onChange={e => setShell(e.target.value as 'bash' | 'powershell')} style={inputStyle}>
              <option value="bash">bash</option>
              <option value="powershell">powershell</option>
            </select>
            <div style={labelStyle}>异步（async）</div>
            <input type="checkbox" checked={isAsync} onChange={e => setIsAsync(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>后台运行不阻塞</span>
            <div style={labelStyle}>asyncRewake（后台 + 出错时唤醒）</div>
            <input type="checkbox" checked={asyncRewake} onChange={e => setAsyncRewake(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          </>
        )}
        {type === 'prompt' && (
          <>
            <div style={labelStyle}>提示词</div>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="分析以下内容并给出建议：$ARGUMENTS" style={textareaStyle} />
            <div style={labelStyle}>模型（可选）</div>
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-6" style={inputStyle} />
          </>
        )}
        {type === 'agent' && (
          <>
            <div style={labelStyle}>验证提示词</div>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="验证单元测试是否运行并通过" style={textareaStyle} />
            <div style={labelStyle}>模型（可选）</div>
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-6" style={inputStyle} />
          </>
        )}
        {type === 'http' && (
          <>
            <div style={labelStyle}>URL</div>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/webhook" style={inputStyle} />
            <div style={labelStyle}>Headers（每行 KEY: VALUE）</div>
            <textarea value={headers} onChange={e => setHeaders(e.target.value)} placeholder={'Authorization: Bearer $TOKEN'} style={textareaStyle} />
            <div style={labelStyle}>allowedEnvVars（逗号分隔）</div>
            <input value={allowedEnvVars} onChange={e => setAllowedEnvVars(e.target.value)} placeholder="TOKEN, API_KEY" style={inputStyle} />
          </>
        )}

        {/* 公共字段 */}
        <div style={labelStyle}>条件 if（权限规则语法，如 Bash(git *)）</div>
        <input value={ifCond} onChange={e => setIfCond(e.target.value)} placeholder="Bash(git *)" style={inputStyle} />
        <div style={labelStyle}>超时（秒）</div>
        <input value={timeout} onChange={e => setTimeoutVal(e.target.value)} placeholder="60" style={inputStyle} />
        <div style={labelStyle}>状态消息</div>
        <input value={statusMessage} onChange={e => setStatusMessage(e.target.value)} placeholder="运行中..." style={inputStyle} />
        <div style={labelStyle}>once（运行一次后删除）</div>
        <input type="checkbox" checked={once} onChange={e => setOnce(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />

        {/* 错误提示 */}
        {error && <div style={{ marginTop: 10, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={ghostBtn}>取消</button>
          <button onClick={handleSave} style={primaryBtn}>保存</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误（HookEntry 已从 claude-config 导出）

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/HookEditDialog.tsx
git commit -m "feat(ui): HookEditDialog 4 类型表单编辑弹窗"
```

---

## Task 4: HookMatcherList 组件（右侧 matcher 编辑区）

**Files:**
- Create: `src/renderer/components/settings/HookMatcherList.tsx`

- [ ] **Step 1: 创建 HookMatcherList 组件**

创建 `src/renderer/components/settings/HookMatcherList.tsx`：

```typescript
// 右侧 matcher 编辑区：展示选中事件下的 matcher 块，支持增删 hook + 新增 matcher。
// 插件来源（isReadonly）整块只读。
import { useState } from 'react'
import type { HookMatcher, HookEntry } from '../../../main/claude-config'
import { HookEditDialog } from './HookEditDialog'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { Tooltip } from '../Tooltip'

interface Props {
  eventName: string
  matchers: HookMatcher[]
  isReadonly: boolean
  source: string
  onChange: (matchers: HookMatcher[]) => void
}

const iconBtn: React.CSSProperties = {
  padding: '3px 5px', fontSize: 12, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1,
}
const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  marginBottom: 10, background: 'var(--bg)', overflow: 'hidden',
}
const labelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }
const typeBadge = (t: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 7px', borderRadius: 999,
  fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)',
  marginRight: 6,
})

export function HookMatcherList({ eventName, matchers, isReadonly, source, onChange }: Props) {
  const [editing, setEditing] = useState<{ mi: number; hi: number } | null>(null)

  const hookSummary = (h: HookEntry): string => {
    if (h.type === 'command') return h.command
    if (h.type === 'prompt') return h.prompt
    if (h.type === 'agent') return h.prompt
    if (h.type === 'http') return h.url
    return ''
  }

  const updateMatcher = (mi: number, matcher: HookMatcher) => {
    const next = matchers.map((m, i) => i === mi ? matcher : m)
    onChange(next)
  }

  const deleteHook = (mi: number, hi: number) => {
    const next = matchers.map((m, i) => {
      if (i !== mi) return m
      return { ...m, hooks: m.hooks.filter((_, j) => j !== hi) }
    }).filter(m => m.hooks.length > 0)  // 空 matcher 自动移除
    onChange(next)
  }

  const saveHook = (entry: HookEntry) => {
    if (!editing) return
    const { mi, hi } = editing
    const next = matchers.map((m, i) => {
      if (i !== mi) return m
      const hooks = m.hooks.map((h, j) => j === hi ? entry : h)
      return { ...m, hooks }
    })
    onChange(next)
    setEditing(null)
  }

  const addHook = (mi: number) => {
    const newEntry: HookEntry = { type: 'command', command: '' }
    const next = matchers.map((m, i) => {
      if (i !== mi) return m
      return { ...m, hooks: [...m.hooks, newEntry] }
    })
    onChange(next)
    setEditing({ mi, hi: next[mi].hooks.length - 1 })
  }

  const addMatcher = () => {
    const newMatcher: HookMatcher = { matcher: '', hooks: [{ type: 'command', command: '' }] }
    onChange([...matchers, newMatcher])
    setEditing({ mi: matchers.length, hi: 0 })
  }

  // 当前编辑的 entry
  const editingEntry = editing ? matchers[editing.mi]?.hooks[editing.hi] ?? null : null

  if (matchers.length === 0) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
        {isReadonly ? '该事件无插件 hook' : '该事件尚未配置 hook'}
        {!isReadonly && (
          <div style={{ marginTop: 8 }}>
            <button onClick={addMatcher} style={{ padding: '6px 14px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'var(--accent-text)' }}>
              + 新建 Hook
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {matchers.map((m, mi) => (
        <div key={mi} style={cardStyle}>
          {/* matcher 头 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              matcher: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{m.matcher || '(全部)'}</span>
            </span>
            {isReadonly && <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '1px 6px', border: '1px solid var(--border)', borderRadius: 999 }}>{source}</span>}
          </div>
          {/* hooks 列表 */}
          <div style={{ padding: '4px 12px' }}>
            {m.hooks.map((h, hi) => (
              <div key={hi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: hi < m.hooks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={typeBadge(h.type)}>{h.type}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {hookSummary(h) || '(空)'}
                </span>
                {!isReadonly && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <Tooltip label="编辑"><button onClick={() => setEditing({ mi, hi })} style={iconBtn}><Pencil size={12} /></button></Tooltip>
                    <Tooltip label="删除"><button onClick={() => deleteHook(mi, hi)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={12} /></button></Tooltip>
                  </div>
                )}
              </div>
            ))}
            {!isReadonly && (
              <div style={{ padding: '6px 0' }}>
                <button onClick={() => addHook(mi)} style={{ padding: '3px 10px', fontSize: 11, cursor: 'pointer', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--text-muted)' }}>
                  + 添加 hook
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {!isReadonly && (
        <button onClick={addMatcher} style={{ padding: '6px 14px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--text-muted)' }}>
          + 新建 matcher
        </button>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <HookEditDialog
          entry={editingEntry}
          onSave={saveHook}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/HookMatcherList.tsx
git commit -m "feat(ui): HookMatcherList 右侧 matcher 编辑区（插件只读）"
```

---

## Task 5: HooksSettings 主组件重写（主从布局 + 双视图）

**Files:**
- Modify: `src/renderer/components/settings/HooksSettings.tsx`

- [ ] **Step 1: 重写 HooksSettings**

完整替换 `src/renderer/components/settings/HooksSettings.tsx`：

```typescript
// Hooks 设置：左侧分组事件列表 + 右侧 matcher 编辑区，顶部列表/JSON 双视图。
// 自定义 hooks 可增删改，插件来源 hooks 只读展示。
import { useEffect, useState, useMemo } from 'react'
import type { HooksFull, HookEventView, HookMatcher } from '../../../main/claude-config'
import { HookMatcherList } from './HookMatcherList'
import { Plus } from 'lucide-react'
import { Tooltip } from '../Tooltip'

const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
  marginRight: 4,
})
const groupLabelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, padding: '8px 10px 4px', fontWeight: 600 }
const eventRowStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '6px 10px', cursor: 'pointer', borderRadius: 'var(--radius)',
  background: selected ? 'var(--accent)' : 'transparent',
  color: selected ? 'var(--accent-text)' : 'var(--text)',
})
const badgeStyle: React.CSSProperties = { fontSize: 10, padding: '0 6px', borderRadius: 999, background: 'var(--bg-sidebar)', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' }
const topIconBtn: React.CSSProperties = { padding: '4px 8px', fontSize: 14, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1 }

const GROUP_LABELS: Record<string, string> = {
  tool: '工具', session: '会话', task: '任务', permission: '权限', system: '系统',
}
const GROUP_ORDER = ['tool', 'session', 'task', 'permission', 'system']

export function HooksSettings() {
  const [data, setData] = useState<HooksFull>({ custom: [], plugins: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'json'>('list')
  const [q, setQ] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const reload = () => {
    setLoading(true); setError(null)
    window.api?.cc?.hooks.get().then(d => {
      setData(d)
      window.api?.cc?.hooks.getJson().then(txt => setJsonText(txt))
      setLoading(false)
    }).catch(() => { setError('加载失败'); setLoading(false) })
  }
  useEffect(() => { reload() }, [])

  // 合并自定义 + 插件事件（同名事件合并 matchers）
  const allEvents = useMemo(() => {
    const map = new Map<string, HookEventView>()
    for (const ev of data.custom) {
      map.set(ev.eventName, { ...ev })
    }
    for (const ev of data.plugins) {
      const existing = map.get(ev.eventName)
      if (existing) {
        existing.matchers = [...existing.matchers, ...ev.matchers]
        existing.source = `${existing.source} + ${ev.source}`
      } else {
        map.set(ev.eventName, { ...ev, matchers: [...ev.matchers] })
      }
    }
    return Array.from(map.values())
  }, [data])

  // 按分组组织
  const groupedEvents = useMemo(() => {
    const filtered = allEvents.filter(e => e.eventName.toLowerCase().includes(q.toLowerCase()))
    const groups: Record<string, HookEventView[]> = {}
    for (const ev of filtered) {
      if (!groups[ev.group]) groups[ev.group] = []
      groups[ev.group].push(ev)
    }
    return groups
  }, [allEvents, q])

  // 选中事件的详情（自定义 matchers 用于编辑，插件 matchers 拼在后面只读）
  const selectedDetail = selectedEvent ? allEvents.find(e => e.eventName === selectedEvent) : null
  // 分离自定义 matchers 和插件 matchers
  const customMatchers = selectedDetail ? data.custom.find(e => e.eventName === selectedEvent)?.matchers ?? [] : []
  const pluginMatchers = selectedDetail ? data.plugins.filter(e => e.eventName === selectedEvent) : []

  // 保存自定义 hooks（整体写回）
  const persistCustomHooks = (updatedCustom: HookEventView[]) => {
    const hooksObj: Record<string, any> = {}
    for (const ev of updatedCustom) {
      if (ev.matchers.length > 0) hooksObj[ev.eventName] = ev.matchers
    }
    window.api?.cc?.hooks.save(hooksObj).then(r => {
      if (!r.success) setError(r.errors.join('; '))
      else reload()
    })
  }

  // 修改某事件的自定义 matchers：基于 data.custom 重建
  const onMatchersChange = (eventName: string, matchers: HookMatcher[]) => {
    // 从现有 custom 中找到该事件，更新 matchers；不存在则新建
    const existing = data.custom.find(e => e.eventName === eventName)
    let updatedCustom: HookEventView[]
    if (existing) {
      updatedCustom = data.custom.map(ev =>
        ev.eventName === eventName ? { ...ev, matchers } : ev
      )
    } else if (matchers.length > 0) {
      // 新事件：根据 HOOK_GROUP_MAP 不在渲染端可用，用 selectedDetail 或默认 system
      updatedCustom = [...data.custom, { eventName, group: selectedDetail?.group ?? 'system', matchers, source: 'custom' as const, isReadonly: false }]
    } else {
      updatedCustom = data.custom
    }
    persistCustomHooks(updatedCustom)
  }

  // JSON 视图保存
  const saveJson = async () => {
    const r = await window.api?.cc?.hooks.saveJson(jsonText)
    if (!r?.success) setJsonError(r?.errors.join('; ') ?? '保存失败')
    else { setJsonError(null); reload() }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>Hooks</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip label="新建"><button aria-label="新建 Hook" onClick={() => { setSelectedEvent(null); setView('list') }} style={topIconBtn}><Plus size={14} /></button></Tooltip>
        </div>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        读写 ~/.cc-desk/claude/settings.json 的 hooks 字段。管理 Claude 各生命周期事件的命令钩子。
      </div>

      {/* 视图切换 */}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <button onClick={() => setView('list')} style={segBtn(view === 'list')}>列表</button>
        <button onClick={() => { setView('json'); setJsonError(null) }} style={segBtn(view === 'json')}>JSON</button>
      </div>

      {error && <div style={{ marginBottom: 10, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{error}</div>}

      {view === 'list' && (
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左侧：事件列表 */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <input placeholder="搜索事件..." value={q} onChange={e => setQ(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', outline: 'none', marginBottom: 8 }} />
            {loading && <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>}
            {!loading && GROUP_ORDER.map(g => {
              const evs = groupedEvents[g] ?? []
              if (evs.length === 0) return null
              return (
                <div key={g}>
                  <div style={groupLabelStyle}>{GROUP_LABELS[g]}</div>
                  {evs.map(ev => {
                    const count = ev.matchers.reduce((sum, m) => sum + m.hooks.length, 0)
                    const isPluginOnly = ev.isReadonly
                    return (
                      <div key={ev.eventName} onClick={() => setSelectedEvent(ev.eventName)} style={eventRowStyle(selectedEvent === ev.eventName)}>
                        <span style={{ fontSize: 12, fontWeight: isPluginOnly ? 400 : 500, opacity: isPluginOnly ? 0.7 : 1 }}>{ev.eventName}</span>
                        <span style={badgeStyle}>{count}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* 右侧：matcher 编辑区 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selectedDetail && (
              <div style={{ padding: 40, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>选择左侧事件查看或编辑 hook 配置</div>
            )}
            {selectedDetail && (
              <>
                <div style={{ marginBottom: 10, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{selectedDetail.eventName}</div>
                {/* 自定义 matchers */}
                <HookMatcherList
                  eventName={selectedEvent!}
                  matchers={customMatchers}
                  isReadonly={false}
                  source="custom"
                  onChange={(m) => onMatchersChange(selectedEvent!, m)}
                />
                {/* 插件 matchers（只读） */}
                {pluginMatchers.map(pm => (
                  <div key={pm.source}>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, margin: '12px 0 6px' }}>来自插件：{pm.source.replace('plugin:', '')}</div>
                    <HookMatcherList
                      eventName={selectedEvent!}
                      matchers={pm.matchers}
                      isReadonly={true}
                      source={pm.source}
                      onChange={() => {}}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {view === 'json' && (
        <>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setJsonError(null) }}
            spellCheck={false}
            style={{ width: '100%', minHeight: 400, padding: '10px', background: 'var(--bg-sidebar)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', resize: 'vertical' }}
          />
          {jsonError && <div style={{ marginTop: 6, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{jsonError}</div>}
          <div style={{ marginTop: 10 }}>
            <button onClick={saveJson} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'var(--accent-text)' }}>保存</button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/HooksSettings.tsx
git commit -m "feat(ui): HooksSettings 主从布局 + 列表/JSON 双视图"
```

---

## Task 6: 测试更新

**Files:**
- Modify: `tests/settings-pages.test.tsx`
- Modify: `tests/store-readwrite.test.ts`

- [ ] **Step 1: 重写 HooksSettings 测试**

在 `tests/settings-pages.test.tsx` 中，找到旧 HooksSettings describe 块（约 214-240 行），整体替换为：

```typescript
describe('HooksSettings', () => {
  const hooksGet = vi.fn()
  const hooksSave = vi.fn()
  const hooksGetJson = vi.fn()
  const hooksSaveJson = vi.fn()

  beforeEach(() => {
    hooksGet.mockClear(); hooksSave.mockClear(); hooksGetJson.mockClear(); hooksSaveJson.mockClear()
    hooksGet.mockResolvedValue({ custom: [], plugins: [] })
    hooksGetJson.mockResolvedValue('{}')
    hooksSave.mockResolvedValue({ success: true, errors: [] })
    hooksSaveJson.mockResolvedValue({ success: true, errors: [] })
    setApi({ cc: { hooks: { get: hooksGet, save: hooksSave, getJson: hooksGetJson, saveJson: hooksSaveJson } } })
  })

  it('列表/JSON 视图切换', async () => {
    render(<HooksSettings />)
    await screen.findByText('Hooks')
    fireEvent.click(screen.getByText('JSON'))
    expect(await screen.findByRole('textbox')).toBeTruthy()
  })

  it('空数据显示加载后无事件占位', async () => {
    render(<HooksSettings />)
    await screen.findByText('选择左侧事件查看或编辑 hook 配置')
    expect(screen.queryByText('PreToolUse')).toBeNull()
  })

  it('展示自定义事件的 matcher', async () => {
    hooksGet.mockResolvedValue({
      custom: [{ eventName: 'PreToolUse', group: 'tool', matchers: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }], source: 'custom', isReadonly: false }],
      plugins: [],
    })
    render(<HooksSettings />)
    await screen.findByText('PreToolUse')
    fireEvent.click(screen.getByText('PreToolUse'))
    expect(await screen.findByText('echo hi')).toBeTruthy()
  })

  it('插件来源 hook 只读（无编辑按钮）', async () => {
    hooksGet.mockResolvedValue({
      custom: [],
      plugins: [{ eventName: 'Stop', group: 'task', matchers: [{ matcher: '', hooks: [{ type: 'command', command: 'notify-send done' }] }], source: 'plugin:superpowers', isReadonly: true }],
    })
    render(<HooksSettings />)
    await screen.findByText('Stop')
    fireEvent.click(screen.getByText('Stop'))
    // 插件 matcher 只读，不显示「添加 hook」按钮
    await screen.findByText('notify-send done')
    expect(screen.queryByText('+ 添加 hook')).toBeNull()
  })
})
```

同时把文件顶部 import 里的 `HooksSettings` 保留（已存在），不需要改 import。

- [ ] **Step 2: 新增 hooks 后端读写测试**

在 `tests/store-readwrite.test.ts` 末尾追加（在最后一个 describe 之后）：

```typescript
describe('hooks 后端读写', () => {
  let orig: string | undefined
  beforeEach(() => { orig = process.env.HOME })
  afterEach(() => { process.env.HOME = orig; vi.resetModules() })

  it('getHooksFull 空配置返回空数组', async () => {
    await withFakeHome()
    const { getHooksFull } = await import('../src/main/claude-config')
    const d = await getHooksFull()
    expect(d.custom).toEqual([])
    expect(d.plugins).toEqual([])
  })

  it('saveHooks 写入后 getHooksFull 能读到', async () => {
    await withFakeHome()
    const { saveHooks, getHooksFull } = await import('../src/main/claude-config')
    const r = await saveHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo test' }] }] })
    expect(r.success).toBe(true)
    const d = await getHooksFull()
    expect(d.custom.length).toBe(1)
    expect(d.custom[0].eventName).toBe('PreToolUse')
    expect(d.custom[0].matchers[0].hooks[0].command).toBe('echo test')
  })

  it('saveHooks 拒绝未知事件名', async () => {
    await withFakeHome()
    const { saveHooks } = await import('../src/main/claude-config')
    const r = await saveHooks({ FakeEvent: [{ matcher: '', hooks: [{ type: 'command', command: 'x' }] }] })
    expect(r.success).toBe(false)
    expect(r.errors[0]).toContain('未知事件名')
  })

  it('saveHooks 拒绝未知 hook 类型', async () => {
    await withFakeHome()
    const { saveHooks } = await import('../src/main/claude-config')
    const r = await saveHooks({ Stop: [{ matcher: '', hooks: [{ type: 'unknown', command: 'x' }] }] })
    expect(r.success).toBe(false)
    expect(r.errors[0]).toContain('未知 type')
  })

  it('getHooksJson / saveHooksJson 往返一致', async () => {
    await withFakeHome()
    const { saveHooksJson, getHooksJson } = await import('../src/main/claude-config')
    const json = JSON.stringify({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo done' }] }] }, null, 2)
    const r = await saveHooksJson(json)
    expect(r.success).toBe(true)
    const readBack = await getHooksJson()
    expect(JSON.parse(readBack)).toEqual(JSON.parse(json))
  })

  it('saveHooksJson 拒绝非法 JSON', async () => {
    await withFakeHome()
    const { saveHooksJson } = await import('../src/main/claude-config')
    const r = await saveHooksJson('{ invalid json }}}')
    expect(r.success).toBe(false)
    expect(r.errors[0]).toContain('JSON 解析失败')
  })
})
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/settings-pages.test.tsx tests/store-readwrite.test.ts`
Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add tests/settings-pages.test.tsx tests/store-readwrite.test.ts
git commit -m "test: hooks 设置双视图 + 插件只读 + 后端 CRUD 校验"
```

---

## Task 7: 最终集成验证

- [ ] **Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 仅预存错误（CommandSettings 的 name + dataPath/bump-version 历史错误）

- [ ] **Step 3: 清理废弃引用**

检查是否有其他文件引用了旧的 `ClaudeHook` 类型或 `setEnabled`：

Run: `rg "ClaudeHook|cc\.hooks\.setEnabled|hook:set-enabled" src/`
Expected: 无结果（全部已在前面 task 清理）

如果有遗漏，修复后提交。

- [ ] **Step 4: 提交（如有遗漏修复）**

```bash
git add -A
git commit -m "feat: hooks 设置真实接入完整实现"
```
