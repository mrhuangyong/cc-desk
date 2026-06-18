# 左侧会话列表：排序 + 时间显示 + 默认折叠

> 日期：2026-06-18
> 状态：已确认

## 概述

左侧 ProjectTree 中的会话列表增加三项改进：
1. **按时间倒序排列**（激活会话置顶）
2. **每条会话右侧显示时间标签**（hover 切换为删除按钮）
3. **默认只显示最近 5 条**（可展开/折叠）

## 改动文件

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/renderer/utils/formatSessionTime.ts` | **新建** | 时间格式化纯函数 |
| `src/renderer/components/ProjectTree.tsx` | **修改** | 排序、时间显示、折叠展开逻辑 |

`LeftPanel.tsx` 和 `reducer.ts` 无需改动。

---

## 一、时间格式化工具

### 文件：`src/renderer/utils/formatSessionTime.ts`

```ts
export function formatSessionTime(updatedAt: number): string
```

### 格式化规则

| 条件 | 输出 | 示例 |
|------|------|------|
| 今天（与本地日期同一天） | `HH:mm` | `14:30` |
| 昨天（本地日期减一天） | `昨天` | `昨天` |
| 2–30 天前 | `n天` | `3天`、`15天` |
| 超过 30 天 | `MM-DD` | `06-11`、`12-03` |
| `updatedAt` 为 `undefined / 0` | `""`（空字符串） | 新会话无活动记录 |

### 实现要点

- 比较 `new Date(updatedAt)` 与 `new Date()` 的日历日期差
- 纯函数，无副作用，可独立单元测试
- 使用本地时区，与用户系统时间一致

---

## 二、会话排序规则

在 `ProjectTree` 渲染每个项目时，用 `useMemo` 对 `project.sessions` 排序。

### 排序优先级

1. **当前激活会话**（`state.activeSessionId === session.id`）→ 始终排在第一位
2. **其余会话** → 按 `updatedAt` 倒序排列（最新的在前）
3. `updatedAt` 为 `0 / undefined` 的会话排在末尾

搜索过滤（`treeFilter`）在排序之后应用，保持排序结果。

### 伪代码

```ts
const sortedSessions = useMemo(() => {
  const filtered = q ? project.sessions.filter(s => s.title.toLowerCase().includes(q)) : project.sessions
  return [...filtered].sort((a, b) => {
    if (a.id === activeSessionId) return -1
    if (b.id === activeSessionId) return 1
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
}, [project.sessions, activeSessionId, q])
```

---

## 三、默认 5 条 + 展开/折叠

### 状态管理

```ts
// ProjectTree 内部局部 state
const [expandedSessionCounts, setExpandedSessionCounts] = useState<Set<string>>(new Set())
```

- Key = `project.id`，存在表示该项目已展开全部会话
- 纯 UI 临时状态，不持久化
- 与现有的 `expandedProjects`（项目级展开/折叠）独立，互不干扰

### 显示逻辑

对于每个项目的排序后会话列表：

```ts
const MAX_VISIBLE = 5
const expanded = expandedSessionCounts.has(project.id)
const total = sortedSessions.length
const visible = expanded ? sortedSessions : sortedSessions.slice(0, MAX_VISIBLE)
const hidden = total - visible.length
```

- `total ≤ 5`：全部显示，不出现展开按钮
- `total > 5`：默认显示前 5 条，底部出现 `+ 展开更多 (N)` 按钮
- 点击展开后，按钮文字变为 `收起`

### 展开按钮

```
+ 展开更多 (3)   ← 默认，N = 剩余会话数
收起              ← 已展开
```

- 按钮位置：该项目所有可见会话的最后一行下方
- 样式：左对齐，与项目行对齐，小号字体，颜色 `var(--text-muted)`
- 点击回调中设置 / 清除 `expandedSessionCounts` 中的 `project.id`

### 搜索过滤行为

- 搜索时仍应用 5 条默认限制和展开逻辑
- 过滤后结果 ≤ 5 条 → 不出现展开按钮
- 过滤后结果 > 5 条 → 照常显示展开按钮
- 搜索词变化时 `expandedSessionCounts` 不重置（保持用户上次的展开选择）

---

## 四、会话行右侧：时间 ⇄ 删除按钮切换

### 视觉效果

```
默认状态：        [●] 💬 会话标题          14:30
hover 状态：      [●] 💬 会话标题          🗑
```

- 时间标签和删除按钮**重叠定位**在同一位置
- 默认：时间 `opacity: 1`，删除按钮 `opacity: 0`
- hover：时间 `opacity: 0`，删除按钮 `opacity: 1`
- 通过 CSS `transition: opacity .15s` 实现平滑切换

### 实现

在现有会话行结构基础上，右侧区域改为：

```tsx
<span style={{ position: 'relative', ... }}>
  <span style={{ opacity: hoveredSession === session.id ? 0 : 1, transition: 'opacity .15s' }}>
    {formatSessionTime(session.updatedAt ?? 0)}
  </span>
  <span style={{
    position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
    opacity: hoveredSession === session.id ? 1 : 0, transition: 'opacity .15s',
    pointerEvents: hoveredSession === session.id ? 'auto' : 'none',
  }}>
    <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_SESSION', ... })} />
  </span>
</span>
```

### 现有删除按钮

当前删除按钮在行右侧，使用 `opacity: hovered ? 1 : 0` 控制显隐。改动后删除按钮仍保留，只是多了时间标签与其切换。

---

## 五、边界情况总览

| 场景 | 行为 |
|------|------|
| 新会话（无 `updatedAt`） | 时间显示空字符串；排序排在末尾 |
| 仅 1 条会话 | 不出现展开按钮 |
| 激活会话不在最近 5 条中 | 激活置顶 + 最近 4 条 = 显示 5 条 |
| 搜索过滤后结果 ≤ 5 条 | 不出现展开按钮 |
| 搜索过滤后结果 > 5 条 | 默认 5 条 + 展开按钮 |
| 删除会话 | 删除后重新计算，若总数降到 ≤ 5 则展开按钮消失 |
| 项目折叠/展开（expandedProjects） | `expandedSessionCounts` 不受影响 |
| 切换激活会话 | 排序立即响应，新激活会话置顶 |

---

## 六、不做的

- 不持久化展开/折叠状态（纯浏览行为）
- 不改 `AppState` / `reducer`
- 不添加排序切换按钮（恒定倒序）
- 不影响 `LeftPanel.tsx` props 接口
