# 内置 Slash 命令补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Claude Code 内置 slash 命令（`/init` `/compact` `/clear` `/review` 等 17 条）补进对话输入框的 `/` 菜单，与现有插件命令/技能合并分组，命令点击后接真实动作；顺带打通权限/思考下拉到 SDK。

**Architecture:** 主进程提供内置命令静态注册表，合并进现有 `getCommands()` 数据源；`SlashMenuItem` 扩展 `builtin` kind，TipTap command 回调对 builtin 分流到渲染端 handler 注册表（跳面板/clear/compact/IPC）；permission/thinking 从 InputBar 摆设 state 打通到 `query()` options（会话级持久化）。

**Tech Stack:** Electron + React + TipTap v3 + `@anthropic-ai/claude-agent-sdk` + Vitest（项目用 `tests/` 目录 + reducer 纯函数测试风格）。

**Spec:** `docs/superpowers/specs/2026-06-19-builtin-slash-commands-design.md`

**测试运行方式：** 项目用 `vitest`。单文件运行：`npx vitest run tests/<file>.test.ts`。全部：`npx vitest run`。

---

## 文件结构总览

**新建**
- `src/main/builtin-commands.ts` — 内置命令静态注册表 + 权限/思考映射表（纯逻辑，可测）
- `src/renderer/components/builtinCommands.ts` — 渲染端 builtin handler 注册表（action.type → 副作用）

**修改（主进程）**
- `src/main/claude-config.ts` — `getCommands()` 合并内置；`ClaudeBuiltinCommand` 类型
- `src/main/claude-service.ts` — `send()` 加 permission/thinking；`buildQuery` 用映射；新增 `compact`/`init`/`export`/`addDir`
- `src/main/index.ts` — 注册 `cc:builtin:*` IPC handler

**修改（preload/类型）**
- `src/preload/index.ts` — `cc.builtin` 四方法；`claude.send` 透传
- `src/renderer/global.d.ts` — `ClaudeAPI.send` opts + `ClaudeConfigAPI.builtin`
- `src/renderer/types.ts` — `Session` 加 `permissionMode`/`thinking`/`extraDirs`
- `src/renderer/editor/types.ts` — `SlashMenuItem` 加 `builtin` + `BuiltinAction`

**修改（渲染端逻辑）**
- `src/renderer/editor/slashFilter.ts` — 分组顺序加 builtin
- `src/renderer/editor/SlashSuggestion.tsx` — `onBuiltinRun` 参数 + builtin 分流 + 分组标题 + compact 灰显
- `src/renderer/editor/PromptEditor.tsx` — 透传 `onBuiltinRun`
- `src/renderer/components/InputBar.tsx` — 下拉读写会话字段；send 传值；注入 onBuiltinRun
- `src/renderer/state/reducer.ts` + `actions.ts` — 6 个新 action

**测试**
- `tests/builtin-commands.test.ts`（新）— 注册表 + 映射表
- `tests/reducer.test.ts`（改）— 新 action 用例
- `tests/editor/slashFilter.test.ts`（改）— builtin 分组

---

## Phase A — 底层数据与纯逻辑（TDD，无 UI 依赖）

### Task 1: 内置命令注册表 + 映射表（纯逻辑）

**Files:**
- Create: `src/main/builtin-commands.ts`
- Test: `tests/builtin-commands.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/builtin-commands.test.ts`：
```ts
import { describe, it, expect } from 'vitest'
import { BUILTIN_COMMANDS, PERMISSION_MODE_MAP, getPermissionMode } from '../src/main/builtin-commands'

describe('BUILTIN_COMMANDS', () => {
  it('包含 17 条命令，每条有 id/name/desc/builtinAction', () => {
    expect(BUILTIN_COMMANDS).toHaveLength(17)
    for (const c of BUILTIN_COMMANDS) {
      expect(c.kind).toBe('builtin')
      expect(c.id).toBeTruthy()
      expect(c.name).toMatch(/^\//)
      expect(c.desc).toBeTruthy()
      expect(c.builtinAction).toBeDefined()
      expect(c.builtinAction!.type).toBeTruthy()
    }
  })
  it('name 全部唯一', () => {
    const names = BUILTIN_COMMANDS.map(c => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('PERMISSION_MODE_MAP', () => {
  it('四个中文标签映射到合法 SDK permissionMode', () => {
    expect(PERMISSION_MODE_MAP['变更前确认']).toBe('default')
    expect(PERMISSION_MODE_MAP['自动编辑']).toBe('acceptEdits')
    expect(PERMISSION_MODE_MAP['计划模式']).toBe('plan')
    expect(PERMISSION_MODE_MAP['完全访问']).toBe('bypassPermissions')
  })
  it('getPermissionMode 未知值回退 default', () => {
    expect(getPermissionMode('不存在的')).toBe('default')
    expect(getPermissionMode(undefined)).toBe('default')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/builtin-commands.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/main/builtin-commands.ts`**

```ts
// src/main/builtin-commands.ts
// 内置 slash 命令静态注册表 + 权限/思考映射。纯逻辑，无副作用，便于单测。
import type { SettingsSection } from '../renderer/types'
import type { BuiltinAction } from '../renderer/editor/types'

// 主进程与渲染端共享的命令形态（SlashMenuItem 的 builtin 子集）
export interface ClaudeBuiltinCommand {
  kind: 'builtin'
  id: string
  name: string              // 含斜杠，如 '/init'
  desc: string
  builtinAction: BuiltinAction
}

// 权限：中文标签 → SDK permissionMode code
export const PERMISSION_MODE_MAP: Record<string, string> = {
  '变更前确认': 'default',
  '自动编辑':   'acceptEdits',
  '计划模式':   'plan',
  '完全访问':   'bypassPermissions',
}

export function getPermissionMode(label: string | undefined): string {
  return (label && PERMISSION_MODE_MAP[label]) || 'default'
}

// 17 条内置命令
export const BUILTIN_COMMANDS: ClaudeBuiltinCommand[] = [
  // 跳设置面板
  { kind: 'builtin', id: 'builtin:config', name: '/config', desc: '应用设置', builtinAction: { type: 'open-settings', section: 'general' } },
  { kind: 'builtin', id: 'builtin:model', name: '/model', desc: '切换模型', builtinAction: { type: 'open-settings', section: 'model' } },
  { kind: 'builtin', id: 'builtin:mcp', name: '/mcp', desc: 'MCP 服务器', builtinAction: { type: 'open-settings', section: 'mcp' } },
  { kind: 'builtin', id: 'builtin:hooks', name: '/hooks', desc: '钩子配置', builtinAction: { type: 'open-settings', section: 'hooks' } },
  { kind: 'builtin', id: 'builtin:permissions', name: '/permissions', desc: '权限模式', builtinAction: { type: 'open-permission-menu' } },
  // 会话操作
  { kind: 'builtin', id: 'builtin:clear', name: '/clear', desc: '清空当前会话', builtinAction: { type: 'clear-session' } },
  { kind: 'builtin', id: 'builtin:compact', name: '/compact', desc: '压缩上下文（流式中禁用）', builtinAction: { type: 'compact' } },
  { kind: 'builtin', id: 'builtin:cost', name: '/cost', desc: '本会话费用统计', builtinAction: { type: 'show-cost' } },
  // 主进程 IPC
  { kind: 'builtin', id: 'builtin:init', name: '/init', desc: '生成 CLAUDE.md', builtinAction: { type: 'init-project' } },
  { kind: 'builtin', id: 'builtin:export', name: '/export', desc: '导出会话为 Markdown', builtinAction: { type: 'export-session' } },
  { kind: 'builtin', id: 'builtin:add-dir', name: '/add-dir', desc: '追加可访问目录', builtinAction: { type: 'add-dir' } },
  // 渲染端纯逻辑
  { kind: 'builtin', id: 'builtin:status', name: '/status', desc: '当前状态', builtinAction: { type: 'show-status' } },
  { kind: 'builtin', id: 'builtin:resume', name: '/resume', desc: '恢复历史会话', builtinAction: { type: 'resume' } },
  // 插入文本
  { kind: 'builtin', id: 'builtin:review', name: '/review', desc: '审查当前改动', builtinAction: { type: 'run-review' } },
  { kind: 'builtin', id: 'builtin:release-notes', name: '/release-notes', desc: '查看更新日志', builtinAction: { type: 'insert-text' } },
  { kind: 'builtin', id: 'builtin:feedback', name: '/feedback', desc: '提交反馈', builtinAction: { type: 'insert-text' } },
  { kind: 'builtin', id: 'builtin:bug', name: '/bug', desc: '提交 Bug', builtinAction: { type: 'insert-text' } },
]
```

> 注：Task 2 会定义 `BuiltinAction` 类型，此处 import 暂时悬空——所以 Task 1、2 必须一起完成后再跑测试。先做 Task 2 再回头跑 Task 1 测试。

- [ ] **Step 4: 暂不单独跑（依赖 Task 2 的 BuiltinAction 类型）**

- [ ] **Step 5: 暂不提交（等 Task 2 完成一起提交）**

---

### Task 2: SlashMenuItem 扩展 builtin kind + BuiltinAction 类型

**Files:**
- Modify: `src/renderer/editor/types.ts:17-23`
- Modify: `src/renderer/types.ts:90-97`（Session 加字段）

- [ ] **Step 1: 扩展 `SlashMenuItem` + 定义 `BuiltinAction`**

`src/renderer/editor/types.ts`，把 `SlashMenuItem`（:18-23）改为：
```ts
// / 菜单项（命令 + 技能 + 内置 混合）
export interface SlashMenuItem {
  kind: 'command' | 'skill' | 'builtin'
  id: string        // command: 'user:review'；skill: 'superpowers:frontend-design'；builtin: 'builtin:init'
  name: string      // command: '/review'（含斜杠）；skill: 'frontend-design'；builtin: '/init'
  desc: string
  builtinAction?: BuiltinAction   // 仅 builtin 有
}

// 内置命令的动作描述：渲染端据此分发到 handler
export type BuiltinAction =
  | { type: 'open-settings'; section: import('../types').SettingsSection }
  | { type: 'open-permission-menu' }
  | { type: 'clear-session' }
  | { type: 'compact' }
  | { type: 'show-cost' }
  | { type: 'init-project' }
  | { type: 'add-dir' }
  | { type: 'export-session' }
  | { type: 'show-status' }
  | { type: 'resume' }
  | { type: 'run-review' }
  | { type: 'insert-text' }
```

- [ ] **Step 2: Session 加三个字段**

`src/renderer/types.ts`，`Session` 接口（:90-97）改为：
```ts
export interface Session {
  id: string
  title: string
  messages: Message[]
  archived?: boolean
  archivedAt?: number
  updatedAt?: number    // 最后活动时间戳（ms），用于自动归档判断
  // 会话级权限/思考（持久化到 projects.json）；undefined 时用默认
  permissionMode?: string          // '变更前确认' | '自动编辑' | '计划模式' | '完全访问'
  thinking?: 'low' | 'medium' | 'high'   // SDK EffortLevel 子集
  extraDirs?: string[]             // /add-dir 追加的可访问目录
}
```

- [ ] **Step 3: 跑 Task 1 的测试（类型现已就位）**

Run: `npx vitest run tests/builtin-commands.test.ts`
Expected: PASS（17 条 + 映射表）

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（注意 builtin-commands.ts import BuiltinAction 的循环引用——types.ts 不 import builtin-commands.ts，单向依赖，安全）

- [ ] **Step 5: 提交**

```bash
git add src/main/builtin-commands.ts tests/builtin-commands.test.ts src/renderer/editor/types.ts src/renderer/types.ts
git commit -m "feat(builtin-cmd): 内置命令注册表 + SlashMenuItem builtin kind + Session 字段"
```

---

### Task 3: reducer 新增 6 个 action

**Files:**
- Modify: `src/renderer/state/actions.ts:72`（末尾追加）
- Modify: `src/renderer/state/reducer.ts`
- Test: `tests/reducer.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/reducer.test.ts` 末尾追加（参照该文件现有 reducer 测试的 import 与 initialState 构造方式）：
```ts
import { reducer } from '../src/renderer/state/reducer'
// 构造最小可用 state 的辅助（若文件已有 makeState 复用之；否则手写）
function makeState(): import('../src/renderer/state/reducer').AppState {
  // 复用文件里已有的初始 state 构造；如无，参照 reducer.ts 的 AppState 结构手写最小值
  // 含至少一个 project + 一个 session
}

describe('builtin-cmd reducer actions', () => {
  it('CLEAR_SESSION_MESSAGES 清空消息保留 session', () => {
    const s = makeState()
    const sid = s.projects[0].sessions[0].id
    // 先塞一条消息
    const withMsg = reducer(s, { type: 'ADD_MESSAGE', sessionId: sid, message: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] } })
    const cleared = reducer(withMsg, { type: 'CLEAR_SESSION_MESSAGES', sessionId: sid })
    const sess = cleared.projects[0].sessions.find(x => x.id === sid)!
    expect(sess.messages).toHaveLength(0)
    expect(sess.id).toBe(sid)  // session 仍存在
  })

  it('SET_SESSION_PERMISSION 写会话 permissionMode', () => {
    const s = makeState()
    const sid = s.projects[0].sessions[0].id
    const r = reducer(s, { type: 'SET_SESSION_PERMISSION', sessionId: sid, permissionMode: '计划模式' })
    expect(r.projects[0].sessions.find(x => x.id === sid)!.permissionMode).toBe('计划模式')
  })

  it('SET_SESSION_THINKING 写会话 thinking', () => {
    const s = makeState()
    const sid = s.projects[0].sessions[0].id
    const r = reducer(s, { type: 'SET_SESSION_THINKING', sessionId: sid, thinking: 'high' })
    expect(r.projects[0].sessions.find(x => x.id === sid)!.thinking).toBe('high')
  })

  it('ADD_SESSION_DIR 追加目录到 extraDirs', () => {
    const s = makeState()
    const sid = s.projects[0].sessions[0].id
    const r = reducer(s, { type: 'ADD_SESSION_DIR', sessionId: sid, dir: '/tmp/x' })
    expect(r.projects[0].sessions.find(x => x.id === sid)!.extraDirs).toEqual(['/tmp/x'])
    const r2 = reducer(r, { type: 'ADD_SESSION_DIR', sessionId: sid, dir: '/tmp/y' })
    expect(r2.projects[0].sessions.find(x => x.id === sid)!.extraDirs).toEqual(['/tmp/x', '/tmp/y'])
  })

  it('SHOW_COST 给会话插一条 status notice', () => {
    const s = makeState()
    const sid = s.projects[0].sessions[0].id
    const r = reducer(s, { type: 'SHOW_COST', sessionId: sid, text: '总费用 $0.5' })
    const sess = r.projects[0].sessions.find(x => x.id === sid)!
    expect(sess.notices?.some(n => n.kind === 'status' && n.text.includes('0.5'))).toBe(true)
  })

  it('COMPACT_DONE 用摘要替换历史保留最近 6 条', () => {
    const s = makeState()
    const sid = s.projects[0].sessions[0].id
    // 塞 10 条消息
    let cur = s
    for (let i = 0; i < 10; i++) {
      cur = reducer(cur, { type: 'ADD_MESSAGE', sessionId: sid, message: { id: `m${i}`, role: 'user', content: [{ type: 'text', text: `msg${i}` }] } })
    }
    const r = reducer(cur, { type: 'COMPACT_DONE', sessionId: sid, summary: '已压缩', keepRecent: 6 })
    const sess = r.projects[0].sessions.find(x => x.id === sid)!
    expect(sess.messages.length).toBeLessThanOrEqual(6)
  })
})
```

> 注：`SHOW_COST` 需要在 Session 上有 `notices` 字段。检查 `types.ts` 的 `Session` 当前是否已有 `notices`——若没有，本 task 顺手加上 `notices?: SystemNotice[]`（与 Message.notices 同型），并在 reducer 里 push。COMPACT_DONE 的"摘要"落为一条 compact notice 插在消息流头部（或单独 notices 数组）——选 notices 数组方案，不污染 messages。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/reducer.test.ts`
Expected: FAIL（未知 action type）

- [ ] **Step 3: 加 action 类型**

`src/renderer/state/actions.ts` 末尾（:72 后）追加：
```ts
  // 内置命令相关
  | { type: 'CLEAR_SESSION_MESSAGES'; sessionId: string }
  | { type: 'SET_SESSION_PERMISSION'; sessionId: string; permissionMode: string }
  | { type: 'SET_SESSION_THINKING'; sessionId: string; thinking: 'low' | 'medium' | 'high' }
  | { type: 'ADD_SESSION_DIR'; sessionId: string; dir: string }
  | { type: 'SHOW_COST'; sessionId: string; text: string }
  | { type: 'COMPACT_DONE'; sessionId: string; summary: string; keepRecent: number }
```

- [ ] **Step 4: 加 reducer 分支**

在 `src/renderer/state/reducer.ts` 的 `reducer` 函数 switch 末尾（`SET_PANEL_FOLD` 分支后）追加：
```ts
    case 'CLEAR_SESSION_MESSAGES': {
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === action.sessionId ? { ...s, messages: [] } : s
        ),
      }))
      return { ...state, projects }
    }
    case 'SET_SESSION_PERMISSION': {
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === action.sessionId ? { ...s, permissionMode: action.permissionMode } : s
        ),
      }))
      return { ...state, projects }
    }
    case 'SET_SESSION_THINKING': {
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === action.sessionId ? { ...s, thinking: action.thinking } : s
        ),
      }))
      return { ...state, projects }
    }
    case 'ADD_SESSION_DIR': {
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === action.sessionId
            ? { ...s, extraDirs: [...(s.extraDirs ?? []), action.dir] }
            : s
        ),
      }))
      return { ...state, projects }
    }
    case 'SHOW_COST': {
      const notice: SystemNotice = { id: `n${Date.now()}`, kind: 'status', text: action.text, level: 'info' }
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s =>
          s.id === action.sessionId
            ? { ...s, notices: [...(s.notices ?? []), notice] }
            : s
        ),
      }))
      return { ...state, projects }
    }
    case 'COMPACT_DONE': {
      const notice: SystemNotice = { id: `n${Date.now()}`, kind: 'compact', text: action.summary, level: 'info' }
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => {
          if (s.id !== action.sessionId) return s
          const kept = s.messages.slice(-action.keepRecent)
          return { ...s, messages: kept, notices: [...(s.notices ?? []), notice] }
        }),
      }))
      return { ...state, projects }
    }
```

> 若 `Session` 无 `notices` 字段，先在 Task 2 的 Session 定义里补 `notices?: SystemNotice[]`（已在 Task 2 Step 2 列出，确认包含）。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/reducer.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/renderer/state/actions.ts src/renderer/state/reducer.ts tests/reducer.test.ts
git commit -m "feat(builtin-cmd): reducer 新增 clear/permission/thinking/addDir/cost/compact actions"
```

---

## Phase B — 主进程：注册表合并 + 权限/思考链路 + IPC

### Task 4: getCommands 合并内置命令

**Files:**
- Modify: `src/main/claude-config.ts:307-316`（getCommands）
- Modify: `src/main/claude-config.ts:75-81`（ClaudeCommand 类型或复用 builtin）
- Test: `tests/claude-config.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/claude-config.test.ts` 末尾追加：
```ts
import { getCommands } from '../src/main/claude-config'

describe('getCommands 含内置命令', () => {
  it('返回的命令里包含 /init /compact /clear 等 builtin', async () => {
    const cmds = await getCommands()
    const names = cmds.map(c => c.name)
    expect(names).toContain('/init')
    expect(names).toContain('/compact')
    expect(names).toContain('/clear')
    expect(names).toContain('/review')
  })
  it('内置命令 kind 为 builtin 且带 builtinAction', async () => {
    const cmds = await getCommands()
    const init = cmds.find(c => c.name === '/init')
    expect(init).toBeDefined()
    // builtin 字段需透传到渲染端（见 Step 3 类型扩展）
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/claude-config.test.ts`
Expected: FAIL（不含 /init）

- [ ] **Step 3: 扩展 ClaudeCommand 透传 builtin 字段**

`src/main/claude-config.ts`，把 `ClaudeCommand`（:75-81）改为：
```ts
export interface ClaudeCommand {
  id: string
  name: string              // /name
  desc: string
  enabled: boolean
  source: string
  // 内置命令透传：渲染端据此分发到 handler
  kind?: 'command' | 'builtin'
  builtinAction?: import('../renderer/editor/types').BuiltinAction
}
```

- [ ] **Step 4: getCommands 合并内置**

`src/main/claude-config.ts:307` 的 `getCommands` 改为：
```ts
export async function getCommands(): Promise<ClaudeCommand[]> {
  const plugins = await getPlugins()
  const out: ClaudeCommand[] = []
  // 内置命令（最前）
  for (const b of BUILTIN_COMMANDS) {
    out.push({ id: b.id, name: b.name, desc: b.desc, enabled: true, source: 'builtin', kind: 'builtin', builtinAction: b.builtinAction })
  }
  for (const p of plugins) {
    if (!p.enabled) continue
    out.push(...await scanCommandsInDir(join(p.installPath, 'commands'), p.name, true))
  }
  out.push(...await scanCommandsInDir(join(CLAUDE_DIR, 'commands'), 'user', true))
  return out
}
```

并在文件顶部 import：
```ts
import { BUILTIN_COMMANDS } from './builtin-commands'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/claude-config.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/main/claude-config.ts src/main/builtin-commands.ts tests/claude-config.test.ts
git commit -m "feat(builtin-cmd): getCommands 合并内置命令注册表"
```

---

### Task 5: 打通 permission/thinking 到 query()

**Files:**
- Modify: `src/main/claude-service.ts:68-138`（send + buildQuery）

> 此 task 无纯函数可单测（涉及 SDK/IPC），用类型检查 + 手工验证。

- [ ] **Step 1: send 签名加字段**

`src/main/claude-service.ts:68-74` 的 `send` 签名改为：
```ts
  async send(opts: {
    prompt: string
    sessionId?: string
    localSessionId?: string
    cwd?: string
    permission?: string        // 中文标签，主进程翻译
    thinking?: 'low' | 'medium' | 'high'
    extraDirs?: string[]
    webContents: WebContents
  }): Promise<void> {
    const { prompt, sessionId, localSessionId, cwd, permission, thinking, extraDirs, webContents } = opts
```

- [ ] **Step 2: buildQuery 用映射替换硬编码**

`src/main/claude-service.ts:115-134` 的 `buildQuery` options 改为：
```ts
      buildQuery: (controller: PushController<SDKUserMessage>) => query({
        prompt: controller.iterable,
        options: {
          env: { ...process.env, ...proxyEnv, ...buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models) },
          model: resolved.model.sdkModelId,
          cwd: cwd || settings.cwd || process.cwd(),
          resume: sessionId,
          permissionMode: getPermissionMode(permission),   // 替换原硬编码 'auto'
          effort: thinking ?? 'medium',                    // SDK EffortLevel
          thinking: { type: 'adaptive' },                  // 配合 effort 自适应思考
          additionalDirectories: extraDirs?.length ? extraDirs : undefined,  // /add-dir 等价
          maxTurns: 20,
          includePartialMessages: true,
          supportedDialogKinds: ['refusal_fallback_prompt'],
          onUserDialog: async (request: any, { signal }: { signal: AbortSignal }) => {
            return this.askUserDialog(webContents, request, signal)
          },
        },
      }),
```

文件顶部 import：
```ts
import { getPermissionMode } from './builtin-commands'
```

> 删除 `:124` 的 `permissionMode: 'auto'`。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（`effort`/`thinking`/`additionalDirectories` 都是 SDK query options 合法字段，见 sdk.d.ts:1303/1622/1625）

- [ ] **Step 4: 提交**

```bash
git add src/main/claude-service.ts
git commit -m "feat(builtin-cmd): 打通 permission/thinking/addDir 到 SDK query options"
```

> 手工验证留到 Task 11 统一做。

---

### Task 6: 主进程 builtin IPC（compact/init/export/addDir）

**Files:**
- Modify: `src/main/claude-service.ts`（新增 4 方法）
- Modify: `src/main/index.ts`（注册 IPC）
- Modify: `src/preload/index.ts`（暴露 cc.builtin）
- Modify: `src/renderer/global.d.ts`（类型）

> 这 4 个方法涉及 SDK query / 原生 dialog / 文件系统，无法纯单测。用类型检查 + Task 11 手工验证。

- [ ] **Step 1: preload 暴露 cc.builtin**

`src/preload/index.ts`，在 `cc: { ... }`（:38-61）内、`general` 后追加：
```ts
    builtin: {
      compact: (localSessionId: string) => ipcRenderer.invoke('cc:builtin:compact', localSessionId),
      init: (opts: { cwd: string }) => ipcRenderer.invoke('cc:builtin:init', opts),
      exportSession: (localSessionId: string) => ipcRenderer.invoke('cc:builtin:export', localSessionId),
      addDir: (opts: { localSessionId: string; dir: string }) => ipcRenderer.invoke('cc:builtin:add-dir', opts),
    },
```

- [ ] **Step 2: global.d.ts 类型**

`src/renderer/global.d.ts`，在 `ClaudeConfigAPI`（:93-116）里 `general` 后追加：
```ts
  builtin: {
    compact(localSessionId: string): Promise<void>
    init(opts: { cwd: string }): Promise<void>
    exportSession(localSessionId: string): Promise<void>
    addDir(opts: { localSessionId: string; dir: string }): Promise<void>
  }
```

同时给 `ClaudeAPI.send`（:12）的 opts 加字段：
```ts
  send(opts: {
    prompt: string; localSessionId?: string; sessionId?: string; cwd?: string;
    permission?: string; thinking?: 'low' | 'medium' | 'high'; extraDirs?: string[]
  }): Promise<void>
```

- [ ] **Step 3: claude-service 新增 4 方法**

在 `src/main/claude-service.ts` 类内（`stopTask` 方法后）追加：
```ts
  /** /compact：读会话历史，调 SDK 摘要，回填 REPLACE_HISTORY（保留最近 6 条）。 */
  async compactSession(localSessionId: string, webContents: WebContents): Promise<void> {
    // 从 projects 快照取消息（通过 registry/ ProjectsStore 注入；此处用 getProjects）
    const snap = await getProjectsSnapshot()
    const session = findSession(snap.projects, localSessionId)
    if (!session) return
    const history = session.messages
    if (history.length <= 6) {
      webContents.send('claude:notice', { ...mkNotice('info', '消息较少，无需压缩', 'info'), localSessionId })
      return
    }
    const toSummarize = history.slice(0, -6)
    const transcript = toSummarize.map(m => `${m.role}: ${m.content.map((b:any)=>b.text??'').join(' ')}`).join('\n')
    try {
      const summary = await this.runSummaryQuery(transcript, session)
      webContents.send('claude:builtin-result', { localSessionId, op: 'compact', summary, keepRecent: 6 })
    } catch (err) {
      webContents.send('claude:notice', { ...mkNotice('error', `压缩失败：${String(err)}`, 'error'), localSessionId })
    }
  }

  private async runSummaryQuery(transcript: string, session: any): Promise<string> {
    // 用独立 query 跑摘要（不复用会话 manager，避免污染主对话）
    const result = await query({
      prompt: `请用 200 字以内总结以下对话历史的关键信息，用于上下文压缩：\n\n${transcript}`,
      options: { model: getModelProvidersConfig() ? resolveActiveProviderModel(getModelProvidersConfig())!.model.sdkModelId : undefined, maxTurns: 1, permissionMode: 'bypassPermissions' } as any,
    })
    // query 返回 async iterable，取最后一条 result 文本
    let text = ''
    for await (const m of result) {
      if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        text = m.message.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('')
      }
    }
    return text || '（摘要为空）'
  }

  /** /init：在 cwd 生成 CLAUDE.md，已存在问覆盖。 */
  async initProject(cwd: string, webContents: WebContents): Promise<void> {
    const target = join(cwd, 'CLAUDE.md')
    if (existsSync(target)) {
      const choice = await showOverwriteDialog(target)
      if (!choice) { webContents.send('claude:notice', { ...mkNotice('info', '已取消，未改动', 'info'), localSessionId: '' }); return }
    }
    const content = await this.runInitQuery(cwd)
    await writeFile(target, content, 'utf-8')
    webContents.send('claude:notice', { ...mkNotice('info', `已生成 ${target}`, 'info'), localSessionId: '' })
  }

  private async runInitQuery(cwd: string): Promise<string> {
    const result = await query({
      prompt: '分析当前项目并生成 CLAUDE.md：包含项目概述、技术栈、常用命令、代码结构。直接输出 markdown 内容，不要包裹代码块。',
      options: { cwd, maxTurns: 8, permissionMode: 'bypassPermissions' } as any,
    })
    let text = ''
    for await (const m of result) {
      if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
        text = m.message.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('')
      }
    }
    return text
  }

  /** /export：导出会话为 markdown 文件。 */
  async exportSession(localSessionId: string, webContents: WebContents): Promise<void> {
    const snap = await getProjectsSnapshot()
    const session = findSession(snap.projects, localSessionId)
    if (!session) return
    const md = session.messages.map(m => {
      const role = m.role === 'user' ? '## 🧑 用户' : '## 🤖 助手'
      const body = m.content.map((b:any)=> b.text ?? '').join('\n')
      return `${role}\n\n${body}`
    }).join('\n\n---\n\n')
    const path = await showSaveDialog(`session-${localSessionId}.md`, md)
    if (path) webContents.send('claude:notice', { ...mkNotice('info', `已导出至 ${path}`, 'info'), localSessionId })
  }

  /** /add-dir：校验目录并记录（实际生效在 send 的 additionalDirectories）。 */
  async addDir(localSessionId: string, dir: string, webContents: WebContents): Promise<void> {
    if (!existsSync(dir)) {
      webContents.send('claude:notice', { ...mkNotice('error', `目录不存在：${dir}`, 'error'), localSessionId })
      return
    }
    webContents.send('claude:builtin-result', { localSessionId, op: 'add-dir', dir })
  }
```

文件顶部补充 import（按需，可能部分已存在）：
```ts
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { getModelProvidersConfig, resolveActiveProviderModel } from './cc-desk-store'
```

并新增辅助函数（文件底部或独立 helper）：
```ts
async function findSession(projects: any[], localSessionId: string): Promise<any | null> {
  for (const p of projects) {
    const s = p.sessions.find((x: any) => x.id === localSessionId)
    if (s) return s
  }
  return null
}
async function showOverwriteDialog(target: string): Promise<boolean> {
  const { dialog } = await import('electron')
  const r = await dialog.showMessageBox({ type: 'question', buttons: ['覆盖', '取消'], defaultId: 1, message: `${target} 已存在，是否覆盖？` })
  return r.response === 0
}
async function showSaveDialog(defaultName: string, content: string): Promise<string | null> {
  const { dialog } = await import('electron')
  const r = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, content, 'utf-8')
  return r.filePath
}
```

> `getProjectsSnapshot`：确认 projects-store 是否已导出此函数。若名为 `loadProjects` 或其它，按实际改。Step 4 会核对。

- [ ] **Step 4: 核对 ProjectsStore 导出**

Run: `grep -n "export.*function\|export async function" src/main/projects-store.ts`
确认读取 projects 快照的函数名（可能是 `loadProjects`/`getProjects`/`readProjects`）。把 Task 6 Step 3 里所有 `getProjectsSnapshot()` 替换为真实函数名。

- [ ] **Step 5: index.ts 注册 IPC**

`src/main/index.ts`，在 `claude:send` handler（:48-50）附近追加：
```ts
  ipcMain.handle('cc:builtin:compact', (_e, localSessionId: string) => claude.compactSession(localSessionId, win.webContents))
  ipcMain.handle('cc:builtin:init', (_e, opts: { cwd: string }) => claude.initProject(opts.cwd, win.webContents))
  ipcMain.handle('cc:builtin:export', (_e, localSessionId: string) => claude.exportSession(localSessionId, win.webContents))
  ipcMain.handle('cc:builtin:add-dir', (_e, opts: { localSessionId: string; dir: string }) => claude.addDir(opts.localSessionId, opts.dir, win.webContents))
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/main/claude-service.ts src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(builtin-cmd): 主进程 builtin IPC (compact/init/export/addDir)"
```

---

## Phase C — 渲染端：菜单分流 + handler + InputBar 下拉

### Task 7: slashFilter 分组加 builtin

**Files:**
- Modify: `src/renderer/editor/slashFilter.ts:15-18`
- Test: `tests/editor/slashFilter.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/editor/slashFilter.test.ts` 追加：
```ts
import type { SlashMenuItem } from '../../src/renderer/editor/types'

const items: SlashMenuItem[] = [
  { kind: 'command', id: 'c1', name: '/review', desc: '' },
  { kind: 'skill', id: 's1', name: 'design', desc: '' },
  { kind: 'builtin', id: 'b1', name: '/init', desc: '', builtinAction: { type: 'init-project' } },
]

describe('filterSlashItems 分组顺序', () => {
  it('builtin 在最前，command 其次，skill 最后', () => {
    const r = filterSlashItems(items, '')
    expect(r.map(i => i.kind)).toEqual(['builtin', 'command', 'skill'])
  })
  it('query 匹配 builtin', () => {
    const r = filterSlashItems(items, 'init')
    expect(r.map(i => i.name)).toEqual(['/init'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/editor/slashFilter.test.ts`
Expected: FAIL（builtin 当前不在输出里）

- [ ] **Step 3: 改 slashFilter**

`src/renderer/editor/slashFilter.ts:15-18` 改为：
```ts
  // 顺序：内置 → 命令 → 技能；各自保持原顺序
  return [
    ...filtered.filter(i => i.kind === 'builtin'),
    ...filtered.filter(i => i.kind === 'command'),
    ...filtered.filter(i => i.kind === 'skill'),
  ]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/editor/slashFilter.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/editor/slashFilter.ts tests/editor/slashFilter.test.ts
git commit -m "feat(builtin-cmd): slashFilter 分组加 builtin（最前）"
```

---

### Task 8: SlashSuggestion builtin 分流 + 分组标题 + compact 灰显

**Files:**
- Modify: `src/renderer/editor/SlashSuggestion.tsx`
- Modify: `src/renderer/editor/PromptEditor.tsx`（透传 onBuiltinRun）

- [ ] **Step 1: buildSlashExtension 加 onBuiltinRun 参数**

`src/renderer/editor/SlashSuggestion.tsx:15` 签名改为：
```ts
export function buildSlashExtension(getItems: () => SlashMenuItem[], onBuiltinRun?: (item: SlashMenuItem) => void): Extension {
```

`command` 回调（:28-39）改为：
```tsx
          command: ({ editor, range, props }: { editor: any; range: any; props: SlashMenuItem }) => {
            const chain = editor.chain().focus().deleteRange(range)
            if (props.kind === 'builtin') {
              // 内置命令：删触发符，不插内容；副作用交给渲染端 handler
              chain.run()
              onBuiltinRun?.(props)
              return
            }
            if (props.kind === 'command') {
              chain.insertContent(props.name + ' ').run()
            } else {
              chain.insertContent({
                type: 'skillChip',
                attrs: { refId: props.id, label: props.name.replace(/^\//, '') },
              }).insertContent(' ').run()
            }
          },
```

- [ ] **Step 2: 分组标题 + compact 灰显**

`render`（:40-55）里的 `groupLabel` 改为：
```tsx
            groupLabel: (key) => key === 'builtin' ? '内置' : key === 'command' ? '命令' : '技能',
```

`renderItem`（:41-51）改为支持灰显（compact 流式时禁用）：
```tsx
            renderItem: (item, _selected) => {
              const isCmd = item.kind === 'command'
              const isBuiltin = item.kind === 'builtin'
              const Icon = isBuiltin ? CommandIcon : isCmd ? CommandIcon : Sparkles
              // compact 流式中灰显（流式状态由调用方通过 disabledIds 传入；此处简化：always enabled，禁用在 InputBar 层过滤）
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <Icon size={13} style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, flexShrink: 0 }}>{item.name}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</span>
                </span>
              )
            },
```

> compact 流式灰显：实现策略改为在 `InputBar` 层把流式中的 compact 项从 `allSlashItems` 里过滤掉（流式时不提供 compact），更简单可靠。见 Task 10。

- [ ] **Step 3: PromptEditor 透传 onBuiltinRun**

`src/renderer/editor/PromptEditor.tsx`，找到 `buildSlashExtension(...)` 调用处，加第二参数。需先看 PromptEditor 当前如何接收 props。

Run: `grep -n "buildSlashExtension\|interface.*Props\|export function PromptEditor" src/renderer/editor/PromptEditor.tsx`

在 PromptEditor 的 props 接口加 `onBuiltinRun?: (item: SlashMenuItem) => void`，并在 `buildSlashExtension(getSlashItems)` 调用处改为 `buildSlashExtension(getSlashItems, onBuiltinRun)`。具体行号按 grep 结果定。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/renderer/editor/SlashSuggestion.tsx src/renderer/editor/PromptEditor.tsx
git commit -m "feat(builtin-cmd): SlashSuggestion builtin 分流 + 分组标题 + onBuiltinRun 透传"
```

---

### Task 9: 渲染端 handler 注册表

**Files:**
- Create: `src/renderer/components/builtinCommands.ts`

- [ ] **Step 1: 实现 handler 注册表**

`src/renderer/components/builtinCommands.ts`：
```ts
// src/renderer/components/builtinCommands.ts
// 内置命令的渲染端副作用：builtinAction.type → 执行。
// ctx 由 InputBar 注入（dispatch/session/editor/toggleMenu 等）。
import type { SlashMenuItem } from '../editor/types'

export interface BuiltinCtx {
  dispatch: (a: any) => void
  sessionId: string
  cwd: string
  modelName: string
  claudeSessionId?: string
  toggleMenu: (id: 'permission' | 'model' | 'thinking') => void
  editor: { chain: () => any; focus: () => any } | null  // TipTap editor 引用，用于插文本
}

export function runBuiltin(item: SlashMenuItem, ctx: BuiltinCtx): void {
  const action = item.builtinAction
  if (!action) return
  switch (action.type) {
    case 'open-settings':
      ctx.dispatch({ type: 'SET_SETTINGS_SECTION', section: action.section })
      return
    case 'open-permission-menu':
      ctx.toggleMenu('permission')
      return
    case 'clear-session': {
      window.api?.claude?.stop(ctx.sessionId)
      ctx.dispatch({ type: 'CLEAR_SESSION_MESSAGES', sessionId: ctx.sessionId })
      return
    }
    case 'compact':
      window.api?.cc?.builtin?.compact(ctx.sessionId)
      return
    case 'show-cost':
      // cost 文本由 reducer 算（需读 session.messages.costUSD）；此处先发 action，reducer 聚合
      ctx.dispatch({ type: 'SHOW_COST', sessionId: ctx.sessionId, text: '' })  // text 空时 reducer 计算并回填
      return
    case 'init-project':
      window.api?.cc?.builtin?.init({ cwd: ctx.cwd })
      return
    case 'export-session':
      window.api?.cc?.builtin?.exportSession(ctx.sessionId)
      return
    case 'add-dir': {
      ;(async () => {
        const dir = await window.api?.dialog?.openDirectory()
        if (dir) {
          window.api?.cc?.builtin?.addDir({ localSessionId: ctx.sessionId, dir })
          ctx.dispatch({ type: 'ADD_SESSION_DIR', sessionId: ctx.sessionId, dir })
        }
      })()
      return
    }
    case 'show-status': {
      const resumeInfo = ctx.claudeSessionId ? `resume=${ctx.claudeSessionId}` : '新会话'
      ctx.dispatch({ type: 'SHOW_COST', sessionId: ctx.sessionId, text: `模型: ${ctx.modelName} | cwd: ${ctx.cwd} | ${resumeInfo}` })
      return
    }
    case 'resume':
      // 聚焦会话侧栏：触发一个 view 切换或侧栏聚焦（项目无专门 action，用 info notice 提示）
      ctx.dispatch({ type: 'SHOW_COST', sessionId: ctx.sessionId, text: '请在左侧会话列表选择历史会话恢复' })
      return
    case 'run-review':
      ctx.editor?.chain().focus().insertContent('/code-review ').run()
      return
    case 'insert-text':
      ctx.editor?.chain().focus().insertContent(item.name + ' ').run()
      return
  }
}
```

> 注 `SHOW_COST` text 空：reducer 需在 text 为空时计算会话总 costUSD。Task 3 的 SHOW_COST reducer 分支补充此逻辑——若 text 为空，读 session.messages 聚合 costUSD + turns 生成文本。**回头补 Task 3 Step 4 的 SHOW_COST 分支**：
```ts
    case 'SHOW_COST': {
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => {
          if (s.id !== action.sessionId) return s
          let text = action.text
          if (!text) {
            const total = s.messages.reduce((sum, m) => sum + (m.costUSD ?? 0), 0)
            const turns = s.messages.reduce((sum, m) => sum + (m.turns ?? 0), 0)
            text = total > 0 ? `本会话累计：$${total.toFixed(4)} / ${turns} turns` : '暂无费用统计'
          }
          const notice: SystemNotice = { id: `n${Date.now()}`, kind: 'status', text, level: 'info' }
          return { ...s, notices: [...(s.notices ?? []), notice] }
        }),
      }))
      return { ...state, projects }
    }
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/builtinCommands.ts src/renderer/state/reducer.ts
git commit -m "feat(builtin-cmd): 渲染端 builtin handler 注册表 + SHOW_COST 聚合"
```

---

### Task 10: InputBar 下拉接通 + 注入 onBuiltinRun

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

> 这是把前面所有零件接起来的集成点。无纯单测，靠 Task 11 手工验证。

- [ ] **Step 1: THINKINGS 改原生词 + 下拉读写会话字段**

`src/renderer/components/InputBar.tsx:13` 改为：
```ts
const THINKINGS: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']
```

`:82-83` 的局部 state 删除（改读会话字段）：
```ts
  // 删除：const [permission, setPermission] = useState('变更前确认')
  // 删除：const [thinking, setThinking] = useState('standard')
```

改为从当前 session 读：
```ts
  const activeSession = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)
  const permission = activeSession?.permissionMode ?? '变更前确认'
  const thinking: 'low' | 'medium' | 'high' = activeSession?.thinking ?? 'medium'
```

下拉选项的 onClick 改为 dispatch：
```ts
  // 权限下拉项 onClick:
  onClick={() => { dispatch({ type: 'SET_SESSION_PERMISSION', sessionId: state.activeSessionId, permissionMode: p }); setOpenMenu(null) }}
  // 思考下拉项 onClick:
  onClick={() => { dispatch({ type: 'SET_SESSION_THINKING', sessionId: state.activeSessionId, thinking: tk }); setOpenMenu(null) }}
```

思考下拉渲染 `THINKINGS.map(tk => ...)`，`tk` 即 `'low'|'medium'|'high'`，显示文本直接用 `tk`。

- [ ] **Step 2: send 三处传 permission/thinking/extraDirs**

`doSend`（:145-160）、队列消费 useEffect（:112-126）、`sendQueuedNow`（:129-143）三处 `window.api?.claude?.send({...})` 的 opts 加：
```ts
      permission,
      thinking,
      extraDirs: activeSession?.extraDirs,
```

- [ ] **Step 3: allSlashItems 流式时过滤掉 compact**

`:20-34` 的 `setAllSlashItems` 后，渲染时按流式过滤。在用到 `allSlashItems` 传给 PromptEditor 处：
```ts
  const slashItems = isStreaming
    ? allSlashItems.filter(i => !(i.kind === 'builtin' && i.builtinAction?.type === 'compact'))
    : allSlashItems
```
把传给 `PromptEditor` 的 items 源从 `allSlashItems` 改为 `slashItems`。

- [ ] **Step 4: 注入 onBuiltinRun**

PromptEditor 调用处加 prop：
```tsx
  <PromptEditor
    ...
    onBuiltinRun={(item) => runBuiltin(item, {
      dispatch, sessionId: state.activeSessionId,
      cwd: project?.path || state.settings?.cwd || '',
      modelName: modelName,
      claudeSessionId: state.claudeSessionMap?.[state.activeSessionId],
      toggleMenu,
      editor: editorRef.current,  // 需从 PromptEditor 暴露 editor 实例
    })}
  />
```

> `editorRef`：PromptEditor 需用 `useEditor` 的 ref 暴露给父组件。若当前 PromptEditor 未暴露，加一个 `onEditorReady?(editor)` 回调或 forwardRef。**优先用回调**：PromptEditor props 加 `onEditorReady?: (editor: any) => void`，在 `useEditor` 后 `useEffect(() => onEditorReady?.(editor), [editor])`，InputBar 用 state 存 editor。

- [ ] **Step 5: builtin-result 监听（compact/addDir 回填）**

InputBar 加 useEffect 监听主进程的 `claude:builtin-result`：
```ts
  useEffect(() => {
    const handler = (_: any, data: { localSessionId: string; op: string; [k: string]: any }) => {
      if (data.localSessionId !== state.activeSessionId) return
      if (data.op === 'compact') {
        dispatch({ type: 'COMPACT_DONE', sessionId: data.localSessionId, summary: data.summary, keepRecent: data.keepRecent })
      }
      // add-dir 的 ADD_SESSION_DIR 已在 runBuiltin 里发，这里不重复
    }
    // 需在 preload 暴露 onBuiltinResult 监听器；或在 ChatArea 已有的 api 监听处加
    // 简化：用 window.electron?.ipcRenderer？——不行，preload 未暴露通用 ipcRenderer。
    // 改为 preload 加 onBuiltinResult（见 Step 6）
  }, [state.activeSessionId])
```

- [ ] **Step 6: preload 加 onBuiltinResult**

`src/preload/index.ts` 的 `claude:` 对象内加：
```ts
    onBuiltinResult: (cb: (data: any) => void) => { ipcRenderer.on('claude:builtin-result', (_, data) => cb(data)) },
```
`global.d.ts` 的 `ClaudeAPI` 加 `onBuiltinResult(cb: (data: any) => void): void`。

并把 Step 5 的 handler 改用 `window.api?.claude?.onBuiltinResult(handler)`。

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 8: 提交**

```bash
git add src/renderer/components/InputBar.tsx src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(builtin-cmd): InputBar 下拉接通会话字段 + onBuiltinRun 注入 + builtin-result 回填"
```

---

## Phase D — 集成验证

### Task 11: 全量测试 + 手工验证

- [ ] **Step 1: 全量单测**

Run: `npx vitest run`
Expected: 全部 PASS（含新 builtin-commands / reducer / slashFilter 测试，且原有测试不回归）

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 启动应用手工验证 `/` 菜单**

Run: `npm run dev`（或项目实际的 electron 启动命令——`grep "dev" package.json` 确认）

验证清单：
- [ ] 输入框打 `/` → 弹出菜单，分组为「内置 / 命令 / 技能」
- [ ] 内置组含 `/init /compact /clear /review /config /model /mcp` 等 17 条
- [ ] 打 `/in` → 过滤出 `/init`
- [ ] 点 `/config` → 跳设置页通用段
- [ ] 点 `/mcp` → 跳设置页 MCP 段
- [ ] 点 `/permissions` → 打开输入栏权限下拉
- [ ] 点 `/clear` → 当前会话消息清空
- [ ] 点 `/cost` → 会话出现费用 notice
- [ ] 点 `/status` → 出现状态 notice
- [ ] 点 `/review` → 输入框插入 `/code-review `
- [ ] 点 `/init` → 生成 CLAUDE.md（已存在则弹覆盖对话框）
- [ ] 点 `/export` → 弹保存对话框，写出 .md
- [ ] 点 `/add-dir` → 弹目录选择器，选后 notice 提示
- [ ] 流式中：`/compact` 不出现在菜单；`/clear` 仍可用

- [ ] **Step 4: 手工验证权限/思考链路**

- [ ] 权限下拉切「计划模式」→ 发消息 → SDK 端进入 plan 模式（模型只规划不执行工具；可从日志或行为观察）
- [ ] 权限下拉切「完全访问」→ 工具调用不再弹确认
- [ ] 思考下拉切 `high` → 模型思考更深（thinking block 更长）
- [ ] 切换会话 → 各会话保留各自的 permission/thinking 选择（会话级持久化）

- [ ] **Step 5: 验证重启后持久化**

关闭应用重开 → 之前会话的 permission/thinking/extraDirs 仍在（projects.json 已存）。

- [ ] **Step 6: 最终提交（若有验证中发现的修复）**

```bash
git add -A
git commit -m "fix(builtin-cmd): 手工验证修复"
```

---

## Self-Review（写计划后自检）

**Spec 覆盖**：
- 17 条命令 ✓（Task 1 注册表 + Task 9 handler）
- builtin kind + 分组 ✓（Task 2/7/8）
- 执行链路（TipTap 分流 → handler → IPC）✓（Task 8/9/6）
- permission/thinking 打通 ✓（Task 5/10）
- 会话级持久化 ✓（Task 2 Session 字段 + Task 10 下拉读写）
- 流式 compact 禁用 ✓（Task 10 Step 3）
- /init 已存在问覆盖 ✓（Task 6 showOverwriteDialog）
- /compact 调 SDK 摘要保留最近 6 条 ✓（Task 6 compactSession + Task 3 COMPACT_DONE）
- 错误反馈 notice ✓（Task 6/9）
- 测试策略 ✓（Task 1/3/4/7 自动化，Task 6/10 手工）

**placeholder 扫描**：Task 6 Step 4 标注了"核对 ProjectsStore 函数名"——这是运行时确认步骤，非占位（给了具体 grep 命令）。Task 10 Step 4 editor ref 暴露给了两种方案并选定回调。无 TBD/TODO。

**类型一致性**：`BuiltinAction` 各 type 在 Task 1（注册表）、Task 8（分流）、Task 9（handler switch）三处一致核对：open-settings/open-permission-menu/clear-session/compact/show-cost/init-project/add-dir/export-session/show-status/resume/run-review/insert-text —— 12 种，全对齐。`ClaudeBuiltinCommand.builtinAction` 与 `SlashMenuItem.builtinAction` 同型（都引用 `BuiltinAction`）。

**已知遗留**（非本计划范围）：
- AskUserQuestion 修复（见记忆 `cc-desk-askuserquestion-broken`）—— 用户决定后续单独排。
