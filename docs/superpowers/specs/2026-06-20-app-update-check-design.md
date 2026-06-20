# 应用更新检查功能设计

> 日期：2026-06-20
> 仓库：https://github.com/mrhuangyong/cc-desk
> 状态：待实现

## 背景与目标

cc-desk 目前没有任何更新机制：`package.json` 无 `electron-updater` 依赖，`build` 配置无 `publish` 字段，主进程无 `autoUpdater`。应用发版后，用户无法感知或获取新版本。

本设计实现完整的更新检查链路：

1. **自动检查**：应用启动后延迟首检，之后定时复查。
2. **TitleBar 提示**：左侧最右边一个 `[Update]` 按钮，随更新状态变化；下载完成后变绿色，点击安装并重启。
3. **应用菜单**：新增原生应用菜单，包含「检查更新」项。
4. **设置页「关于」**：新增子页，展示应用简介 + 完整的检查更新入口。

## 关键约束与决策

| 决策点 | 选择 | 原因 |
|---|---|---|
| 更新来源 | GitHub Releases（electron-updater） | 官方标准方案，构建产物自动产 `latest.yml` |
| 平台策略 | **混合**：win/linux 全自动 + mac 手动装 | 无 Apple 证书，mac 上 `autoUpdater` 无法静默下载安装（强制要求代码签名） |
| 检查时机 | 启动延迟 8s 首检 + 每 4 小时复查 | 覆盖长时间不关应用场景 |
| 下载态 UI | 同一按钮随状态变（检查→下载中→完成） | 单一状态机，三处入口共享 |

**macOS 签名限制说明**：`autoUpdater` 下载的更新包由 Apple 更新框架校验签名，未签名 app 在打包运行时 `checkForUpdates()` 会抛错拒绝下载。因此 mac 不走 `autoUpdater` 的下载，改为 fetch `latest-mac.yml` 比对版本，发现新版本后下载 dmg 到本地并用 `shell.openPath` 自动打开，用户拖拽安装。Windows/Linux 不要求签名，走完整自动流程。

## 架构总览

```
主进程 UpdateManager                IPC                渲染端 store (updateStatus)
autoUpdater / github fetch ──► emit('update:state') ──► reducer UPDATE_STATUS ──► TitleBar 按钮 / 关于页
                                                          ▲
用户点[检查更新]/菜单项 ──► invoke('update:check') ──► UpdateManager.checkNow()
用户点[Update 重启]    ──► invoke('update:install')──► autoUpdater.quitAndInstall()
mac 用户点[下载并打开] ──► invoke('update:download-and-open') ──► UpdateManager.downloadDmgAndOpen()
```

新增模块：`src/main/update-manager.ts`。`UpdateManager` 不直接持有 `webContents`，通过注入的 `emit` 回调转发状态（避免主窗口刷新时引用失效，沿用 `PtyManager.setWebContents` 同类解耦思路）。

## 第 1 节 — 更新状态机与数据流

渲染端唯一数据源，存在 reducer 里（全局单例态，非按 session 分片）：

```ts
type UpdateStatus =
  | { state: 'idle' }                                                   // 无更新或未检查
  | { state: 'checking' }                                               // 检查中
  | { state: 'available'; version: string }                             // 有新版本
  | { state: 'downloading'; percent: number }                           // 下载中 0-100
  | { state: 'ready'; version: string }                                 // 下载完成，待安装
  | { state: 'error'; message: string }                                 // 失败
```

平台差异：
- `available` 态：win/linux 因 `autoDownload=true` 瞬间进 `downloading`；mac 停留 `available`，点击触发 dmg 下载。
- `ready` 态：仅 win/linux 到达（mac 走 `available`→手动下载，不经过 `ready`）。

## 第 2 节 — 主进程 UpdateManager 模块

`src/main/update-manager.ts`，职责单一：封装 `autoUpdater` + 平台分流 + 事件转发。

```ts
import { autoUpdater } from 'electron-updater'
import { app, shell } from 'electron'

const SUPPORTS_AUTO = process.platform === 'win32' || process.platform === 'linux'
const CHECK_INTERVAL = 4 * 60 * 60 * 1000  // 4 小时复查
const STARTUP_DELAY  = 8 * 1000            // 启动后 8s 再首次检查

export class UpdateManager {
  private status: UpdateStatus = { state: 'idle' }
  private timer?: NodeJS.Timeout
  private emit: (s: UpdateStatus) => void = () => {}

  constructor(opts: { repo: string }) {           // repo = 'mrhuangyong/cc-desk'
    if (SUPPORTS_AUTO) {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnQuit = false       // 不在退出时静默装，等用户点
      this.bindAutoUpdaterEvents()
    }
  }

  setEmit(fn: (s: UpdateStatus) => void) { this.emit = fn }
  sendCurrentState() { this.emit(this.status) }   // 窗口刷新后重发当前态

  startAutoCheck() {
    setTimeout(() => this.checkNow(), STARTUP_DELAY)
    this.timer = setInterval(() => this.checkNow(), CHECK_INTERVAL)
  }

  dispose() { if (this.timer) clearInterval(this.timer) }
}
```

**`checkNow()` 平台分流**：

- **win/linux**：
  ```
  setStatus({ state: 'checking' })
  autoUpdater.checkForUpdates().catch(e => setStatus({ state: 'error', message: String(e) }))
  // 由 bindAutoUpdaterEvents 接管：
  //   'update-available'    → { state: 'available', version } → autoDownload 自动进 downloading
  //   'download-progress'   → { state: 'downloading', percent: p.percent }
  //   'update-downloaded'   → { state: 'ready', version }
  //   'update-not-available'→ { state: 'idle' }
  //   'error'               → { state: 'error', message }
  ```
- **mac（无签名）**：不调 `autoUpdater`，fetch latest-mac.yml 比对：
  ```
  setStatus({ state: 'checking' })
  try {
    const meta = await fetchLatestMacYml('mrhuangyong/cc-desk')  // GitHub raw latest-mac.yml
    if (semverGt(meta.version, app.getVersion()))
      setStatus({ state: 'available', version: meta.version })
    else
      setStatus({ state: 'idle' })
  } catch (e) { setStatus({ state: 'error', message: String(e) }) }
  ```

**`install()`**：仅 `ready` 态调用 `autoUpdater.quitAndInstall()`。

**`downloadDmgAndOpen()`**（mac）：
```
1. 从 latest-mac.yml 读出 dmg asset 名 + version
2. 下载 https://github.com/<repo>/releases/download/v<version>/<asset> 到 app.getPath('downloads')
3. shell.openPath(dmgPath) → Finder 挂载 dmg，用户拖拽安装
4. 状态保持 available（不走 quitAndInstall）
失败 → setStatus({ state: 'error', message })
```

**关键设计点**：
1. **`app.isPackaged` 短路**：dev 下 `checkNow` 直接置 `idle` + `console.warn`，避免开发态报错。
2. **emit 解耦**：`index.ts` 用 `win.webContents.send('update:state', s)` 作为 emit；窗口重建时 `setEmit` 重绑 + `sendCurrentState()`。
3. **错误吞噬**：`error` 态进状态机，TitleBar 静默不渲染，仅「关于」页可见 + 可重试。联网失败不打扰式 dialog。

## 第 3 节 — IPC 契约与 preload 注册

遵循项目约定（`preload/index.ts` 是唯一桥；主→渲染事件必须可 unsubscribe，沿用 `onArchiveTick` / `backendTask.onEvent` 模式）。

**`src/preload/index.ts` 新增 `update` 命名空间**：
```ts
update: {
  onState: (cb: (s: UpdateStatus) => void) => {
    const channel = 'update:state'
    const handler = (_: unknown, s: UpdateStatus) => cb(s)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  downloadAndOpen: () => ipcRenderer.invoke('update:download-and-open'),
},
```

**`src/main/index.ts` 注册**：
```ts
const updateManager = new UpdateManager({ repo: 'mrhuangyong/cc-desk' })
updateManager.setEmit((s) => win.webContents.send('update:state', s))

ipcMain.handle('update:check', () => updateManager.checkNow())
ipcMain.handle('update:install', () => updateManager.install())
ipcMain.handle('update:download-and-open', () => updateManager.downloadDmgAndOpen())

// 关于页展示版本号用（轻量，非更新链路）
ipcMain.handle('app:version', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}))

app.whenReady().then(() => {
  // ... 现有逻辑
  updateManager.startAutoCheck()
})

// did-finish-load 已有 claude.reattachRunningSessions，同处加：
win.webContents.on('did-finish-load', () => {
  updateManager.setEmit((s) => win.webContents.send('update:state', s))
  updateManager.sendCurrentState()
})

// before-quit 加 dispose（与 ptyManager.killAll 并列）
updateManager.dispose()
```

刷新兜底：`sendCurrentState()` 让刷新后的渲染端按钮立即恢复正确态，不等下次状态变更。

## 第 4 节 — 渲染端 store + TitleBar 按钮 + 应用菜单

**4.1 store 改动**（`src/renderer/state/`）

`AppState` 加 `updateStatus: UpdateStatus`（初始 `{ state: 'idle' }`）；reducer 加 `UPDATE_STATUS`：
```ts
case 'UPDATE_STATUS': return { ...state, updateStatus: action.status }
```
订阅放 `App.tsx` 单次挂载（防抖保存旁），cleanup 调 preload 返回的 unsubscribe。

**4.2 TitleBar 按钮**（`TitleBar.tsx`）

位置：红绿灯预留 → 折叠按钮 → (折叠态入口) → **[UpdateButton 插这里]** → 项目名（"左侧最右边"）。

单组件 `UpdateButton`，按 `state.updateStatus.state` 渲染：

| status.state | 显示 | 行为 |
|---|---|---|
| `idle` / `checking` | 不渲染 | — |
| `available` | `[Update]` 中性色 | win/linux：不可点（已 autoDownload）；mac：点击 `downloadAndOpen()` |
| `downloading` | `↓ 45%` + 内联进度条 | 不可点 |
| `ready` | `[Update]` **绿色背景** | 点击 `install()` → quitAndInstall |
| `error` | 不渲染（静默） | — |

样式用项目 CSS 变量；`WebkitAppRegion: 'no-drag'`（按钮可点）。

**4.3 应用菜单**（`src/main/index.ts` 新增 `Menu.setApplicationMenu`）

目前无原生菜单。新增最小菜单：
- **mac**：应用菜单下加「检查更新」→ `updateManager.checkNow()`，并补标准 Edit 菜单（Cmd+C/Cmd+V，否则 mac 上失效——Electron 已知坑）。
- **win/linux**：「帮助」菜单下加「检查更新」。

```ts
const isMac = process.platform === 'darwin'
const template: Electron.MenuItemConstructorOptions[] = isMac
  ? [{ role: 'appMenu', submenu: [
      { label: '检查更新', click: () => updateManager.checkNow() },
      { type: 'separator' },
      { role: 'quit' }
    ]},
     { role: 'editMenu' }]   // 标准剪切复制粘贴
  : [{ label: '文件', submenu: [{ role: 'quit' }] },
     { label: '帮助', submenu: [
       { label: '检查更新', click: () => updateManager.checkNow() },
       { role: 'about' }
     ]}]
Menu.setApplicationMenu(Menu.buildFromTemplate(template))
```

范围控制：只加必需项，不顺手大改。

## 第 5 节 — 设置页「关于」子页 + 错误处理 + 测试

**5.1「关于」子页**

- `SettingsSection` 加成员 `'about'`；`SettingsMenu` ITEMS 末尾（`archived` 之后）加项；i18n 双语 `settings.about`。
- 新建 `src/renderer/components/settings/AboutSettings.tsx`：
  - **静态信息**：应用名、版本号（经轻量 IPC `app:version` 取 `app.getVersion()` 及 electron/chrome/node 版本）、简要介绍文案、指向仓库的外链（经 `setWindowOpenHandler` 走系统浏览器）。
  - **检查更新**：复用全局 `state.updateStatus`：
    - `idle` → `[检查更新]` → `update.check()`
    - `checking` → `[检查中…]`（禁用）
    - `available` → "发现新版本 vX.Y.Z" + mac `[下载并打开]` / win/linux `[下载中…]`
    - `downloading` → 进度条
    - `ready` → `[立即重启安装]`（绿色）→ `update.install()`
    - `error` → 红字错误信息 + `[重试]`

「关于」页是更新状态的完整可视化入口，TitleBar 保留轻量提示，二者共享同一 store 字段。

**5.2 错误处理边界**

| 场景 | 行为 |
|---|---|
| dev 模式 | `checkNow` 直接 `idle` + warn，不发 error |
| 网络失败/GitHub 不可达 | `error` 态；TitleBar 静默；关于页显示错误+重试 |
| mac latest-mac.yml fetch 失败 | 同上 |
| mac dmg 下载失败 | `error` 态 + 关于页可重试 |
| autoUpdater 本身抛错 | catch → `error` 态，不崩主进程 |
| 用户在 `ready` 不点重启 | 不强制；`autoInstallOnQuit=false` 不静默装 |

**5.3 测试**（vitest，遵循项目约定）

- `tests/update-manager.test.ts`（node 环境）：mock `electron-updater` 的 `autoUpdater`，验证 win/linux 事件→状态映射；mock `fetch` 验证 mac 版本比对（新版→available、相同→idle、fetch 失败→error）；验证 dev 短路。不触网，用 `vi.fn()` + fixture。
- `tests/reducer.test.ts`：`initialState()` 加 `updateStatus` 全字段构造 + 一个 `UPDATE_STATUS` 用例。
- `i18n-completeness.test.ts`：自动覆盖新增 `settings.about` 等 key（zh/en 对齐）。
- `tests/about-settings.test.tsx`：mock `window.api.update`，验证各状态按钮文案与点击分发。
- UpdateManager 无落盘，无需隔离 HOME。

**5.4 依赖与构建配置改动**（`package.json`）

```jsonc
// dependencies 新增
"electron-updater": "^6.x"

// build.publish 新增
"publish": [{ "provider": "github", "owner": "mrhuangyong", "repo": "cc-desk" }]
```

发布流程（`pnpm build` 后 `electron-builder --publish always` 推到 Releases）属 CI/发布动作，**不在本次实现范围**，仅在此记一笔。

## 影响范围清单

| 文件 | 改动 |
|---|---|
| `src/main/update-manager.ts` | 新建 |
| `src/main/index.ts` | 实例化 UpdateManager + 注册 3 个 IPC + 应用菜单 + did-finish-load 重绑 + before-quit dispose |
| `src/preload/index.ts` | 新增 `update` 命名空间（onState/check/install/downloadAndOpen）+ `app:version` |
| `src/renderer/types.ts` | `SettingsSection` 加 `'about'` |
| `src/renderer/state/` | `updateStatus` 字段 + `UPDATE_STATUS` action + 初始值 |
| `src/renderer/App.tsx` | 订阅 `update.onState` 单次挂载 |
| `src/renderer/components/TitleBar.tsx` | 新增 `UpdateButton` |
| `src/renderer/components/settings/AboutSettings.tsx` | 新建 |
| `src/renderer/components/settings/SettingsPage.tsx` | switch 加 `about` 分支 |
| `src/renderer/components/settings/SettingsMenu.tsx` | ITEMS 加 about |
| `src/renderer/i18n/index.ts` | 双语新增 `settings.about` 等文案 |
| `package.json` | `electron-updater` 依赖 + `build.publish` |
| `tests/` | update-manager / reducer / about-settings 测试 |

## 非目标

- 不做发布 CI 自动化（手动 `electron-builder --publish`）。
- 不做代码签名（mac 全自动热更新留待具备 Apple Developer ID 后接入，届时填 `CSC_LINK` 等环境变量切换）。
- 不做增量更新通道（beta/stable 分流）。
- 不大改现有应用菜单结构。
