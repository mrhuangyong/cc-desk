# 渲染性能优化设计：流式卡顿 + 长会话 DOM 爆炸

> 日期：2026-06-29
> 状态：已通过头脑风暴，待用户审阅 → 转入实现计划
> 目标：消除桌面端使用中的卡顿（流式输出、长会话、重组件多开、切换启动）

## 背景与根因

cc-desk 是以**流式对话为核心**的 Electron 应用。桌面端在四个场景出现明显卡顿：
1. 对话流式输出时（尤其长回答 / 带代码 / 带 mermaid）
2. 长会话 / 历史消息浏览、切换 tab
3. Monaco / 终端 / 浏览器多 tab 同时运行
4. 启动 / 切换项目会话粘滞

经代码勘察，确认根因集中在**渲染层**（非数据流、非持久化、非 SDK 桥接）：

- **流式增量无节流**：`claude:delta` 每个 token 直达 `STREAM_DELTA` reducer，长回答时每秒上百次 dispatch，每次新建整个 state。
- **单一 Context 全应用订阅**：`useStore()` 返回整个 `{state, dispatch}`，任何切片变化（含 `streamingBySession`）触发所有 consumer 重渲——流式时文件树、Monaco、设置页、tab 全部无效重渲。`ChatArea` 注释自承「在每个 STREAM_DELTA 重渲染」。
- **消息项无 memo**：`renderBlocks(...)` 是普通函数调用，历史消息行不是 memo 组件，ChatArea 每次重渲都让 N 条历史消息重跑 markdown/代码块渲染。
- **消息列表无虚拟化**：`package.json` 无 `react-virtuoso` / `react-window` / `@tanstack/react-virtual`，消息全量挂载 DOM，长会话 1000 条 = 1000 个重组件节点。

## 不动的边界（明确）

四层优化**全部在渲染层与 Context 分发层**，以下不碰：
- reducer 数据流逻辑（收到的仍是 `STREAM_DELTA`，仅频率降低）
- 持久化（`projects:save` / `projects.json` / hydrate）
- IPC 通道契约与 SDK 桥接（`ClaudeService` / `SessionQueryManager` / `PushController`）
- 主进程全部逻辑

## 整体架构：四层叠加

每层独立见效、可独立回退。新增依赖仅两个成熟库：`react-virtuoso`、`use-context-selector`。

```
层 1 · 流式节流    token 不再直达 reducer (rAF 批合并 → 单次 dispatch)
层 2 · 分片订阅    切断「token 增量 → 全应用重渲」(use-context-selector)
层 3 · 消息项 memo  ChatArea 重渲时未变消息行跳过 (React.memo)
层 4 · 列表虚拟化   长会话只挂载可见消息 DOM (react-virtuoso)
```

**场景覆盖**：
- 场景 1（流式卡）← 层 1 + 层 2 + 层 3
- 场景 2（长会话卡）← 层 4 根治，层 3 辅助
- 场景 3（重组件多开）← 层 2 切断无效重渲
- 场景 4（切换启动）← 层 2 + 层 4 降低挂载量与重算

## 层 1：流式节流（batching delta）

在 `preload` → `dispatch` 之间加一层 **rAF 批合并**。用临时缓冲区累积同一帧内所有 delta，下一 `requestAnimationFrame` 回调里合并成**一次** `STREAM_DELTA` dispatch。

- 同一帧内 `text` / `thinking` 混合时分别按 kind 合并（buffer 按 `sessionId + kind` 分桶）。
- 上限 60 次/秒；16ms 内人类感知不到延迟，但 reducer 压力骤降。
- **后台保底**：页面失焦时 rAF 暂停，加 `setTimeout(16ms)` fallback flush，保证后台流式不堆积（与现有「后台任务跨轮存活」设计一致）。
- **中断正确性**：`claude:stop` / `claude:aborted` / `claude:result` 到达时**立即同步 flush** buffer 再处理终态，避免丢失末尾输出。

实现位置：渲染端新增 `useStreamBatcher` hook（订阅 `claude:delta`）或改 `App.tsx` 事件监听处。**reducer 不变**，仅 dispatch 频率降低。

## 层 2：分片订阅（use-context-selector）

把 `StoreContext` 从 React 原生 `createContext` 换成 `use-context-selector` 的 `createContext`，组件用 `useSelector(ctx, selector)` 只取关心的切片：

```tsx
// 之前：订阅全部 state
const { state } = useStore()
const session = state.projects.find(...)

// 之后：只订阅所需切片
const activeSessionId = useSelector(store, s => s.activeSessionId)
const session = useSelector(store, s => findSession(s, activeSessionId))
```

- `useSelector` 默认 `Object.is` 浅比，selector 返回值不变就不重渲。
- `dispatch` 引用永不变化，单独暴露或用 `useSelector(store, s => s)` 取。
- **渐进迁移**：保留 `useStore()` 作为兼容入口（内部取全 state），不强制一次改完。先改高频组件（`ChatArea` / `InputBar` / `MessageRow`），其余按需。

**收益**：流式时只有真正读 `streamingBySession` 的组件（流式区、子代理面板）重渲，文件树 / Monaco / 设置页 / tab 全部静默。

## 层 3：消息项 React.memo

抽出 `MessageRow` 组件，用 `React.memo` 包裹：

```tsx
const MessageRow = React.memo(function MessageRow({ message, subagentOutput, ... }: RowProps) {
  return <div className="msg-row">{renderBlocks(message.content, ...)}</div>
}, arePropsEqual)
```

**稳定 props 引用是关键**：
- `message` 引用稳定（reducer 里历史消息不随流式变化，仅最后一条草稿变）。
- `subagentOutput` 等派生数据在 `ChatArea` 已用 `useMemo` 算好（现状如此），传引用而非让每行自算。
- `arePropsEqual` 浅比 `message` + `subagentOutput` 引用兜底。

**收益**：流式时 ChatArea 重渲，N-1 条历史消息 memo 命中跳过，仅最后一条草稿（流式增量）真正重渲。

## 层 4：消息列表虚拟化（react-virtuoso）

用 `Virtuoso` 替换当前消息列表容器：

```tsx
<Virtuoso
  data={messages}                     // 完整消息数组（含流式草稿）
  followOutput={isAtBottom ? 'smooth' : false}  // 流式吸底，用户上滑后停止
  atBottomStateChange={setAtBottom}
  itemContent={(index, msg) => <MessageRow message={msg} ... />}
/>
```

### 流式草稿采用方案 (A)：统一进列表

流式增量拼在 `streamingBySession`（草稿态），合并进 `data` 尾部作为最后一项，跟随列表一起虚拟化。`followOutput` 正确处理它。草稿频繁更新（层 1 节流后 60fps）仅影响列表最后一项，配层 3 memo 历史消息不受波及。

### auto-scroll 迁移（现有成熟逻辑 → virtuoso 原语）

现有 `ChatArea` 已有完整 scroll 逻辑（`isAtBottomRef` + 阈值 + 上滑停止 + 切会话贴底 + 面板弹出滚底），思路直接迁移：

| 现有逻辑 | virtuoso 对应 |
|---|---|
| `isAtBottomRef` + 阈值检测 | `atBottomStateChange` 回调 |
| 流式时若在底部则跟随 | `followOutput={isAtBottom ? 'smooth' : false}` |
| 切会话立即贴底 | `ref.scrollToIndex({ alignment: 'end' })` 于 `useEffect([sessionId])` |
| 面板弹出滚底（AskUserQuestion / 权限 / 计划卡片） | 同 `scrollToIndex`，延迟一帧 |
| 「回到底部」按钮 | `ref.scrollToIndex({ alignment: 'end' })` |

### 保底——虚拟化不影响的功能

已勘察确认：
- `SearchDialog` 只搜会话名 / 命令，**不遍历消息 DOM** → 不受影响。
- 代码块复制 / 应用到文件在可见区正常，无批量扫全部消息的依赖 → 不受影响。
- 无「导出 / 复制全部对话」遍历 DOM 的功能（导出走 state 数据）→ 不受影响。

## 风险控制

### 已识别高危暗坑 + 规避

| 风险 | 触发条件 | 规避 |
|---|---|---|
| 节流丢末尾 | 流式结束 / 中断时 buffer 有未 flush delta | `result` / `aborted` / `stop` 到达时同步 flush 再处理终态 |
| 节流后台暂停 | 页面失焦 rAF 暂停，后台流式堆积 | `setTimeout(16ms)` fallback flush |
| 草稿与正式消息重叠 | 草稿进列表，`STREAM_ASSISTANT_BLOCKS` 校正时草稿→正式切换瞬间闪现双份 | reducer 已有 `_seenUuids` 去重；切换时**先移除草稿再 push 正式消息**，同一 uuid 只存一份 |
| memo 命中失败 | props 传内联对象 / 函数（每次新引用） | 派生数据走 `useMemo` / `useCallback`；`arePropsEqual` 浅比兜底 |
| virtuoso 高度抖动 | markdown 含 mermaid / 代码块异步渲染，高度变化致滚动跳动 | 启用 virtuoso 动态高度测量（默认开启）；mermaid 用现有固定占位策略，渲染后不改已滚动位置 |
| auto-scroll 迁移漏 case | 5 种 scroll 场景逐一迁移 | 见回归清单，每条对应用例 |
| 草稿态 isAtBottom 误判 | 草稿变长撑高，`atBottomStateChange` 误判离开底部中断跟随 | `followOutput` 函数形态由 ref 状态驱动，非草稿高度 |

### 回归测试清单

**reducer 层**：
- [ ] 节流 flush 后 `STREAM_DELTA` 内容与逐条 dispatch 一致
- [ ] `claude:aborted` 到达时 buffer 已 flush（不丢末尾）
- [ ] 草稿→正式消息切换无重复 uuid（去重正确）

**组件层**：
- [ ] `MessageRow` memo：props 不变时不重渲（render counter 验证）
- [ ] 分片订阅：`streamingBySession` 变化时，未订阅切片的组件不重渲

**虚拟化交互**（手动 + 关键自动化）：
- [ ] 流式追加时自动吸底（用户在底部）
- [ ] 用户上滑后流式不强制拉回
- [ ] 切换会话立即贴底
- [ ] AskUserQuestion / 权限 / 计划卡片弹出滚到底
- [ ] 「回到底部」按钮显隐正确
- [ ] 长会话（200+ / 1000 条）滚动流畅、首屏快

**现有功能冒烟**：
- [ ] SearchDialog 搜索会话 / 命令正常
- [ ] 代码块复制 / 应用到文件正常
- [ ] 持久化 / 重启 hydrate 正常（草稿不误持久化）

### 实施顺序（降低爆炸半径）

每步可独立验证、可独立回退：

1. **层 3（memo）** —— 最小改动、零新依赖、立竿见影。验证后继续。
2. **层 1（节流）** —— 独立模块，不动现有结构。验证 flush 正确性。
3. **层 2（分片订阅）** —— `useStore` 保留兼容，渐进迁移高频组件。验证未订阅组件不重渲。
4. **层 4（虚拟化）** —— 最大改动放最后；此时 1-3 已大幅降低流式与重渲压力，虚拟化专注解决长会话 DOM。

每步之间跑 `pnpm test` + 手动流式验证，任一步回归即停在当步排查，不累积。

## 验收标准

- 流式长回答（带代码 / mermaid）输入框和滚动无明显掉帧（主观对比优化前）
- 1000 条消息会话滚动流畅、切会话无明显停顿
- 回归清单全部通过，`pnpm test` 全绿（含新增用例）
- 现有功能冒烟无回归

## 新增依赖

- `react-virtuoso` —— 聊天 / 信息流专用虚拟化，内置 followOutput + 动态高度
- `use-context-selector` —— Context 分片订阅，切断全应用重渲
