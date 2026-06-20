# 应用更新检查功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 cc-desk 的应用更新检查链路——启动自动检查 + 定时复查，TitleBar 单状态机按钮提示，应用菜单「检查更新」，设置页「关于」子页含完整更新入口。

**Architecture:** `electron-updater` + GitHub Releases（`mrhuangyong/cc-desk`），混合平台策略：win/linux 全自动下载重启，mac 无证书降级为下载 dmg + `shell.openPath` 自动打开。主进程封装 `UpdateManager`（emit 解耦 webContents），状态机经 `update:state` IPC 推送到渲染端单一 store 字段 `updateStatus`，TitleBar/菜单/关于页三处共享。

**Tech Stack:** electron-updater ^6.x，Electron `Menu`/`autoUpdater`/`shell`，React + useReducer，vitest（mock autoUpdater + fetch）。

**Spec:** `docs/superpowers/specs/2026-06-20-app-update-check-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/main/update-manager.ts` | 封装 autoUpdater + 平台分流 + 状态机 + 事件转发 | 新建 |
| `src/main/index.ts` | 实例化 UpdateManager、注册 IPC、应用菜单、生命周期钩子 | 修改 |
| `src/preload/index.ts` | 暴露 `update` + `appVersion` 命名空间 | 修改 |
| `src/renderer/types.ts` | `SettingsSection` 加 `'about'`；`UpdateStatus` 类型 | 修改 |
| `src/renderer/state/actions.ts` | 加 `UPDATE_STATUS` action | 修改 |
| `src/renderer/state/reducer.ts` | `AppState.updateStatus` 字段 + 处理 `UPDATE_STATUS` | 修改 |
| `src/renderer/App.tsx` | 订阅 `update.onState` 单次挂载 | 修改 |
| `src/renderer/global.d.ts` | `window.api.update` / `appVersion` 类型 | 修改 |
| `src/renderer/components/TitleBar.tsx` | 新增 `UpdateButton` 并插入 | 修改 |
| `src/renderer/components/settings/AboutSettings.tsx` | 关于子页 | 新建 |
| `src/renderer/components/settings/SettingsPage.tsx` | switch 加 `about` 分支 | 修改 |
| `src/renderer/components/settings/SettingsMenu.tsx` | ITEMS 加 about | 修改 |
| `src/renderer/i18n/index.ts` | 双语新增 `settings.about` 等 | 修改 |
| `package.json` | `electron-updater` 依赖 + `build.publish` | 修改 |
| `tests/update-manager.test.ts` | UpdateManager 平台分流单测 | 新建 |
| `tests/reducer.test.ts` | `initialState` 加 `updateStatus` + 用例 | 修改 |
| `tests/about-settings.test.tsx` | AboutSettings 组件测试 | 新建 |

分解原则：主进程模块（无 UI、可纯测）先于渲染端；类型契约（types/actions/reducer）先于组件；每步独立可提交。

---

## Task 1: 安装依赖与构建配置

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 electron-updater 依赖**

Run:
```bash
pnpm add electron-updater
```

- [ ] **Step 2: 在 `package.json` 的 `build` 块加 `publish` 字段**

在 `"linux": { ... }` 之后、`build` 块闭合 `}` 之前，加：

```json
    "publish": [
      { "provider": "github", "owner": "mrhuangyong", "repo": "cc-desk" }
    ]
```

- [ ] **Step 3: 验证依赖写入**

Run: `node -e "console.log(require('./package.json').dependencies['electron-updater'])"`
Expected: 打印一个 `^6.x` 版本号。

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add electron-updater + build.publish for github releases"
```

---

## Task 2: UpdateStatus 类型与 reducer 接入

**Files:**
- Modify: `src/renderer/types.ts`
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Test: `tests/reducer.test.ts`

- [ ] **Step 1: 在 `types.ts` 加 `UpdateStatus` 并扩展 `SettingsSection`**

`src/renderer/types.ts` 中 `SettingsSection`（约 165-167 行）改为：

```ts
export type SettingsSection =
  | 'general' | 'code-preview' | 'model' | 'memory' | 'skills'
  | 'mcp' | 'plugins' | 'commands' | 'hooks' | 'archived' | 'about'
```

在 `SettingsSection` 定义之后紧跟加：

```ts
// 应用更新状态机（全局单例，非按 session 分片）
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
```

- [ ] **Step 2: 在 `actions.ts` 加 `UPDATE_STATUS` action**

`src/renderer/state/actions.ts` 顶部 import 已含 `SettingsSection`，无需改 import。在 `Action` 联合末尾（`COMPACT_DONE` 那行之后）加：

```ts
  | { type: 'UPDATE_STATUS'; status: import('../types').UpdateStatus }
```

- [ ] **Step 3: 在 `reducer.ts` 的 `AppState` 加 `updateStatus` 字段**

`src/renderer/state/reducer.ts` 第 2 行 import 加 `UpdateStatus`：

```ts
import type { AppView, ContentBlock, Draft, Project, Session, SettingsSection, SystemNotice, Tab, ThemeId, AppSettings, UpdateStatus } from '../types'
```

在 `AppState` 的 `abortedBySession` 字段（约 51 行）之后、闭合 `}` 之前加：

```ts
  // 应用更新状态机（全局单例）。TitleBar / 应用菜单 / 关于页共享。
  updateStatus: UpdateStatus
```

- [ ] **Step 4: 在 `reducer.ts` switch 加 `UPDATE_STATUS` 分支**

在 `reducer` 函数 switch 末尾，`default` 之前（最后一个 case 之后）加：

```ts
    case 'UPDATE_STATUS': {
      return { ...state, updateStatus: action.status }
    }
```

- [ ] **Step 5: 写失败测试**

在 `tests/reducer.test.ts` 的 `initialState()` 返回对象里（约第 29 行那一长串赋值），末尾追加 `updateStatus`：

找到：
```ts
    claudeSessionMap: {},
    pendingDialog: null,
    dirtyTabIds: {}, lastFileOpenedSeq: 0, queueBySession: {}, tasksBySession: {}, backendTasksBySession: {}, panelFold: { root: false, taskCard: false, subagentCard: false, backendTaskCard: false }, subagentOutputBySession: {}, planBySession: {}, abortedBySession: {},
  }
}
```

改为（加一行 `updateStatus`）：
```ts
    claudeSessionMap: {},
    pendingDialog: null,
    dirtyTabIds: {}, lastFileOpenedSeq: 0, queueBySession: {}, tasksBySession: {}, backendTasksBySession: {}, panelFold: { root: false, taskCard: false, subagentCard: false, backendTaskCard: false }, subagentOutputBySession: {}, planBySession: {}, abortedBySession: {},
    updateStatus: { state: 'idle' },
  }
}
```

在 `describe('reducer', () => {` 块内任意位置加用例：

```ts
  it('UPDATE_STATUS 更新全局更新状态', () => {
    const state = initialState()
    const next = reducer(state, { type: 'UPDATE_STATUS', status: { state: 'ready', version: '1.2.0' } })
    expect(next.updateStatus).toEqual({ state: 'ready', version: '1.2.0' })
  })
```

- [ ] **Step 6: 跑测试**

Run: `npx vitest run tests/reducer.test.ts -t "UPDATE_STATUS"`
Expected: PASS。

- [ ] **Step 7: 跑全量 reducer 测试确保没破坏**

Run: `npx vitest run tests/reducer.test.ts tests/reducer-extra.test.ts`
Expected: 全 PASS（`initialState` 两处都已加 `updateStatus`——若 `reducer-extra.test.ts` 也有独立 `initialState`，同样加 `updateStatus: { state: 'idle' }`）。

> 注意：`reducer-extra.test.ts` 第 7 行也有 `initialState`，需同步加该字段，否则 TS/字段校验失败。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/types.ts src/renderer/state/actions.ts src/renderer/state/reducer.ts tests/reducer.test.ts tests/reducer-extra.test.ts
git commit -m "feat(state): add UpdateStatus type + UPDATE_STATUS reducer"
```

---

## Task 3: UpdateManager 主进程模块（含平台分流）

**Files:**
- Create: `src/main/update-manager.ts`
- Test: `tests/update-manager.test.ts`

本任务的核心。用 mock 验证平台分流，不触网。

- [ ] **Step 1: 写失败测试（先定义预期接口）**

创建 `tests/update-manager.test.ts`：

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock electron-updater：捕获 autoUpdater 实例与事件监听
const autoUpdaterMock = {
  autoDownload: false,
  autoInstallOnQuit: false,
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn(),
}
vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }))

// mock electron：仅暴露用到的方法；app.isPackaged/getVersion 在 case 里改写
const appMock = {
  isPackaged: true,
  getVersion: vi.fn(() => '1.0.0'),
  getPath: vi.fn(() => '/tmp/downloads'),
}
vi.mock('electron', () => ({
  app: appMock,
  shell: { openPath: vi.fn(async () => '') },
}))

// 全局 fetch mock（mac 分支用）
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// 动态导入，确保 mock 生效
async function importFresh(platform: 'darwin' | 'win32' | 'linux', isPackaged = true) {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  appMock.isPackaged = isPackaged
  appMock.getVersion.mockReturnValue('1.0.0')
  autoUpdaterMock.on.mockClear()
  autoUpdaterMock.checkForUpdates.mockClear()
  autoUpdaterMock.autoDownload = false
  autoUpdaterMock.autoInstallOnQuit = false
  const mod = await import('../src/main/update-manager')
  return mod
}

describe('UpdateManager 平台分流', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('win/linux: 绑定 autoUpdater 事件且 autoDownload=true', async () => {
    const { UpdateManager } = await importFresh('win32')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const events = autoUpdaterMock.on.mock.calls.map((c: any[]) => c[0])
    expect(events).toContain('update-available')
    expect(events).toContain('download-progress')
    expect(events).toContain('update-downloaded')
    expect(autoUpdaterMock.autoDownload).toBe(true)
    expect(autoUpdaterMock.autoInstallOnQuit).toBe(false)
  })

  it('win/linux: checkNow 调 autoUpdater.checkForUpdates，emit checking', async () => {
    const { UpdateManager } = await importFresh('linux')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalled()
    expect(emitted).toContainEqual({ state: 'checking' })
  })

  it('win/linux: update-downloaded 事件 → emit ready', async () => {
    const { UpdateManager } = await importFresh('win32')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    // 找到 update-downloaded 的监听器并触发
    const call = autoUpdaterMock.on.mock.calls.find((c: any[]) => c[0] === 'update-downloaded')!
    call[1]({ version: '1.2.0' })
    expect(emitted).toContainEqual({ state: 'ready', version: '1.2.0' })
  })

  it('mac: fetch latest-mac.yml 发现新版 → emit available', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => 'version: 1.2.0\nfiles:\n  - url: cc-desk-1.2.0.dmg\n',
    })
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(fetchMock).toHaveBeenCalled()
    expect(emitted).toContainEqual({ state: 'available', version: '1.2.0' })
    // mac 不应触发 autoUpdater
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('mac: 版本相同 → emit idle', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => 'version: 1.0.0\n',
    })
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(emitted).toContainEqual({ state: 'idle' })
  })

  it('mac: fetch 失败 → emit error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    const errState = emitted.find((s) => s.state === 'error')
    expect(errState).toBeTruthy()
    expect(errState.message).toContain('network down')
  })

  it('dev: isPackaged=false 时 checkNow 直接 emit idle，不触网', async () => {
    const { UpdateManager } = await importFresh('win32', false)
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow()
    expect(emitted).toContainEqual({ state: 'idle' })
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
  })

  it('sendCurrentState: 重发当前 status', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'version: 1.0.0\n' })
    const { UpdateManager } = await importFresh('darwin')
    const m = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
    const emitted: any[] = []
    m.setEmit((s) => emitted.push(s))
    await m.checkNow() // 走到 idle
    emitted.length = 0
    m.sendCurrentState()
    expect(emitted).toContainEqual({ state: 'idle' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/update-manager.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/main/update-manager.ts`**

```ts
// 应用更新管理：封装 electron-updater，按平台分流。
// win/linux: 走 autoUpdater 全自动（autoDownload=true，用户点重启）。
// mac: 无 Apple 证书时 autoUpdater 无法静默下载安装，改为 fetch latest-mac.yml
//      比对版本，发现新版后下载 dmg + shell.openPath 自动打开（用户拖拽安装）。
// 状态机经注入的 emit 回调转发到渲染端，不直接持有 webContents（窗口刷新安全）。
import { autoUpdater } from 'electron-updater'
import { app, shell } from 'electron'
import type { UpdateStatus } from '../renderer/types'

const SUPPORTS_AUTO = process.platform === 'win32' || process.platform === 'linux'
const CHECK_INTERVAL = 4 * 60 * 60 * 1000 // 4 小时复查
const STARTUP_DELAY = 8 * 1000 // 启动后 8s 首检，避免与 query 初始化抢资源

// 极简 semver 大于判断（仅支持 x.y.z 数字）：返回 a > b
function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

interface MacMeta { version: string; assetName: string }

// 从 latest-mac.yml 文本解析版本号与 dmg asset 名
function parseMacYml(yml: string): MacMeta | null {
  const vMatch = yml.match(/^version:\s*(.+)$/m)
  if (!vMatch) return null
  const version = vMatch[1].trim()
  // 取第一个 .dmg 文件名
  const dmgMatch = yml.match(/url:\s*([^\s]+\.dmg)\b/)
  const assetName = dmgMatch ? dmgMatch[1].trim() : ''
  return { version, assetName }
}

export class UpdateManager {
  private status: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private emit: (s: UpdateStatus) => void = () => {}
  private readonly repo: string

  constructor(opts: { repo: string }) {
    this.repo = opts.repo
    if (SUPPORTS_AUTO) {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnQuit = false // 不在退出时静默装，等用户点
      this.bindAutoUpdaterEvents()
    }
  }

  // 注入状态转发回调（index.ts 用 win.webContents.send 实现）
  setEmit(fn: (s: UpdateStatus) => void) {
    this.emit = fn
  }

  // 窗口刷新后重发当前态，让渲染端按钮立即恢复
  sendCurrentState() {
    this.emit(this.status)
  }

  private setStatus(s: UpdateStatus) {
    this.status = s
    this.emit(s)
  }

  private bindAutoUpdaterEvents() {
    autoUpdater.on('update-available', (info: any) => {
      this.setStatus({ state: 'available', version: info?.version ?? '' })
    })
    autoUpdater.on('download-progress', (p: any) => {
      this.setStatus({ state: 'downloading', percent: Math.round(p?.percent ?? 0) })
    })
    autoUpdater.on('update-downloaded', (info: any) => {
      this.setStatus({ state: 'ready', version: info?.version ?? '' })
    })
    autoUpdater.on('update-not-available', () => {
      this.setStatus({ state: 'idle' })
    })
    autoUpdater.on('error', (e: any) => {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    })
  }

  async checkNow(): Promise<void> {
    if (!app.isPackaged) {
      // dev 下 autoUpdater 不可用；静默 idle
      this.setStatus({ state: 'idle' })
      return
    }
    this.setStatus({ state: 'checking' })
    if (SUPPORTS_AUTO) {
      try {
        await autoUpdater.checkForUpdates()
      } catch (e: any) {
        this.setStatus({ state: 'error', message: String(e?.message ?? e) })
      }
      return
    }
    // mac: fetch latest-mac.yml 比对版本
    try {
      const meta = await this.fetchMacMeta()
      if (!meta) {
        this.setStatus({ state: 'error', message: '无法解析 latest-mac.yml' })
        return
      }
      if (semverGt(meta.version, app.getVersion())) {
        this.setStatus({ state: 'available', version: meta.version })
      } else {
        this.setStatus({ state: 'idle' })
      }
    } catch (e: any) {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    }
  }

  private async fetchMacMeta(): Promise<MacMeta | null> {
    const url = `https://github.com/${this.repo}/releases/latest/download/latest-mac.yml`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`latest-mac.yml HTTP ${res.status}`)
    const yml = await res.text()
    return parseMacYml(yml)
  }

  // mac available 态：下载 dmg 到下载目录并自动打开
  async downloadDmgAndOpen(): Promise<void> {
    try {
      const meta = await this.fetchMacMeta()
      if (!meta || !meta.assetName) {
        this.setStatus({ state: 'error', message: '未找到 dmg 下载地址' })
        return
      }
      const url = `https://github.com/${this.repo}/releases/download/v${meta.version}/${meta.assetName}`
      const dlDir = app.getPath('downloads')
      const path = await this.downloadFile(url, `${dlDir}/${meta.assetName}`)
      await shell.openPath(path)
      // 保持 available 态（不走 quitAndInstall）
    } catch (e: any) {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    }
  }

  // 简易文件下载（流式写盘）。仅 mac 分支用。
  private async downloadFile(url: string, dest: string): Promise<string> {
    const { createWriteStream } = await import('fs')
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(dest)
      res.body!.pipe(ws as any)
      ws.on('finish', () => resolve())
      ws.on('error', reject)
    })
    return dest
  }

  // win/linux ready 态：安装并重启
  install(): void {
    if (this.status.state === 'ready') {
      autoUpdater.quitAndInstall()
    }
  }

  startAutoCheck(): void {
    setTimeout(() => this.checkNow(), STARTUP_DELAY)
    this.timer = setInterval(() => this.checkNow(), CHECK_INTERVAL)
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/update-manager.test.ts`
Expected: 全 PASS（8 个用例）。

> 若 `res.body.pipe` 在 node 类型上有红线：`UpdateManager` 运行在主进程（Node），`fetch` 来自 Node 全局（Electron 42 内置）。`pipe(ws as any)` 的 `as any` 已规避类型冲突。测试用 `createWriteStream` mock 不在此步覆盖——downloadFile 的网络行为属集成层，单测覆盖到 `downloadDmgAndOpen` 的错误路径即可（meta 缺失→error）。

- [ ] **Step 5: Commit**

```bash
git add src/main/update-manager.ts tests/update-manager.test.ts
git commit -m "feat(main): add UpdateManager with platform-specific update flow"
```

---

## Task 4: preload + global.d.ts 类型契约

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: preload 加 `update` + `appVersion` 命名空间**

在 `src/preload/index.ts` 的 `contextBridge.exposeInMainWorld('api', { ... })` 对象里，在 `backendTask: { ... }` 之后加（注意前一个对象成员后加逗号）：

```ts
  update: {
    // 主→渲染：状态机变更。返回 unsubscribe，防监听器累加（沿用 onArchiveTick 模式）
    onState: (cb: (s: any) => void) => {
      const channel = 'update:state'
      const handler = (_: unknown, s: any) => cb(s)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    downloadAndOpen: () => ipcRenderer.invoke('update:download-and-open'),
  },
  appVersion: {
    get: () => ipcRenderer.invoke('app:version'),
  },
```

- [ ] **Step 2: global.d.ts 加类型声明**

在 `src/renderer/global.d.ts` 的 `interface Window { api: { ... } }` 块里，`onArchiveTick` 之后加（先在文件中合适位置定义接口，复用 `UpdateStatus` 已在 types 中导出）。

先在文件顶部已有的 import 区（若有 `import type { ... } from '../types'`）加 `UpdateStatus`；若无 import 区，在 `declare global` 之前加：

```ts
import type { UpdateStatus } from './types'
```

在 `api: { ... }` 内 `onArchiveTick: ...` 之后加：

```ts
      update: {
        onState: (cb: (s: UpdateStatus) => void) => () => void
        check: () => Promise<void>
        install: () => Promise<void>
        downloadAndOpen: () => Promise<void>
      }
      appVersion: {
        get: () => Promise<{ version: string; electron: string; chrome: string; node: string }>
      }
```

> 注意 `onArchiveTick` 那行末尾要加逗号。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（仅可能有既存无关错误）。

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(ipc): expose update + appVersion channels to renderer"
```

---

## Task 5: 主进程注册 IPC + 应用菜单 + 生命周期

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: 顶部 import 加 `Menu`、`UpdateManager`**

`src/main/index.ts` 第 1 行 import 改为：

```ts
import { app, BrowserWindow, shell, ipcMain, dialog, Menu } from 'electron'
```

在 import 区（`import { migrateFromClaude } ...` 之后）加：

```ts
import { UpdateManager } from './update-manager'
```

- [ ] **Step 2: 实例化 UpdateManager**

在 `const ptyManager = new PtyManager()`（约 34 行）之后加：

```ts
const updateManager = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
```

- [ ] **Step 3: 在 createWindow 内注册 IPC 并绑定 emit**

在 `ptyManager.setWebContents(win.webContents)`（约 58 行）之后加：

```ts
  // 更新状态转发到当前窗口（窗口重建时在 did-finish-load 重绑）
  updateManager.setEmit((s) => win.webContents.send('update:state', s))
```

在 IPC 注册块（`ipcMain.handle('backend-task:kill', ...)` 之后，约 166 行之后）加：

```ts
  // 应用更新
  ipcMain.handle('update:check', () => updateManager.checkNow())
  ipcMain.handle('update:install', () => updateManager.install())
  ipcMain.handle('update:download-and-open', () => updateManager.downloadDmgAndOpen())

  // 关于页版本信息
  ipcMain.handle('app:version', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }))
```

- [ ] **Step 4: did-finish-load 重绑 emit + 重发状态**

找到现有 `win.webContents.on('did-finish-load', () => { claude.reattachRunningSessions(win.webContents) })`（约 190 行），改为：

```ts
  win.webContents.on('did-finish-load', () => {
    claude.reattachRunningSessions(win.webContents)
    // 窗口刷新后重绑 update emit 并重发当前态，让按钮立即恢复
    updateManager.setEmit((s) => win.webContents.send('update:state', s))
    updateManager.sendCurrentState()
  })
```

- [ ] **Step 5: 在 app.whenReady 启动自动检查 + 注册应用菜单**

找到 `app.whenReady().then(() => { ... })`（约 195 行），在 `startArchiveTimer()` 之后加：

```ts
  updateManager.startAutoCheck()
  // 注册原生应用菜单（mac 补 Edit 菜单避免 Cmd+C 失效；各平台加「检查更新」）
  Menu.setApplicationMenu(buildAppMenu(updateManager))
```

在文件末尾（`app.on('window-all-closed', ...)` 之后）加菜单构建函数：

```ts
// 原生应用菜单：mac 应用菜单 / 其他平台帮助菜单各加「检查更新」。
// mac 必须有 Edit 菜单，否则 Cmd+C/Cmd+V 失效（Electron 已知行为）。
function buildAppMenu(updateMgr: UpdateManager): Menu {
  const isMac = process.platform === 'darwin'
  const checkUpdate: Electron.MenuItemConstructorOptions = {
    label: '检查更新',
    click: () => updateMgr.checkNow(),
  }
  const template: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        { role: 'appMenu', submenu: [checkUpdate, { type: 'separator' }, { role: 'quit' }] },
        { role: 'editMenu' },
      ]
    : [
        { label: '文件', submenu: [{ role: 'quit' }] },
        { label: '帮助', submenu: [checkUpdate, { role: 'about' }] },
      ]
  return Menu.buildFromTemplate(template)
}
```

- [ ] **Step 6: before-quit 加 dispose**

找到 `app.on('before-quit', async () => { ... })`（约 226 行），在 `backendTaskRegistry.clearAll()` 之后、`await sessionQueryManager.closeAll()` 之前加：

```ts
  updateManager.dispose()
```

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): wire UpdateManager IPC, app menu, lifecycle hooks"
```

---

## Task 6: 渲染端订阅 update 状态

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: 在 App.tsx 加 update 订阅 useEffect**

在 `src/renderer/App.tsx` 的「自动归档」useEffect（约 182-188 行，`onArchiveTick` 那个）之后加：

```tsx
  // 应用更新状态：订阅主进程状态机推送（单次挂载，cleanup 取消订阅防泄漏）
  useEffect(() => {
    const unsubscribe = window.api?.update?.onState?.((status) => {
      dispatch({ type: 'UPDATE_STATUS', status })
    })
    return () => { unsubscribe?.() }
  }, [dispatch])
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(app): subscribe to update state changes"
```

---

## Task 7: i18n 文案

**Files:**
- Modify: `src/renderer/i18n/index.ts`

- [ ] **Step 1: zh-CN 块加文案**

在 `src/renderer/i18n/index.ts` 的 `'zh-CN'` 字典里，`'settings.archived': '已归档会话',`（约 49 行）之后加：

```ts
    'settings.about': '关于',
    'about.title': '关于 cc-desk',
    'about.version': '版本',
    'about.desc': 'cc-desk 是 Claude Code 的桌面客户端，把 Claude Agent SDK 包装成带文件树、终端、浏览器、代码审查多 Tab 的工作台。',
    'about.repo': '项目仓库',
    'about.checkUpdate': '检查更新',
    'about.checking': '检查中…',
    'about.newVersion': '发现新版本',
    'about.downloading': '下载中…',
    'about.downloadOpen': '下载并打开',
    'about.installRestart': '立即重启安装',
    'about.retry': '重试',
    'about.upToDate': '已是最新版本',
    'update.button': 'Update',
    'update.download': '下载更新',
```

- [ ] **Step 2: en 块加对应文案**

在 `'en'` 字典里，`'settings.archived': 'Archived Sessions',`（约 105 行）之后加：

```ts
    'settings.about': 'About',
    'about.title': 'About cc-desk',
    'about.version': 'Version',
    'about.desc': 'cc-desk is a desktop client for Claude Code, wrapping the Claude Agent SDK into a workbench with file tree, terminal, browser, and code-review tabs.',
    'about.repo': 'Repository',
    'about.checkUpdate': 'Check for updates',
    'about.checking': 'Checking…',
    'about.newVersion': 'New version available',
    'about.downloading': 'Downloading…',
    'about.downloadOpen': 'Download and open',
    'about.installRestart': 'Restart and install',
    'about.retry': 'Retry',
    'about.upToDate': 'Up to date',
    'update.button': 'Update',
    'update.download': 'Download update',
```

- [ ] **Step 3: 跑 i18n 完整性测试**

Run: `npx vitest run tests/i18n-completeness.test.ts`
Expected: PASS（两侧 key 对齐、非空）。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/i18n/index.ts
git commit -m "feat(i18n): add about + update copy (zh-CN, en)"
```

---

## Task 8: TitleBar UpdateButton

**Files:**
- Modify: `src/renderer/components/TitleBar.tsx`

- [ ] **Step 1: 在 TitleBar 加 UpdateButton 组件并插入**

在 `src/renderer/components/TitleBar.tsx` 顶部 import 加 `Download` 图标（lucide-react 已 import 其他图标）：

```ts
import { Settings, Plus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, ListChecks, Download } from 'lucide-react'
```

在 `GhostButton` 组件定义之后、`interface Props` 之前加 `UpdateButton`：

```tsx
// 更新按钮：单一状态机，位置在 TitleBar 左侧最右边（折叠入口之后、项目名之前）。
// idle/checking/error 不渲染；available 蓝灰；downloading 显示进度；ready 绿色。
function UpdateButton() {
  const { state, dispatch } = useStore()
  const s = state.updateStatus
  if (s.state === 'idle' || s.state === 'checking' || s.state === 'error') return null

  const isMac = navigator.userAgent.includes('Macintosh')

  if (s.state === 'downloading') {
    return (
      <Tooltip label={`下载更新 ${s.percent}%`}>
        <button
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 24,
            padding: '0 8px', borderRadius: 6, border: 'none', cursor: 'default',
            background: 'var(--bg-hover)', color: 'var(--text)',
            fontFamily: 'var(--font-mono)', fontSize: 12, ...noDrag,
          }}
        >
          <Download size={13} /> {s.percent}%
        </button>
      </Tooltip>
    )
  }

  if (s.state === 'available') {
    // win/linux 已 autoDownload，按钮不可点（仅提示）；mac 点击下载 dmg
    const onClick = isMac
      ? () => window.api.update.downloadAndOpen()
      : undefined
    return (
      <Tooltip label={isMac ? '下载并打开 dmg' : '正在下载更新…'}>
        <button
          onClick={onClick}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 24,
            padding: '0 10px', borderRadius: 6, border: 'none',
            cursor: isMac ? 'pointer' : 'default',
            background: 'var(--bg-hover)', color: 'var(--text)',
            fontFamily: 'var(--font-mono)', fontSize: 12, ...noDrag,
          }}
        >
          <Download size={13} /> {s.version}
        </button>
      </Tooltip>
    )
  }

  // ready
  return (
    <Tooltip label="点击安装并重启">
      <button
        onClick={() => window.api.update.install()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 24,
          padding: '0 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: '#1f9d55', color: '#fff', fontWeight: 600,
          fontFamily: 'var(--font-mono)', fontSize: 12, ...noDrag,
        }}
      >
        Update
      </button>
    </Tooltip>
  )
}
```

在 `TitleBar` 组件 JSX 中，找到折叠态补充入口块（`{leftCollapsed && (<> ... </>)}` 之后，项目名 `<span>` 之前，约 84-86 行之间）插入：

```tsx
      {/* 更新按钮：左侧最右边，折叠入口之后、项目名之前 */}
      <UpdateButton />
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 3: 启动 dev 目视确认按钮不报错**

Run: `pnpm dev`（手动确认无运行时错误后可关闭）

> dev 下 `updateStatus` 恒为 `idle`，按钮不渲染——这是预期。确认无控制台报错即可。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TitleBar.tsx
git commit -m "feat(titlebar): add state-driven UpdateButton"
```

---

## Task 9: 关于子页（AboutSettings）组件 + 测试

**Files:**
- Create: `src/renderer/components/settings/AboutSettings.tsx`
- Modify: `src/renderer/components/settings/SettingsPage.tsx`
- Modify: `src/renderer/components/settings/SettingsMenu.tsx`
- Test: `tests/about-settings.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `tests/about-settings.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AboutSettings } from '../src/renderer/components/settings/AboutSettings'

// mock useStore：让 updateStatus 可控
const mockDispatch = vi.fn()
let mockUpdateStatus: any = { state: 'idle' }
vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({
    state: { updateStatus: mockUpdateStatus },
    dispatch: mockDispatch,
  }),
}))

// mock useI18n：直接回 key，便于断言
vi.mock('../src/renderer/i18n/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'zh-CN' }),
}))

// mock window.api
const updateApi = {
  check: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  downloadAndOpen: vi.fn(async () => {}),
}
const appVersionApi = { get: vi.fn(async () => ({ version: '1.0.0', electron: '42', chrome: '1', node: '25' })) }
vi.stubGlobal('window', Object.assign(Object.create(globalThis.window ?? {}), {
  api: { update: updateApi, appVersion: appVersionApi },
}))

describe('AboutSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateStatus = { state: 'idle' }
  })

  it('显示应用名与版本号', async () => {
    render(<AboutSettings />)
    expect(await screen.findByText(/1\.0\.0/)).toBeInTheDocument()
    expect(screen.getByText('about.title')).toBeInTheDocument()
  })

  it('idle 态显示检查更新按钮，点击触发 check', async () => {
    render(<AboutSettings />)
    const btn = await screen.findByText('about.checkUpdate')
    fireEvent.click(btn)
    expect(updateApi.check).toHaveBeenCalled()
  })

  it('ready 态显示绿色重启按钮，点击触发 install', async () => {
    mockUpdateStatus = { state: 'ready', version: '1.2.0' }
    render(<AboutSettings />)
    const btn = await screen.findByText('about.installRestart')
    fireEvent.click(btn)
    expect(updateApi.install).toHaveBeenCalled()
  })

  it('error 态显示错误信息与重试按钮', async () => {
    mockUpdateStatus = { state: 'error', message: '网络失败' }
    render(<AboutSettings />)
    expect(await screen.findByText(/网络失败/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('about.retry'))
    expect(updateApi.check).toHaveBeenCalled()
  })

  it('mac available 态显示下载并打开按钮', async () => {
    mockUpdateStatus = { state: 'available', version: '1.2.0' }
    // 伪装 mac
    const orig = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', { value: 'Macintosh', configurable: true })
    render(<AboutSettings />)
    const btn = await screen.findByText('about.downloadOpen')
    fireEvent.click(btn)
    expect(updateApi.downloadAndOpen).toHaveBeenCalled()
    Object.defineProperty(navigator, 'userAgent', { value: orig, configurable: true })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/about-settings.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现 AboutSettings 组件**

创建 `src/renderer/components/settings/AboutSettings.tsx`：

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { useI18n } from '../../i18n/useI18n'
import { SettingsLayout } from './SettingsLayout'

const REPO_URL = 'https://github.com/mrhuangyong/cc-desk'

export function AboutSettings() {
  const { state } = useStore()
  const { t } = useI18n()
  const s = state.updateStatus
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api?.appVersion?.get?.().then((v) => setVersion(v.version)).catch(() => {})
  }, [])

  const isMac = navigator.userAgent.includes('Macintosh')

  const renderUpdateAction = () => {
    switch (s.state) {
      case 'idle':
        return <button onClick={() => window.api.update.check()}>{t('about.checkUpdate')}</button>
      case 'checking':
        return <button disabled>{t('about.checking')}</button>
      case 'available':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{t('about.newVersion')} v{s.version}</span>
            {isMac ? (
              <button onClick={() => window.api.update.downloadAndOpen()}>{t('about.downloadOpen')}</button>
            ) : (
              <span>{t('about.downloading')}</span>
            )}
          </div>
        )
      case 'downloading':
        return <span>{t('about.downloading')} {s.percent}%</span>
      case 'ready':
        return (
          <button
            onClick={() => window.api.update.install()}
            style={{ background: '#1f9d55', color: '#fff' }}
          >
            {t('about.installRestart')}
          </button>
        )
      case 'error':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'crimson' }}>{s.message}</span>
            <button onClick={() => window.api.update.check()}>{t('about.retry')}</button>
          </div>
        )
    }
  }

  return (
    <SettingsLayout title={t('about.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>cc-desk</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {t('about.version')}：{version || '—'}
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>{t('about.desc')}</p>
        <div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{t('about.repo')}</div>
          <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 13 }}>
            {REPO_URL}
          </a>
        </div>
        <div style={{ marginTop: 8 }}>{renderUpdateAction()}</div>
      </div>
    </SettingsLayout>
  )
}
```

- [ ] **Step 4: SettingsPage 加 about 分支**

`src/renderer/components/settings/SettingsPage.tsx` 顶部 import 加：

```ts
import { AboutSettings } from './AboutSettings'
```

`renderSection` 的 switch 里（约 37 行 `case 'archived'` 之后）加：

```ts
      case 'about': return <AboutSettings />
```

- [ ] **Step 5: SettingsMenu 加 about 项**

`src/renderer/components/settings/SettingsMenu.tsx` 的 `ITEMS` 数组末尾（`{ id: 'archived', labelKey: 'settings.archived' }` 之后）加：

```ts
  { id: 'about', labelKey: 'settings.about' },
```

- [ ] **Step 6: 跑测试**

Run: `npx vitest run tests/about-settings.test.tsx`
Expected: 全 PASS（5 个用例）。

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/settings/AboutSettings.tsx src/renderer/components/settings/SettingsPage.tsx src/renderer/components/settings/SettingsMenu.tsx tests/about-settings.test.tsx
git commit -m "feat(settings): add About section with update entry"
```

---

## Task 10: 全量回归

**Files:** 无（验证）

- [ ] **Step 1: 跑默认测试套件**

Run: `pnpm test`
Expected: 全 PASS（原有套件 + 新增 update-manager / about-settings / reducer 用例）。

> 若 `tests/reducer-extra.test.ts` 因缺 `updateStatus` 字段失败，回到 Task 2 Step 5 的说明补该文件的 `initialState`。

- [ ] **Step 2: 跑 i18n 完整性**

Run: `npx vitest run tests/i18n-completeness.test.ts`
Expected: PASS。

- [ ] **Step 3: 类型检查全量**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 4: dev 冒烟**

Run: `pnpm dev`
手动确认：应用启动无报错；mac 顶部菜单出现「检查更新」；设置页「关于」可见且无运行时错误。dev 下更新按钮不渲染（idle）为预期。

- [ ] **Step 5: Commit（若有遗留小修）**

```bash
git add -A
git commit -m "test: full regression for update feature"
```

（若无遗留改动，跳过。）

---

## 自审记录

**Spec 覆盖**：
- 自动检查（启动+定时）→ Task 5 Step 5 `startAutoCheck`
- TitleBar 绿色 Update 按钮（ready 态）→ Task 8
- 下载状态提示（downloading 进度）→ Task 8
- 应用菜单「检查更新」→ Task 5 Step 5 `buildAppMenu`
- 设置页「关于」+ 检查更新 → Task 9
- 平台分流（win/linux 自动、mac dmg）→ Task 3
- IPC 契约 + preload → Task 4

**类型一致性**：`UpdateStatus`、`UpdateManager.setEmit/sendCurrentState/checkNow/install/downloadDmgAndOpen`、`window.api.update.{onState,check,install,downloadAndOpen}`、`window.api.appVersion.get`、`UPDATE_STATUS` action——跨任务命名一致。

**已知集成层（非单测覆盖，spec 已记）**：`downloadFile` 的实际网络流式下载、`autoUpdater` 在真机打包后的行为、GitHub Releases 实际可达性——这些需真机/发布后验证，单测用 mock 覆盖逻辑分支。
