# 右侧悬浮任务面板重设计

## 背景与动机

当前右侧悬浮任务面板（`BackendTaskPanel`）用 `position: absolute; right: 16; width: 280` 永久浮在对话区之上。存在三个交互问题：

1. **遮挡对话区**：即使把三个分区各自折叠成小图标，仍是在对话区右侧浮着几个小方块，占用右侧点击区域、产生视觉噪声。根级折叠（`panelFold.root`）又是个"全有或全无"开关——要么浮层完全显示，要么完全消失（需去 TitleBar 找开关），没有轻量中间态。
2. **位置钉死**：面板被钉在右上角，用户无法移动它避开正在阅读的对话内容。
3. **分区折叠冗余**：任务/子代理/后台三分区各自带折叠头，但实际用户要么看全部、要么不看，单独折叠价值低，反而增加视觉复杂度。

本次重设计把面板改造为「**一个可任意拖动的图标/面板，整体折叠，按需展开，分区有数据才显示**」。

## 目标

- **零默认遮挡体感**：折叠态只是一个可拖到角落的小图标；展开态用户自定位置，可拖到不挡对话的地方。
- **整体折叠**：去掉三分区单独折叠，折叠/展开是面板级别的一个动作。
- **位置自由 + 可记忆**：图标和面板都可任意拖动；位置是否记住由设置项控制（默认记住）。
- **分区按需显示**：有数据的分区才渲染，无数据不占位。

## 非目标

- 不改对话流内、PlanCard、子代理详情抽屉等其它悬浮元素。
- 不改任务/子代理/后台的数据来源与 reducer 数据结构（只改承载 UI）。
- 不引入宽度/高度可调（宽固定 280，高自适应）。

## 设计

### 两种形态

**折叠态**（`panelFold.root === true`，默认初始态）：
- 一个 36×36 的圆角方块，固定 `ListChecks` 图标，右上角总数徽章（任务+子代理+后台总条目数，>99 显示 `99+`，0 时无徽章）。
- 默认位于对话区右上角；可任意拖动。
- 点击图标 → 展开。

**展开态**（`panelFold.root === false`）：
- 宽度固定 280px；高度随内容自适应，上限 `calc(100vh - 96px)`，超出则内部滚动（复用现有 `.panel-scroll`）。
- 顶部一个**标题条**：左侧标题"任务"，右侧收起按钮（`ChevronRight` 或 `X`）。标题条是拖动把手。
- 标题条下方按类型分区，**每个分区是一个卡片**（保留现有 `TaskCard`/`SubagentCard`/`BackendTaskCard` 的列表渲染），但：
  - 去掉各卡片自带的折叠头（不再单独折叠）。
  - 卡片头改为**静态小标题行**（图标 + 类型名 + 计数），不可点、无展开箭头。
  - **有数据的分区才渲染**，无数据完全不显示（不占位、不留空）。
- 点收起按钮、或再点图标 → 折叠回图标态。

### 拖动与位置

- 图标和展开面板共用同一个位置坐标 `{ x, y }`（展开/折叠切换时位置不变，只是尺寸变）。
- 用新的 `useDraggable` hook 实现，参考 `useResizableWidth` 的 pointer 拖动模式：
  - `onPointerDown`（图标或标题条）记录起始坐标 + 当前位置 → 进入拖动态。
  - 全局 `pointermove` 用 ref + rAF 直接改 `transform`/`left,top`，绕过 React 逐帧渲染（跟手）。
  - `pointerup` 退出拖动态，同步最终位置到 React state。
  - 防护：`pointercancel`、指针跑出窗口（`pointerleave` on document）兜底结束；拖动期 `userSelect: none` + 临时 cursor。
- 拖动与点击区分：拖动距离 < 3px 视为点击（展开/折叠），否则视为拖动（不触发展开/折叠）。
- 位置边界：拖动时用 `clamp` 保证图标/面板始终在视口内（至少留一定边距，避免拖丢找不回）。

### 位置记忆（设置项）

新增设置项 **「记住任务面板位置」**（`rememberPanelPosition: boolean`），**默认 `true`**。

- **开启**（默认）：拖动后的 `{x, y}` 通过 `SET_SETTINGS` + `window.api.settings.save` 写入 `~/.cc-desk/settings.json`，刷新/重开/切会话都在上次位置。新增 settings 字段 `panelPosition?: { x: number; y: number }`。
- **关闭**：不读写 `panelPosition`，每次挂载回到默认右上角（`top:12, right:16` 计算出的坐标），拖动仅当前会话有效、刷新即重置。
- 从关闭切回开启时：把当前内存中的位置写入持久化。

设置项放在 **设置 → 常规**，复用 `SettingsRow` + `Toggle`，走现有 `persist(patch)` 双写模式（dispatch + IPC save）。

### TitleBar

去掉 TitleBar 右侧工具组里的 `ListChecks` 面板开关按钮（`src/renderer/components/TitleBar.tsx:190-196`）。图标本身常驻对话区，即是入口，不再需要第二个开关。相关 `taskPanelOpen` 判断与 i18n key（`title.taskPanelHide`/`title.taskPanelShow`）一并清理。

## 改动范围

### 新增

| 文件 | 内容 |
|---|---|
| `src/renderer/hooks/useDraggable.ts` | 通用 pointer 拖动 hook，参考 `useResizableWidth` 模式；返回 `{ position, dragging, onPointerDown, setPosition }`。 |
| `src/renderer/components/FoldBadge.tsx` | 已存在（上一轮新增的数量角标），折叠图标复用。 |

### 修改

| 文件 | 改动 |
|---|---|
| `src/renderer/components/BackendTaskPanel.tsx` | 改为单一图标/面板形态：用 `useDraggable` 控制定位；折叠态渲染图标按钮；展开态渲染标题条（拖把手 + 收起）+ 有数据的分区卡片。去掉内层"三分区各自折叠"的 dispatch。 |
| `src/renderer/components/TaskPanel.tsx`（TaskCard） | 去掉自带的折叠头与 `useCollapsibleHeight`，改为静态小标题行；接收新 props（不再要 `folded`/`onToggleFold`）。 |
| `src/renderer/components/SubagentCard.tsx` | 同上，去掉折叠头与折叠态图标逻辑（上一轮加的），改为静态小标题行。 |
| `src/renderer/components/BackendTaskCard.tsx` | 同上。 |
| `src/renderer/components/TitleBar.tsx` | 去掉 `ListChecks` 面板开关按钮及相关逻辑。 |
| `src/renderer/components/settings/GeneralSettings.tsx` | 新增「记住任务面板位置」Toggle。 |
| `src/renderer/types.ts` + `src/main/settings-store.ts` | `AppSettings` 加 `rememberPanelPosition: boolean`（默认 true）、`panelPosition?: { x: number; y: number }`；`withDefaults` 补齐。 |
| `src/renderer/state/reducer.ts` + `actions.ts` | `panelFold` 简化为只保留 `root: boolean`（去掉 taskCard/subagentCard/backendTaskCard）；`SET_PANEL_FOLD` 的 `panel` 收窄为 `'root'`。`SET_PANEL_POSITION` action（载荷 `{ x: number; y: number }`）用于拖动落定后写入内存 state；拖动过程本身不进 reducer（直接改 DOM），仅 pointerup 时 dispatch 一次。 |

### 可能删除

- `FoldBadge` 在折叠图标处仍用；但三个卡片里的折叠态逻辑（`folded ?` 分支、`alignSelf`、`Terminal/Bot/ListTodo` 折叠图标）整体移除。
- i18n key `title.taskPanelHide`/`title.taskPanelShow` 删除（zh-CN + en 两边）。新增设置项 i18n key。

## 数据流

```
用户拖动图标/标题条
  → useDraggable 内部 ref + rAF 直接改 DOM（跟手，不渲染）
  → pointerup → setPosition(newPos) → 组件 state 更新
  → 若 settings.rememberPanelPosition:
      dispatch SET_SETTINGS({ panelPosition: newPos }) + window.api.settings.save
    否则: 仅内存（刷新丢失）

用户点图标
  → 拖动距离 < 3px → dispatch SET_PANEL_FOLD root 切换
  → 折叠/展开切换，position 不变
```

新会话/刷新挂载时：
```
rememberPanelPosition && settings.panelPosition 存在 → 用持久化坐标
否则 → 默认右上角坐标
```

## 边界与错误处理

- **图标被拖到视口外**：拖动时 clamp 到视口内（留 8px 安全边距），不会拖丢。
- **窗口 resize 后位置失效**：挂载与窗口 resize 时，若持久化坐标超出当前视口，clamp 回视口内。
- **关闭位置记忆后旧坐标残留**：`rememberPanelPosition=false` 时不读 `panelPosition`，旧值忽略；切回 true 时用当前内存位置覆盖。
- **拖动 vs 点击**：pointermove 累计位移 < 3px 且未超过抖动阈值，pointerup 时判定为点击，触发折叠切换；否则判定为拖动，不切换。
- **有数据才显示**：三分区各自 `length === 0` 时不渲染；三分区都空时——折叠态图标无徽章，展开态显示一句"暂无任务"占位（保留展开的确定性，避免用户以为点坏了）。

## 验证

1. `npx tsc --noEmit` — 无新增类型错误。
2. `npx vitest run` — 全套不回归；reducer 测试里 `panelFold` 的 `initialState` 全字段构造需同步简化（CLAUDE.md 约定）。
3. 真机验证：
   - 折叠态图标可拖到屏幕任意位置，刷新后（默认开启记忆）位置保留。
   - 点图标展开，面板在原位置；标题条可拖动整个面板。
   - 任务/子代理/后台有数据才出现对应分区；全空时图标无徽章。
   - 设置 → 常规关闭「记住位置」，拖动后刷新回到右上角。
   - TitleBar 不再有 ListChecks 开关。

## 待决

无。全空态、拖动判定、位置记忆开关行为均已定死（见上）。
