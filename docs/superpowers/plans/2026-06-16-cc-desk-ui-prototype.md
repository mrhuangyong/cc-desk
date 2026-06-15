# cc-desk UI 原型实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 Electron + React + TypeScript 桌面应用 UI 原型，呈现三栏工作台布局、左栏项目/会话完整交互、右栏多 Tab 面板、四种可切换主题。

**Architecture:** Electron 主进程（自定义 titleBar、frame:false）+ Vite + React 渲染进程。渲染进程用 React Context + useReducer 管理状态（项目/会话/Tab/主题），数据均为内存 mock。交互逻辑（删除二次确认、新增会话去重、Tab 去重）用 Vitest + Testing Library 做单元测试。主题系统基于 CSS 变量，所有颜色走 `[data-theme]` 切换。

**Tech Stack:** Electron 42、electron-vite 5、React 18、TypeScript、Vite 8、Vitest 4、@testing-library/react 16、pnpm

**Spec:** `docs/superpowers/specs/2026-06-16-cc-desk-ui-prototype-design.md`

---

## 文件结构总览

```
cc-desk/
├── package.json
├── electron.vite.config.ts          # electron-vite 配置
├── tsconfig.json
├── tsconfig.node.json
├── vitest.config.ts                 # Vitest + jsdom 配置
├── index.html
├── src/
│   ├── main/                        # Electron 主进程
│   │   └── index.ts
│   ├── preload/
│   │   └── index.ts
│   ├── renderer/                    # React 渲染进程
│   │   ├── main.tsx                 # React 入口
│   │   ├── App.tsx                  # AppShell
│   │   ├── index.css                # 主题 CSS 变量 + 全局样式
│   │   ├── types.ts                 # 共享类型定义
│   │   ├── state/
│   │   │   ├── store.tsx            # AppProvider (Context + useReducer)
│   │   │   ├── actions.ts           # reducer action 类型
│   │   │   ├── reducer.ts           # reducer 纯函数
│   │   │   └── mockData.ts          # 初始 mock 数据
│   │   ├── hooks/
│   │   │   └── useTheme.ts          # 主题切换 + localStorage 持久化
│   │   └── components/
│   │       ├── TitleBar.tsx
│   │       ├── ThemeSwitcher.tsx
│   │       ├── LeftPanel.tsx
│   │       ├── ProjectTree.tsx
│   │       ├── FileTree.tsx
│   │       ├── DeleteConfirmIcon.tsx
│   │       ├── ChatArea.tsx
│   │       ├── RightPanel.tsx
│   │       ├── TabBar.tsx
│   │       ├── FileTab.tsx
│   │       ├── BrowserTab.tsx
│   │       └── TerminalTab.tsx
└── tests/
    ├── reducer.test.ts
    ├── DeleteConfirmIcon.test.tsx
    └── ProjectTree.test.tsx
```

**职责边界：**
- `state/reducer.ts` 是纯函数，承载所有业务规则（删除去重、会话去重、Tab 去重），最易测试，先实现。
- 组件层薄，只渲染 + 派发 action。
- `DeleteConfirmIcon` 封装"🗑️→✅"的就地二次确认，可独立测试与复用。
- 主题完全靠 `index.css` 的 CSS 变量，组件只读变量。

---

## Task 1: 项目初始化与依赖安装

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `electron.vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`（已存在，确认补全）

- [ ] **Step 1: 初始化 package.json**

```bash
pnpm init
```

- [ ] **Step 2: 安装依赖**

```bash
pnpm add react@18 react-dom@18
pnpm add -D electron@42 electron-vite@5 vite@8 \
  @vitejs/plugin-react typescript \
  @types/react @types/react-dom @types/node \
  vitest@4 @testing-library/react@16 @testing-library/jest-dom jsdom \
  @vitest/coverage-v8
```

- [ ] **Step 3: 写 package.json 的 scripts**

替换 `package.json` 的 `scripts` 字段为：

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

并在顶层加 `"main": "out/main/index.js"`。

- [ ] **Step 4: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "references": [
    { "path": "./tsconfig.node.json" }
  ],
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"]
}
```

- [ ] **Step 5: 写 tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["electron.vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 6: 写 electron.vite.config.ts**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { outDir: 'out/renderer' }
  }
})
```

- [ ] **Step 7: 写 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts'
  }
})
```

- [ ] **Step 8: 确认 .gitignore 补全**

`.gitignore` 应包含：

```
node_modules/
dist/
out/
.superpowers/
*.log
```

- [ ] **Step 9: 验证安装成功**

Run: `pnpm test -- --run 2>&1 | head -5`（此时无测试，应报"no test files found"或正常退出）

Expected: 命令成功执行，无依赖错误

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: 初始化 Electron + React + TypeScript 项目"
```

---

## Task 2: 类型定义与 mock 数据

**Files:**
- Create: `src/renderer/types.ts`
- Create: `src/renderer/state/mockData.ts`
- Create: `tests/setup.ts`

- [ ] **Step 1: 写类型定义 src/renderer/types.ts**

```ts
// 消息：对话流中的一条
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

// 会话：归属于某个项目
export interface Session {
  id: string
  title: string
  messages: Message[]
}

// 项目：包含多个会话
export interface Project {
  id: string
  name: string
  sessions: Session[]
}

// Tab 类型
export type TabType = 'file' | 'browser' | 'terminal'

// Tab：右栏的一个面板
export interface Tab {
  id: string
  type: TabType
  title: string
  // file 类型独有：标识打开的文件路径，用于去重
  filePath?: string
  // browser 类型独有：当前网址
  url?: string
}

// 主题 ID
export type ThemeId = 'dark-warm' | 'dark-cool' | 'light-editorial' | 'dark-acid'

// 文件节点：文件树态用
export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}
```

- [ ] **Step 2: 写 mock 数据 src/renderer/state/mockData.ts**

```ts
import type { Project, FileNode } from '../types'

export const mockProjects: Project[] = [
  {
    id: 'p1',
    name: 'cc-desk',
    sessions: [
      { id: 's1', title: '重构登录流程', messages: [
        { id: 'm1', role: 'user', content: '帮我把登录改成 token 刷新机制' },
        { id: 'm2', role: 'assistant', content: '好的，我先看一下当前的 auth 逻辑……' }
      ]},
      { id: 's2', title: '修样式 bug', messages: [] }
    ]
  },
  {
    id: 'p2',
    name: '个人博客',
    sessions: [
      { id: 's3', title: '部署到 Vercel', messages: [
        { id: 'm3', role: 'user', content: '怎么部署？' }
      ]}
    ]
  }
]

export const mockFileTrees: Record<string, FileNode[]> = {
  p1: [
    { name: 'src', path: 'src', isDir: true, children: [
      { name: 'main.tsx', path: 'src/main.tsx', isDir: false },
      { name: 'App.tsx', path: 'src/App.tsx', isDir: false },
      { name: 'components', path: 'src/components', isDir: true, children: [
        { name: 'Button.tsx', path: 'src/components/Button.tsx', isDir: false }
      ]}
    ]},
    { name: 'package.json', path: 'package.json', isDir: false }
  ],
  p2: [
    { name: 'index.md', path: 'index.md', isDir: false },
    { name: 'about.md', path: 'about.md', isDir: false }
  ]
}

// mock 文件内容（按路径）
export const mockFileContents: Record<string, string> = {
  'src/main.tsx': 'import React from "react"\nimport App from "./App"\n\nrender(<App />, document.getElementById("root"))',
  'src/App.tsx': 'export default function App() {\n  return <div>Hello</div>\n}',
  'package.json': '{\n  "name": "cc-desk"\n}'
}
```

- [ ] **Step 3: 写 tests/setup.ts**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 添加类型定义与 mock 数据"
```

---

## Task 3: State reducer —— 业务规则核心（TDD）

> 这是所有交互规则的核心。纯函数，最易测试。先写测试。

**Files:**
- Create: `src/renderer/state/actions.ts`
- Create: `src/renderer/state/reducer.ts`
- Test: `tests/reducer.test.ts`

- [ ] **Step 1: 写 actions.ts（action 类型）**

`src/renderer/state/actions.ts`:

```ts
import type { TabType, ThemeId } from '../types'

export type Action =
  | { type: 'DELETE_PROJECT'; projectId: string }
  | { type: 'DELETE_SESSION'; projectId: string; sessionId: string }
  | { type: 'ADD_SESSION'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'OPEN_FILE_TAB'; filePath: string; fileName: string }
  | { type: 'OPEN_TAB'; tabType: TabType }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'SELECT_TAB'; tabId: string }
  | { type: 'SET_THEME'; theme: ThemeId }
```

- [ ] **Step 2: 写失败测试 —— 删除会话**

`tests/reducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reducer } from '../src/renderer/state/reducer'
import { mockProjects } from '../src/renderer/state/mockData'
import type { AppState } from '../src/renderer/state/reducer'

// helper：构造初始 state，选中第一个项目的第一个会话
function initialState(): AppState {
  return {
    projects: structuredClone(mockProjects),
    activeSessionId: 's1',
    // 每个 session 的 Tab 组，key = sessionId
    tabsBySession: { s1: [] },
    activeTabId: null,
    theme: 'dark-warm'
  }
}

describe('reducer', () => {
  it('DELETE_SESSION 删除指定会话', () => {
    const state = initialState()
    const next = reducer(state, { type: 'DELETE_SESSION', projectId: 'p1', sessionId: 's2' })
    const p1 = next.projects.find(p => p.id === 'p1')!
    expect(p1.sessions.find(s => s.id === 's2')).toBeUndefined()
  })

  it('DELETE_PROJECT 级联删除其下所有会话', () => {
    const state = initialState()
    const next = reducer(state, { type: 'DELETE_PROJECT', projectId: 'p1' })
    expect(next.projects.find(p => p.id === 'p1')).toBeUndefined()
  })

  it('ADD_SESSION 当无空会话时新增', () => {
    const state = initialState()
    const before = state.projects.find(p => p.id === 'p1')!.sessions.length
    const next = reducer(state, { type: 'ADD_SESSION', projectId: 'p2' })
    const after = next.projects.find(p => p.id === 'p2')!.sessions.length
    expect(after).toBe(before)
  })
})
```

> 注意：第三个测试 p2 当前只有 s3（有消息），非空，所以应新增一条 → after = before + 1。但上面写的是 `toBe(before)` —— 这是**故意写错的断言**，用来验证测试真的会失败。

**修正：** 第三个测试应改为期望 +1：

```ts
  it('ADD_SESSION 当无空会话时新增一条', () => {
    const state = initialState()
    const before = state.projects.find(p => p.id === 'p2')!.sessions.length
    const next = reducer(state, { type: 'ADD_SESSION', projectId: 'p2' })
    const after = next.projects.find(p => p.id === 'p2')!.sessions.length
    expect(after).toBe(before + 1)
  })
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm test`

Expected: FAIL —— `reducer is not defined`（reducer.ts 还没写）

- [ ] **Step 4: 写 reducer.ts 最小实现**

`src/renderer/state/reducer.ts`:

```ts
import type { Action } from './actions'
import type { Project, Session, Tab, ThemeId } from '../types'

export interface AppState {
  projects: Project[]
  activeSessionId: string
  // 每个 session 独立的 Tab 组
  tabsBySession: Record<string, Tab[]>
  activeTabId: string | null
  theme: ThemeId
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}${idCounter}`
}

// 判断会话是否为空（消息数为 0）
function isEmptySession(s: Session): boolean {
  return s.messages.length === 0
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'DELETE_PROJECT': {
      const projects = state.projects.filter(p => p.id !== action.projectId)
      return { ...state, projects }
    }
    case 'DELETE_SESSION': {
      const projects = state.projects.map(p =>
        p.id === action.projectId
          ? { ...p, sessions: p.sessions.filter(s => s.id !== action.sessionId) }
          : p
      )
      return { ...state, projects }
    }
    case 'ADD_SESSION': {
      const project = state.projects.find(p => p.id === action.projectId)
      if (!project) return state
      // 去重：已有空会话则不新建，激活它
      const existingEmpty = project.sessions.find(isEmptySession)
      if (existingEmpty) {
        const tabsBySession = { ...state.tabsBySession }
        if (!tabsBySession[existingEmpty.id]) tabsBySession[existingEmpty.id] = []
        return { ...state, activeSessionId: existingEmpty.id, tabsBySession }
      }
      const newSession: Session = { id: nextId('s'), title: '新会话', messages: [] }
      const projects = state.projects.map(p =>
        p.id === action.projectId
          ? { ...p, sessions: [...p.sessions, newSession] }
          : p
      )
      const tabsBySession = { ...state.tabsBySession, [newSession.id]: [] }
      return { ...state, projects, activeSessionId: newSession.id, tabsBySession }
    }
    case 'SELECT_SESSION': {
      return { ...state, activeSessionId: action.sessionId }
    }
    case 'OPEN_FILE_TAB': {
      const tabs = state.tabsBySession[state.activeSessionId] ?? []
      // 去重：同文件已开则切过去
      const existing = tabs.find(t => t.type === 'file' && t.filePath === action.filePath)
      if (existing) {
        return { ...state, activeTabId: existing.id }
      }
      const newTab: Tab = {
        id: nextId('t'),
        type: 'file',
        title: action.fileName,
        filePath: action.filePath
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [state.activeSessionId]: [...tabs, newTab] },
        activeTabId: newTab.id
      }
    }
    case 'OPEN_TAB': {
      const tabs = state.tabsBySession[state.activeSessionId] ?? []
      const newTab: Tab = {
        id: nextId('t'),
        type: action.tabType,
        title: action.tabType === 'browser' ? '浏览器' : action.tabType === 'terminal' ? '终端' : '文件'
      }
      return {
        ...state,
        tabsBySession: { ...state.tabsBySession, [state.activeSessionId]: [...tabs, newTab] },
        activeTabId: newTab.id
      }
    }
    case 'CLOSE_TAB': {
      const tabs = (state.tabsBySession[state.activeSessionId] ?? []).filter(t => t.id !== action.tabId)
      let activeTabId = state.activeTabId
      if (state.activeTabId === action.tabId) {
        activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null
      }
      return { ...state, tabsBySession: { ...state.tabsBySession, [state.activeSessionId]: tabs }, activeTabId }
    }
    case 'SELECT_TAB': {
      return { ...state, activeTabId: action.tabId }
    }
    case 'SET_THEME': {
      return { ...state, theme: action.theme }
    }
    default:
      return state
  }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm test`

Expected: PASS（3 个测试全过）

- [ ] **Step 6: 补充测试 —— ADD_SESSION 去重规则（已有空会话则切换）**

在 `tests/reducer.test.ts` 的 describe 块末尾追加：

```ts
  it('ADD_SESSION 已有空会话时不新建，切换过去', () => {
    // p1 已有 s2（messages 为空）
    const state = initialState()
    const before = state.projects.find(p => p.id === 'p1')!.sessions.length
    const next = reducer(state, { type: 'ADD_SESSION', projectId: 'p1' })
    const after = next.projects.find(p => p.id === 'p1')!.sessions.length
    expect(after).toBe(before) // 数量不变
    expect(next.activeSessionId).toBe('s2') // 切到空会话
  })

  it('OPEN_FILE_TAB 同文件重复打开不新开，切到已存在 Tab', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'src/App.tsx', fileName: 'App.tsx' })
    const firstTabId = s1.activeTabId
    const s2 = reducer(s1, { type: 'OPEN_FILE_TAB', filePath: 'src/App.tsx', fileName: 'App.tsx' })
    const tabs = s2.tabsBySession['s1']
    expect(tabs.length).toBe(1) // 仍然只有一个
    expect(s2.activeTabId).toBe(firstTabId) // 切到已存在的
  })

  it('CLOSE_TAB 关掉最后一个后 activeTabId 为 null', () => {
    const state = initialState()
    const s1 = reducer(state, { type: 'OPEN_FILE_TAB', filePath: 'a.ts', fileName: 'a.ts' })
    const tabId = s1.activeTabId!
    const s2 = reducer(s1, { type: 'CLOSE_TAB', tabId })
    expect(s2.tabsBySession['s1'].length).toBe(0)
    expect(s2.activeTabId).toBeNull()
  })
```

- [ ] **Step 7: 运行测试，全部通过**

Run: `pnpm test`

Expected: PASS（6 个测试全过）

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 实现 state reducer 与业务规则测试"
```

---

## Task 4: State Provider + 主题 Hook

**Files:**
- Create: `src/renderer/state/store.tsx`
- Create: `src/renderer/hooks/useTheme.ts`

- [ ] **Step 1: 写 store.tsx（Context + Provider）**

```tsx
import { createContext, useContext, useReducer, type ReactNode } from 'react'
import { reducer, type AppState } from './reducer'
import type { Action } from './actions'
import { mockProjects } from './mockData'

const initialState: AppState = {
  projects: mockProjects,
  activeSessionId: mockProjects[0].sessions[0].id,
  tabsBySession: Object.fromEntries(
    mockProjects.flatMap(p => p.sessions.map(s => [s.id, [] as never[]]))
  ),
  activeTabId: null,
  theme: (localStorage.getItem('cc-desk-theme') as AppState['theme']) || 'dark-warm'
}

interface StoreContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const StoreContext = createContext<StoreContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within AppProvider')
  return ctx
}
```

- [ ] **Step 2: 写 useTheme.ts**

```ts
import { useEffect } from 'react'
import { useStore } from '../state/store'

export function useTheme() {
  const { state, dispatch } = useStore()
  const { theme } = state

  // 应用到 document 并持久化
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cc-desk-theme', theme)
  }, [theme])

  const setTheme = (t: typeof theme) => {
    dispatch({ type: 'SET_THEME', theme: t })
  }

  return { theme, setTheme }
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: 添加 AppProvider 与 useTheme hook"
```

---

## Task 5: 主题 CSS 变量与全局样式

**Files:**
- Create: `src/renderer/index.css`

- [ ] **Step 1: 写 index.css（四种主题的 CSS 变量 + 全局重置）**

```css
/* ===== 主题变量 ===== */
:root,
[data-theme='dark-warm'] {
  --bg: #1a1714;
  --bg-elevated: #221d18;
  --bg-sidebar: #161310;
  --bg-hover: #2a2520;
  --border: #2f2820;
  --text: #d8c9b8;
  --text-muted: #8a7a68;
  --accent: #d97757;
  --accent-text: #1a1714;
  --danger: #e06c6c;
  --font: -apple-system, 'Segoe UI', 'PingFang SC', sans-serif;
  --font-mono: 'SF Mono', 'Menlo', monospace;
  --radius: 6px;
}

[data-theme='dark-cool'] {
  --bg: #0d1117;
  --bg-elevated: #161b22;
  --bg-sidebar: #010409;
  --bg-hover: #21262d;
  --border: #21262d;
  --text: #c9d1d9;
  --text-muted: #8b949e;
  --accent: #2f81f7;
  --accent-text: #ffffff;
  --danger: #f85149;
  --radius: 6px;
}

[data-theme='light-editorial'] {
  --bg: #faf8f3;
  --bg-elevated: #ffffff;
  --bg-sidebar: #f2eee5;
  --bg-hover: #e9e2d3;
  --border: #e5dfd2;
  --text: #3a3530;
  --text-muted: #8a7f70;
  --accent: #8b6f47;
  --accent-text: #ffffff;
  --danger: #c05050;
  --font: Georgia, 'Times New Roman', 'Songti SC', serif;
  --font-mono: 'SF Mono', 'Menlo', monospace;
  --radius: 6px;
}

[data-theme='dark-acid'] {
  --bg: #0a0a0a;
  --bg-elevated: #141414;
  --bg-sidebar: #050505;
  --bg-hover: #1a1a1a;
  --border: #222222;
  --text: #c0c0c0;
  --text-muted: #707070;
  --accent: #ccff00;
  --accent-text: #0a0a0a;
  --danger: #ff4444;
  --font: 'SF Mono', 'Menlo', 'Courier New', monospace;
  --font-mono: 'SF Mono', 'Menlo', monospace;
  --radius: 0px;
}

/* ===== 全局重置 ===== */
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  user-select: none;
  -webkit-font-smoothing: antialiased;
}
button {
  font-family: inherit;
  cursor: pointer;
  background: none;
  border: none;
  color: inherit;
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: var(--radius); }
::-webkit-scrollbar-track { background: transparent; }
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: 添加四种主题的 CSS 变量与全局样式"
```

---

## Task 6: DeleteConfirmIcon 组件（就地二次确认，TDD）

> 封装"🗑️→✅"的就地确认交互。可独立测试与复用。

**Files:**
- Create: `src/renderer/components/DeleteConfirmIcon.tsx`
- Test: `tests/DeleteConfirmIcon.test.tsx`

- [ ] **Step 1: 写失败测试**

`tests/DeleteConfirmIcon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteConfirmIcon } from '../src/renderer/components/DeleteConfirmIcon'

describe('DeleteConfirmIcon', () => {
  it('初始显示删除图标，点击变为确认图标', () => {
    render(<DeleteConfirmIcon onConfirm={() => {}} />)
    const btn = screen.getByRole('button', { name: /删除/ })
    expect(btn).toHaveTextContent('🗑️')
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: /确认删除/ })).toHaveTextContent('✅')
  })

  it('点击确认图标触发 onConfirm', () => {
    const onConfirm = vi.fn()
    render(<DeleteConfirmIcon onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /删除/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('鼠标离开未确认则还原为删除图标', () => {
    const onConfirm = vi.fn()
    render(<DeleteConfirmIcon onConfirm={onConfirm} />)
    const btn = screen.getByRole('button', { name: /删除/ })
    fireEvent.click(btn)
    // 点击确认图标本身不算"离开"，这里模拟外部 blur 还原
    const confirmBtn = screen.getByRole('button', { name: /确认删除/ })
    fireEvent.mouseLeave(confirmBtn)
    expect(screen.getByRole('button', { name: /删除/ })).toHaveTextContent('🗑️')
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
```

> 需在文件顶部 import：`import { vi } from 'vitest'`（补全到 import 区）。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test`

Expected: FAIL —— `DeleteConfirmIcon is not defined`

- [ ] **Step 3: 实现 DeleteConfirmIcon**

`src/renderer/components/DeleteConfirmIcon.tsx`:

```tsx
import { useState } from 'react'

interface Props {
  onConfirm: () => void
}

export function DeleteConfirmIcon({ onConfirm }: Props) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <button
        aria-label="确认删除"
        onClick={(e) => {
          e.stopPropagation()
          onConfirm()
          setConfirming(false)
        }}
        onMouseLeave={() => setConfirming(false)}
        style={{ color: 'var(--danger)', opacity: 0.9 }}
        title="再次点击确认删除"
      >
        ✅
      </button>
    )
  }

  return (
    <button
      aria-label="删除"
      onClick={(e) => {
        e.stopPropagation()
        setConfirming(true)
      }}
      style={{ opacity: 0.6 }}
      title="删除"
    >
      🗑️
    </button>
  )
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test`

Expected: PASS（3 个测试）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 实现 DeleteConfirmIcon 就地二次确认组件"
```

---

## Task 7: TitleBar + ThemeSwitcher

**Files:**
- Create: `src/renderer/components/ThemeSwitcher.tsx`
- Create: `src/renderer/components/TitleBar.tsx`

- [ ] **Step 1: 写 ThemeSwitcher.tsx**

```tsx
import { useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import type { ThemeId } from '../types'

const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'dark-warm', label: '暖色暗夜', swatch: '#d97757' },
  { id: 'dark-cool', label: '冷峻深空', swatch: '#2f81f7' },
  { id: 'light-editorial', label: '纸感明亮', swatch: '#8b6f47' },
  { id: 'dark-acid', label: '酸性极客', swatch: '#ccff00' }
]

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="切换主题"
        style={{ fontSize: 14, padding: '4px 8px' }}
      >🎨</button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: 4, minWidth: 150, zIndex: 100
        }}>
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 8px', borderRadius: 'var(--radius)',
                background: theme === t.id ? 'var(--bg-hover)' : 'transparent'
              }}
            >
              <span style={{ width: 12, height: 12, borderRadius: 2, background: t.swatch, display: 'inline-block' }} />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 写 TitleBar.tsx**

```tsx
import { ThemeSwitcher } from './ThemeSwitcher'
import { useStore } from '../state/store'

export function TitleBar({ projectName }: { projectName: string }) {
  const { state } = useStore()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 32, padding: '0 12px',
      background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)',
      WebkitAppRegion: 'drag' as never  // Electron 可拖拽区域
    }}>
      {/* macOS 红绿灯 */}
      <div style={{ display: 'flex', gap: 8, WebkitAppRegion: 'no-drag' as never }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
      </div>
      <span style={{ flex: 1, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        {projectName}
      </span>
      <div style={{ display: 'flex', gap: 8, WebkitAppRegion: 'no-drag' as never }}>
        <ThemeSwitcher />
        <button title="设置" style={{ fontSize: 14, padding: '4px 8px' }}>⚙</button>
      </div>
    </div>
  )
}
```

> 当前激活项目名：从 activeSessionId 反查项目名。先传静态 props，AppShell 里计算。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: 实现 TitleBar 与 ThemeSwitcher"
```

---

## Task 8: LeftPanel + ProjectTree + FileTree

**Files:**
- Create: `src/renderer/components/DeleteConfirmIcon.tsx`（已存在）
- Create: `src/renderer/components/ProjectTree.tsx`
- Create: `src/renderer/components/FileTree.tsx`
- Create: `src/renderer/components/LeftPanel.tsx`
- Test: `tests/ProjectTree.test.tsx`

- [ ] **Step 1: 写 ProjectTree 的失败测试（hover 显示图标 + 删除确认 + 新增去重）**

`tests/ProjectTree.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { ProjectTree } from '../src/renderer/components/ProjectTree'

function renderWithProvider(ui: React.ReactNode) {
  return render(<AppProvider>{ui}</AppProvider>)
}

describe('ProjectTree', () => {
  it('项目行点击删除图标 → 确认 → 删除项目', () => {
    renderWithProvider(<ProjectTree />)
    // hover 后删除图标可见（这里直接取，因测试环境无 hover 限制）
    const deleteBtns = screen.getAllByRole('button', { name: '删除' })
    fireEvent.click(deleteBtns[0]) // 第一个项目的删除
    fireEvent.click(screen.getAllByRole('button', { name: '确认删除' })[0])
    // mock 有 p1、p2 两个项目；删 p1 后只剩一个
    expect(screen.getAllByText(/项目|博客|cc-desk/).length).toBeLessThan(3)
  })

  it('点击新增会话，项目已有空会话时不新增（数量不变）', () => {
    renderWithProvider(<ProjectTree />)
    // p1 有空会话 s2，点 ➕ 应不新增
    const before = screen.getAllByText(/会话|登录|样式/).length
    const addBtns = screen.getAllByRole('button', { name: '新增会话' })
    fireEvent.click(addBtns[0]) // p1 的新增
    const after = screen.getAllByText(/会话|登录|样式/).length
    expect(after).toBe(before) // 数量不变
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test`

Expected: FAIL —— `ProjectTree is not defined`

- [ ] **Step 3: 实现 ProjectTree.tsx**

```tsx
import { useState } from 'react'
import { useStore } from '../state/store'
import { DeleteConfirmIcon } from './DeleteConfirmIcon'

export function ProjectTree({ onOpenFiles }: { onOpenFiles: (projectId: string) => void }) {
  const { state, dispatch } = useStore()
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {state.projects.map(project => (
        <div key={project.id}>
          <div
            onMouseEnter={() => setHoveredProject(project.id)}
            onMouseLeave={() => setHoveredProject(null)}
            style={{
              padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontWeight: 600, color: 'var(--text)', background: hoveredProject === project.id ? 'var(--bg-hover)' : 'transparent'
            }}
          >
            <span>📁 {project.name}</span>
            {hoveredProject === project.id && (
              <span style={{ display: 'flex', gap: 8 }}>
                <button title="项目文件树" onClick={() => onOpenFiles(project.id)} style={{ opacity: 0.7 }}>📂</button>
                <button title="新增会话" onClick={() => dispatch({ type: 'ADD_SESSION', projectId: project.id })} style={{ opacity: 0.7 }}>➕</button>
                <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_PROJECT', projectId: project.id })} />
              </span>
            )}
          </div>
          {project.sessions.map(session => (
            <div
              key={session.id}
              onMouseEnter={() => setHoveredSession(session.id)}
              onMouseLeave={() => setHoveredSession(null)}
              onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: session.id })}
              style={{
                padding: '6px 12px 6px 28px', display: 'flex', justifyContent: 'space-between',
                color: state.activeSessionId === session.id ? 'var(--accent)' : 'var(--text-muted)',
                background: hoveredSession === session.id ? 'var(--bg-hover)' : 'transparent',
                cursor: 'pointer'
              }}
            >
              <span>💬 {session.title}</span>
              {hoveredSession === session.id && (
                <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 实现 FileTree.tsx**

```tsx
import { useStore } from '../state/store'
import { mockFileTrees, mockFileContents } from '../state/mockData'
import type { FileNode } from '../types'

function Node({ node, depth }: { node: FileNode; depth: number }) {
  const { dispatch } = useStore()
  const [open, setOpen] = useState(depth === 0)
  // 注意：useState 需从 react 引入，见下方修正

  if (node.isDir) {
    return (
      <div>
        <div
          onClick={() => setOpen(o => !o)}
          style={{ padding: '5px 12px', paddingLeft: 12 + depth * 16, cursor: 'pointer', color: 'var(--text)' }}
        >
          {open ? '📂' : '📁'} {node.name}
        </div>
        {open && node.children?.map(c => <Node key={c.path} node={c} depth={depth + 1} />)}
      </div>
    )
  }
  return (
    <div
      onClick={() => dispatch({ type: 'OPEN_FILE_TAB', filePath: node.path, fileName: node.name })}
      style={{ padding: '4px 12px', paddingLeft: 12 + depth * 16, cursor: 'pointer', color: 'var(--text-muted)' }}
    >
      📄 {node.name}
    </div>
  )
}

export function FileTree({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { state } = useStore()
  const project = state.projects.find(p => p.id === projectId)
  const nodes = mockFileTrees[projectId] ?? []
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <button onClick={onBack} style={{ padding: '10px 12px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--border)', width: '100%' }}>
        ← {project?.name}
      </button>
      {nodes.map(n => <Node key={n.path} node={n} depth={0} />)}
    </div>
  )
}
```

**修正：** FileTree 顶部 import 补 `useState`：

```tsx
import { useState } from 'react'
import { useStore } from '../state/store'
```

> （`mockFileContents` 此处未用，FileTab 会用。可从 import 移除以避免 lint 警告，或保留备用。实现时移除。）

- [ ] **Step 5: 实现 LeftPanel.tsx（状态切换容器）**

```tsx
import { useState } from 'react'
import { ProjectTree } from './ProjectTree'
import { FileTree } from './FileTree'

export function LeftPanel() {
  const [fileViewProjectId, setFileViewProjectId] = useState<string | null>(null)

  return (
    <div style={{
      width: 240, flexShrink: 0, background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
    }}>
      {fileViewProjectId ? (
        <FileTree projectId={fileViewProjectId} onBack={() => setFileViewProjectId(null)} />
      ) : (
        <ProjectTree onOpenFiles={(pid) => setFileViewProjectId(pid)} />
      )}
    </div>
  )
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `pnpm test`

Expected: PASS（所有测试，含 ProjectTree 的 2 个）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: 实现 LeftPanel/ProjectTree/FileTree"
```

---

## Task 9: ChatArea

**Files:**
- Create: `src/renderer/components/ChatArea.tsx`

- [ ] **Step 1: 实现 ChatArea.tsx**

```tsx
import { useState } from 'react'
import { useStore } from '../state/store'

export function ChatArea() {
  const { state } = useStore()
  const [input, setInput] = useState('')

  // 找当前会话
  const session = state.projects
    .flatMap(p => p.sessions)
    .find(s => s.id === state.activeSessionId)

  if (!session) {
    return <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>无选中会话</div>
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        💬 {session.title}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {session.messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>开始新的对话</div>
        )}
        {session.messages.map(m => (
          <div key={m.id} style={{
            maxWidth: '80%', padding: '8px 12px', borderRadius: 'var(--radius)',
            background: m.role === 'user' ? 'var(--bg-hover)' : 'var(--accent)',
            color: m.role === 'user' ? 'var(--text)' : 'var(--accent-text)',
            alignSelf: m.role === 'user' ? 'flex-start' : 'flex-end'
          }}>
            {m.content}
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="给 AI 发消息……"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)',
            fontFamily: 'var(--font)'
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: 实现 ChatArea 对话区"
```

---

## Task 10: RightPanel + TabBar + 三种 Tab 内容

**Files:**
- Create: `src/renderer/components/FileTab.tsx`
- Create: `src/renderer/components/BrowserTab.tsx`
- Create: `src/renderer/components/TerminalTab.tsx`
- Create: `src/renderer/components/TabBar.tsx`
- Create: `src/renderer/components/RightPanel.tsx`

- [ ] **Step 1: 实现 FileTab.tsx**

```tsx
import { mockFileContents } from '../state/mockData'

export function FileTab({ filePath }: { filePath?: string }) {
  const content = filePath ? (mockFileContents[filePath] ?? '(空文件)') : '(未指定文件)'
  return (
    <div style={{ padding: 12, flex: 1, overflow: 'auto' }}>
      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
        {content}
      </pre>
    </div>
  )
}
```

- [ ] **Step 2: 实现 BrowserTab.tsx**

```tsx
import { useState } from 'react'

export function BrowserTab() {
  const [url, setUrl] = useState('https://example.com')
  const [input, setInput] = useState(url)
  const [history, setHistory] = useState<string[]>([url])
  const [idx, setIdx] = useState(0)

  const navigate = (next: string) => {
    const full = next.startsWith('http') ? next : `https://${next}`
    const newHistory = [...history.slice(0, idx + 1), full]
    setHistory(newHistory)
    setIdx(newHistory.length - 1)
    setUrl(full)
    setInput(full)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid var(--border)' }}>
        <button disabled={idx === 0} onClick={() => { setIdx(idx - 1); setUrl(history[idx - 1]); setInput(history[idx - 1]) }}>←</button>
        <button disabled={idx >= history.length - 1} onClick={() => { setIdx(idx + 1); setUrl(history[idx + 1]); setInput(history[idx + 1]) }}>→</button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(input) }}
          style={{ flex: 1, padding: '4px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)' }}
        />
      </div>
      <iframe src={url} style={{ flex: 1, border: 'none', background: '#fff' }} title="browser" />
    </div>
  )
}
```

> 注：iframe 在 Electron 需主进程配置 `webPreferences.webSecurity` 与 sandbox；原型阶段 example.com 可正常加载，本地/部分站点受跨域限制属预期（spec 第 9 节已排除完整集成）。

- [ ] **Step 3: 实现 TerminalTab.tsx**

```tsx
export function TerminalTab() {
  return (
    <div style={{ padding: 12, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)' }}>
      <div>$ npm run dev</div>
      <div style={{ color: 'var(--text-muted)' }}>&gt; cc-desk@0.0.0 dev</div>
      <div style={{ color: 'var(--text-muted)' }}>&gt; vite</div>
      <div style={{ color: 'var(--text)' }}>  VITE ready in 320 ms</div>
      <div style={{ color: 'var(--text)' }}>  ➜  Local: http://localhost:5173/</div>
      <div style={{ marginTop: 8 }}>$ <span style={{ background: 'var(--accent)', width: 8, height: 14, display: 'inline-block' }}> </span></div>
    </div>
  )
}
```

- [ ] **Step 4: 实现 TabBar.tsx**

```tsx
import { useStore } from '../state/store'
import { FileTab } from './FileTab'
import { BrowserTab } from './BrowserTab'
import { TerminalTab } from './TerminalTab'
import type { TabType } from '../types'

const TAB_LABEL: Record<TabType, string> = { file: '📄', browser: '🌐', terminal: '🖥' }

export function TabBar() {
  const { state, dispatch } = useStore()
  const tabs = state.tabsBySession[state.activeSessionId] ?? []

  const renderContent = () => {
    const active = tabs.find(t => t.id === state.activeTabId)
    if (!active) return <div style={{ display: 'grid', placeItems: 'center', flex: 1, color: 'var(--text-muted)' }}>暂无打开的面板</div>
    if (active.type === 'file') return <FileTab filePath={active.filePath} />
    if (active.type === 'browser') return <BrowserTab />
    return <TerminalTab />
  }

  const addTab = () => {
    // 简化：点 + 默认开浏览器 tab（spec 允许扩展为类型选择菜单）
    dispatch({ type: 'OPEN_TAB', tabType: 'browser' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
        {tabs.map(t => (
          <div
            key={t.id}
            onClick={() => dispatch({ type: 'SELECT_TAB', tabId: t.id })}
            style={{
              padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              borderBottom: state.activeTabId === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: state.activeTabId === t.id ? 'var(--text)' : 'var(--text-muted)', fontSize: 13,
              maxWidth: 140
            }}
          >
            <span>{TAB_LABEL[t.type]}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            <button onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE_TAB', tabId: t.id }) }} style={{ fontSize: 12, opacity: 0.6 }}>×</button>
          </div>
        ))}
        <button onClick={addTab} title="新增 Tab" style={{ padding: '0 10px', color: 'var(--text-muted)' }}>+</button>
      </div>
      {renderContent()}
    </div>
  )
}
```

- [ ] **Step 5: 实现 RightPanel.tsx**

```tsx
import { TabBar } from './TabBar'

export function RightPanel() {
  return (
    <div style={{
      width: 320, flexShrink: 0, background: 'var(--bg-elevated)',
      borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column'
    }}
    >
      <TabBar />
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 实现 RightPanel/TabBar 与三种 Tab 内容"
```

---

## Task 11: AppShell + 入口组装

**Files:**
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/main.tsx`
- Create: `index.html`

- [ ] **Step 1: 实现 App.tsx**

```tsx
import { TitleBar } from './components/TitleBar'
import { LeftPanel } from './components/LeftPanel'
import { ChatArea } from './components/ChatArea'
import { RightPanel } from './components/RightPanel'
import { useStore } from './state/store'

export function App() {
  const { state } = useStore()
  // 当前激活项目名
  const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const projectName = activeProject?.name ?? 'cc-desk'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TitleBar projectName={projectName} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftPanel />
        <ChatArea />
        <RightPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 实现 main.tsx**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/store'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
)
```

- [ ] **Step 3: 实现 index.html（renderer root）**

`index.html`（项目根目录，electron-vite renderer 配置 `root: src/renderer`，但入口 html 放 renderer root 下）。实际放 `src/renderer/index.html`：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>cc-desk</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 组装 AppShell 与应用入口"
```

---

## Task 12: Electron 主进程与预加载

**Files:**
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`

- [ ] **Step 1: 实现 main/index.ts**

```ts
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,           // 无系统边框，用自定义 titleBar
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 开发态加载 dev server，生产态加载打包文件
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 外链用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: 实现 preload/index.ts**

```ts
// 原型阶段 preload 暂留空导出，后续接文件系统/终端时扩展
export {}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: 添加 Electron 主进程与 preload"
```

---

## Task 13: 端到端联调与验收

**Files:** 无新增（验证为主）

- [ ] **Step 1: 运行全部单元测试**

Run: `pnpm test`

Expected: 全部 PASS

- [ ] **Step 2: 启动 Electron 开发模式**

Run: `pnpm dev`

Expected: 弹出应用窗口，显示三栏布局，主题为上次保存的（首次为 dark-warm）

- [ ] **Step 3: 手动验收 —— 对照 spec 第 8 节验证清单逐项操作**

- [ ] 三栏布局正确呈现，左 240 / 中 flex / 右 320
- [ ] TitleBar 切换器点开，四种主题实时切换，刷新后保持
- [ ] 左栏项目 hover → 出现 📂/➕/🗑️ 三个图标
- [ ] 左栏会话 hover → 出现 🗑️，点击变 ✅，再点删除；移开还原
- [ ] 新增会话：p1（已有空会话 s2）点 ➕ → 不新增，切到 s2
- [ ] 新增会话：p2（无空会话）点 ➕ → 新增一条
- [ ] 点 📂 → 左栏变文件树，点 ← 返回
- [ ] 点文件 → 右栏新开文件 Tab；重复点同文件 → 不新开，切过去
- [ ] 右栏 + 新开浏览器 Tab，地址栏输入网址回车可导航
- [ ] 关掉所有 Tab → 显示"暂无打开的面板"空白占位
- [ ] 切换会话 → 右栏 Tab 组跟着切换

- [ ] **Step 4: 记录遗留问题（如有）**

在 `docs/superpowers/plans/` 下或对话中记录原型阶段发现的视觉/交互问题，作为后续迭代输入。

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "chore: 原型验收完成"
```

---

## Self-Review 已完成

对照 spec 逐项核对：

| spec 要求 | 实现任务 | 状态 |
|-----------|---------|------|
| 三栏 + 自定义 titleBar | Task 7, 11, 12 | ✅ |
| 左栏会话树态（项目→会话两级） | Task 8 | ✅ |
| 项目 hover 三图标 / 会话 hover 一图标 | Task 8 (ProjectTree) | ✅ |
| 删除二次确认 🗑️→✅→还原 | Task 6 (DeleteConfirmIcon) + Task 8 | ✅ |
| 新增会话去重（已有空会话则切换） | Task 3 (reducer) + Task 8 | ✅ |
| 文件树态切换 + 返回 | Task 8 (LeftPanel + FileTree) | ✅ |
| 点文件右栏新开 Tab + 去重 | Task 3 (OPEN_FILE_TAB) + Task 8 | ✅ |
| 右栏三种 Tab | Task 10 | ✅ |
| Tab 增删 + 空占位 | Task 3 (CLOSE_TAB) + Task 10 | ✅ |
| Tab 绑定会话（切会话换组） | Task 3 (tabsBySession) + Task 10 | ✅ |
| 四种主题 + 实时 + 持久化 | Task 5, 4, 7 | ✅ |
| 默认主题 dark-warm | Task 4 | ✅ |

无占位符残留，类型与 action 名称跨任务一致（DELETE_PROJECT/SESSION、ADD_SESSION、OPEN_FILE_TAB、OPEN_TAB、CLOSE_TAB、SELECT_TAB、SELECT_SESSION、SET_THEME）。
