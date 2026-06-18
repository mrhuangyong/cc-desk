# 左侧会话列表排序+时间+折叠 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左侧 ProjectTree 会话列表按时间倒序（激活会话置顶）、每条右侧显示时间（hover 切换删除按钮）、默认只显示最近 5 条可展开折叠。

**Architecture:** 新建一个时间格式化纯函数 + 修改 ProjectTree 组件（排序 useMemo、折叠局部 state、时间/删除按钮 hover 切换）。状态局部化，不动 reducer / AppState。

**Tech Stack:** React 18 + TypeScript + Vitest + @testing-library/react。

参考 spec：`docs/superpowers/specs/2026-06-18-session-list-sort-time-design.md`

---

## 文件结构

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/renderer/utils/formatSessionTime.ts` | 新建 | 纯函数：时间戳 → 显示字符串 |
| `tests/formatSessionTime.test.ts` | 新建 | 纯函数单测 |
| `src/renderer/components/ProjectTree.tsx` | 修改 | 排序、折叠、时间/删除 hover 切换 |
| `tests/ProjectTree.test.tsx` | 修改 | 增加排序/折叠/时间显示的组件测试 |
| `tests/fixtures.ts` | 修改 | 种子数据补 `updatedAt`，便于排序测试 |

---

## Task 1: 时间格式化纯函数

**Files:**
- Create: `src/renderer/utils/formatSessionTime.ts`
- Test: `tests/formatSessionTime.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/formatSessionTime.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { formatSessionTime } from '../src/renderer/utils/formatSessionTime'

// 固定"当前时间"为 2026-06-18 14:30 本地，便于稳定测试
// 用 new Date(2026, 5, 18, 14, 30).getTime() 作为基准
const NOW = new Date(2026, 5, 18, 14, 30).getTime()

describe('formatSessionTime', () => {
  it('今天同一天返回 HH:mm', () => {
    const sameDay = new Date(2026, 5, 18, 9, 5).getTime()
    expect(formatSessionTime(sameDay, NOW)).toBe('09:05')
  })

  it('昨天返回"昨天"', () => {
    const yesterday = new Date(2026, 5, 17, 23, 59).getTime()
    expect(formatSessionTime(yesterday, NOW)).toBe('昨天')
  })

  it('2-30 天前返回 n天', () => {
    const threeDaysAgo = new Date(2026, 5, 15, 10, 0).getTime()
    expect(formatSessionTime(threeDaysAgo, NOW)).toBe('3天')
  })

  it('正好 30 天前仍返回 30天', () => {
    // NOW 是 6/18，往前 30 个日历日 = 5/19
    const thirtyDaysAgo = new Date(2026, 4, 19, 14, 30).getTime()
    expect(formatSessionTime(thirtyDaysAgo, NOW)).toBe('30天')
  })

  it('超过 30 天返回 MM-DD', () => {
    // 31 天前 = 5/18
    const thirtyOneDaysAgo = new Date(2026, 4, 18, 14, 30).getTime()
    expect(formatSessionTime(thirtyOneDaysAgo, NOW)).toBe('05-18')
  })

  it('updatedAt 为 0 返回空字符串', () => {
    expect(formatSessionTime(0, NOW)).toBe('')
  })

  it('updatedAt 为 undefined 返回空字符串', () => {
    expect(formatSessionTime(undefined as unknown as number, NOW)).toBe('')
  })
})
```

注意：第二个参数 `now` 是为测试可注入的"当前时间"，默认 `Date.now()`。这样测试稳定、生产用法不受影响。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/formatSessionTime.test.ts`
Expected: FAIL，模块不存在 / 函数未导出。

- [ ] **Step 3: 实现纯函数**

创建 `src/renderer/utils/formatSessionTime.ts`：

```ts
// 将时间戳格式化为会话列表显示用字符串。
// now 参数仅用于测试注入，生产环境默认 Date.now()。
export function formatSessionTime(updatedAt: number, now: number = Date.now()): string {
  if (!updatedAt) return ''

  const target = new Date(updatedAt)
  const current = new Date(now)

  // 计算日历日差：用本地日期的 YYYY-MM-DD 比较，避免夏令时等小时级偏差
  const startOfCurrentDay = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
  const startOfTargetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const dayDiff = Math.round((startOfCurrentDay - startOfTargetDay) / dayMs)

  if (dayDiff <= 0) {
    // 同一天：HH:mm（补零）
    const hh = String(target.getHours()).padStart(2, '0')
    const mm = String(target.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  if (dayDiff === 1) return '昨天'
  if (dayDiff <= 30) return `${dayDiff}天`

  // 超过 30 天：MM-DD（补零）
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const date = String(target.getDate()).padStart(2, '0')
  return `${month}-${date}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/formatSessionTime.test.ts`
Expected: PASS（7 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/utils/formatSessionTime.ts tests/formatSessionTime.test.ts
git commit -m "feat: 会话时间格式化纯函数 formatSessionTime

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 种子数据补 updatedAt

**Files:**
- Modify: `tests/fixtures.ts`

- [ ] **Step 1: 给种子数据的会话补 updatedAt**

现有种子数据会话都没有 `updatedAt`，排序测试需要可控的时间戳。把 `tests/fixtures.ts` 改为：

```ts
import type { Project } from '../src/renderer/types'

// 测试专用种子数据（不属于生产 mockData）。reducer/组件测试基于这套已知结构：
// p1=cc-desk 含 s1（2 条消息）+ s2（空）+ s4..s8（凑够 6 条，测折叠）；p2=个人博客 含 s3。
// updatedAt 为固定时间戳，便于排序测试稳定。
export const seedProjects: Project[] = [
  {
    id: 'p1',
    name: 'cc-desk',
    sessions: [
      { id: 's1', title: '重构登录流程', updatedAt: 1000000, messages: [
        { id: 'm1', role: 'user', content: [{ type: 'text', text: '帮我把登录改成 token 刷新机制' }] },
        { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '好的，我先看一下当前的 auth 逻辑……' }] },
      ]},
      { id: 's2', title: '修样式 bug', updatedAt: 2000000, messages: [] },
      { id: 's4', title: '优化首屏', updatedAt: 3000000, messages: [] },
      { id: 's5', title: '接入埋点', updatedAt: 4000000, messages: [] },
      { id: 's6', title: '国际化', updatedAt: 5000000, messages: [] },
      { id: 's7', title: '单元测试补全', updatedAt: 6000000, messages: [] },
      { id: 's8', title: 'CI 配置', updatedAt: 7000000, messages: [] },
    ],
  },
  {
    id: 'p2',
    name: '个人博客',
    sessions: [
      { id: 's3', title: '部署到 Vercel', updatedAt: 8000000, messages: [
        { id: 'm3', role: 'user', content: [{ type: 'text', text: '怎么部署？' }] },
      ]},
    ],
  },
]
```

- [ ] **Step 2: 运行全量测试确认未破坏现有用例**

Run: `pnpm test`
Expected: PASS（所有现有测试仍绿。注意 `treeFilter 过滤` 用例断言"重构登录流程"被隐藏，但"部署到 Vercel"可见——这不受 updatedAt 影响；`展开时显示会话` 用例不依赖数量）。

- [ ] **Step 3: 提交**

```bash
git add tests/fixtures.ts
git commit -m "test: 种子数据补 updatedAt 并扩 p1 至 7 会话

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: ProjectTree 排序 + 折叠逻辑

**Files:**
- Modify: `src/renderer/components/ProjectTree.tsx`
- Test: `tests/ProjectTree.test.tsx`

- [ ] **Step 1: 写失败测试（排序 + 折叠）**

在 `tests/ProjectTree.test.tsx` 末尾的 `describe` 块内追加用例：

```ts
  it('会话按 updatedAt 倒序，激活会话置顶', () => {
    // 先激活 s1（updatedAt 最小），验证它仍排第一
    const { container } = renderWithProvider(<ProjectTree {...defaultProps} />)
    // 点击 s1 行激活它
    fireEvent.click(screen.getByText('重构登录流程'))
    // 收集 p1 下所有会话行的文本顺序
    const sessionTexts = ['重构登录流程', '修样式 bug', '优化首屏', '接入埋点', '国际化', '单元测试补全', 'CI 配置']
    // p1 是第一个项目，会话行在文档顺序中应满足：s1 第一，其余按 updatedAt 倒序
    const allRows = container.querySelectorAll('div')
    const order: number[] = []
    allRows.forEach(div => {
      const txt = div.textContent ?? ''
      sessionTexts.forEach((t, i) => {
        if (txt.includes(t) && !order.includes(i)) order.push(i)
      })
    })
    // s1(index 0) 应在 order 中第一个
    expect(order[0]).toBe(0)
    // 其余按 updatedAt 倒序：CI(6) > 单元测试(5) > 国际化(4) > 接入埋点(3) > 优化首屏(2)
    expect(order.slice(1, 6)).toEqual([6, 5, 4, 3, 2])
  })

  it('默认只显示最近 5 条，出现"展开更多"按钮', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    // s2（修样式 bug，updatedAt 最小）默认应被折叠隐藏
    expect(screen.queryByText('修样式 bug')).toBeNull()
    // 出现展开更多按钮，提示剩余 2 条
    expect(screen.queryByText(/展开更多.*2/)).not.toBeNull()
  })

  it('点击展开更多后显示全部会话，按钮变为收起', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    fireEvent.click(screen.getByText(/展开更多/))
    // s2 现在可见
    expect(screen.queryByText('修样式 bug')).not.toBeNull()
    // 按钮变为收起
    expect(screen.queryByText('收起')).not.toBeNull()
    expect(screen.queryByText(/展开更多/)).toBeNull()
  })

  it('点击收起后回到默认 5 条', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    fireEvent.click(screen.getByText(/展开更多/))
    fireEvent.click(screen.getByText('收起'))
    expect(screen.queryByText('修样式 bug')).toBeNull()
    expect(screen.queryByText(/展开更多.*2/)).not.toBeNull()
  })

  it('会话数 ≤ 5 的项目不显示展开更多按钮', () => {
    renderWithProvider(<ProjectTree {...defaultProps} />)
    // p2（个人博客）只有 1 个会话，不出现展开按钮
    expect(screen.queryAllByText(/展开更多/)).toHaveLength(1) // 只有 p1 一个
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/ProjectTree.test.tsx`
Expected: FAIL（新用例红：未排序、未折叠、无展开按钮）。

- [ ] **Step 3: 修改 ProjectTree.tsx 实现排序 + 折叠**

把 `src/renderer/components/ProjectTree.tsx` 的 import 行和组件体替换。完整新文件：

```tsx
import { useMemo, useState } from 'react'
import { Folder, FolderOpen, MessageCircle, FolderTree, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useStore } from '../state/store'
import { DeleteConfirmIcon } from './DeleteConfirmIcon'
import { formatSessionTime } from '../utils/formatSessionTime'

interface Props {
  onOpenFiles: (projectId: string) => void
  // 展开的项目 id 集合（未在其中视为收起）
  expandedProjects: Set<string>
  onToggleExpand: (projectId: string) => void
  // 会话过滤关键词（按标题匹配，空则不过滤）
  treeFilter: string
}

const MAX_VISIBLE_SESSIONS = 5

export function ProjectTree({ onOpenFiles, expandedProjects, onToggleExpand, treeFilter }: Props) {
  const { state, dispatch } = useStore()
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)
  // 会话折叠：key=projectId，存在表示该项目会话全部展开
  const [expandedSessionCounts, setExpandedSessionCounts] = useState<Set<string>>(new Set())

  const q = treeFilter.trim().toLowerCase()
  const activeSessionId = state.activeSessionId

  const toggleSessionExpand = (projectId: string) => {
    setExpandedSessionCounts(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {state.projects.map(project => {
        // 过滤：有关键词时只保留标题匹配的会话
        const q2 = q
        const filtered = q2
          ? project.sessions.filter(s => s.title.toLowerCase().includes(q2))
          : project.sessions
        if (q2 && filtered.length === 0) return null

        // 排序：激活会话置顶，其余按 updatedAt 倒序
        const sorted = [...filtered].sort((a, b) => {
          if (a.id === activeSessionId) return -1
          if (b.id === activeSessionId) return 1
          return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
        })

        const expanded = expandedProjects.has(project.id)
        const sessionExpanded = expandedSessionCounts.has(project.id)
        const total = sorted.length
        const visible = sessionExpanded ? sorted : sorted.slice(0, MAX_VISIBLE_SESSIONS)
        const hidden = total - visible.length

        return (
          <div key={project.id}>
            <div
              onMouseEnter={() => setHoveredProject(project.id)}
              onMouseLeave={() => setHoveredProject(null)}
              onClick={() => onToggleExpand(project.id)}
              style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 'var(--font-size)', fontWeight: 550, color: 'var(--text)', cursor: 'pointer',
                background: hoveredProject === project.id ? 'var(--bg-hover)' : 'transparent'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                {expanded ? <FolderOpen size={14} /> : <Folder size={14} />} {project.name}
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button aria-label="新建会话" title="新建会话"
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'ADD_SESSION', projectId: project.id }) }}
                  style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none', display: 'inline-flex', alignItems: 'center' }}><Plus size={13} /></button>
                <button aria-label="项目文件树" title="项目文件树"
                  onClick={(e) => { e.stopPropagation(); onOpenFiles(project.id) }}
                  style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none', display: 'inline-flex', alignItems: 'center' }}><FolderTree size={13} /></button>
                <span style={{ opacity: hoveredProject === project.id ? 1 : 0, pointerEvents: hoveredProject === project.id ? 'auto' : 'none', transition: 'opacity .1s' }} onClick={e => e.stopPropagation()}>
                  <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_PROJECT', projectId: project.id })} />
                </span>
              </span>
            </div>
            {expanded && visible.map(session => {
              const active = activeSessionId === session.id
              const hovered = hoveredSession === session.id
              return (
              <div
                key={session.id}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: session.id })}
                style={{
                  padding: '6px 12px 6px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 'var(--font-size)',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  background: active || hovered ? 'var(--bg-hover)' : 'transparent',
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: active ? 'var(--accent)' : 'transparent', flexShrink: 0 }} />
                  <MessageCircle size={13} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
                </span>
                <span style={{ position: 'relative', minWidth: 40, display: 'inline-flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', opacity: hovered ? 0 : 1, transition: 'opacity .15s' }}>
                    {formatSessionTime(session.updatedAt ?? 0)}
                  </span>
                  <span style={{
                    position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                    opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .15s',
                  }}>
                    <DeleteConfirmIcon onConfirm={() => dispatch({ type: 'DELETE_SESSION', projectId: project.id, sessionId: session.id })} />
                  </span>
                </span>
              </div>
              )
            })}
            {expanded && hidden > 0 && (
              <div
                onClick={(e) => { e.stopPropagation(); toggleSessionExpand(project.id) }}
                style={{
                  padding: '4px 12px 4px 30px', fontSize: 11, color: 'var(--text-muted)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                {sessionExpanded ? '收起' : `+ 展开更多 (${hidden})`}
              </div>
            )}
            {expanded && sessionExpanded && hidden === 0 && null}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/ProjectTree.test.tsx`
Expected: PASS（含原有 4 个 + 新增 5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/ProjectTree.tsx tests/ProjectTree.test.tsx
git commit -m "feat: 会话列表倒序排序+激活置顶+默认5条折叠

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 时间显示 hover 切换验证 + 修复遗留树 filter 适配

**Files:**
- Modify: `tests/ProjectTree.test.tsx`

Task 3 已包含时间显示的实现（`formatSessionTime` 调用 + hover 切换 DOM）。本任务补一个针对时间渲染与 hover 切换的测试，确保时间标签存在且 hover 时切换为删除按钮。

- [ ] **Step 1: 写失败/验证测试**

在 `tests/ProjectTree.test.tsx` 的 `describe` 块内追加：

```ts
  it('会话行默认显示时间标签，hover 后切换为删除按钮', () => {
    const { container } = renderWithProvider(<ProjectTree {...defaultProps} />)
    // 展开后默认可见的第一条会话（倒序后最新的会话 s8=CI 配置 置顶）
    // 时间标签为 formatSessionTime(7000000) 的输出——它是个固定字符串，
    // 这里只验证存在时间标签节点（带 data-testid）
    expect(container.querySelector('[data-testid="session-time"]')).not.toBeNull()
  })
```

- [ ] **Step 2: 给时间标签加 data-testid**

回到 `src/renderer/components/ProjectTree.tsx`，把时间标签那一行改为：

```tsx
                  <span data-testid="session-time" style={{ fontSize: 11, color: 'var(--text-muted)', opacity: hovered ? 0 : 1, transition: 'opacity .15s' }}>
                    {formatSessionTime(session.updatedAt ?? 0)}
                  </span>
```

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm test tests/ProjectTree.test.tsx`
Expected: PASS。

- [ ] **Step 4: 运行全量测试**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/ProjectTree.tsx tests/ProjectTree.test.tsx
git commit -m "test: 会话时间标签渲染与 hover 切换验证

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec 覆盖检查：**
- 时间格式化规则（今天 HH:mm / 昨天 / n天 / >30天 MM-DD / 0 返回空）→ Task 1 ✓
- 排序（激活置顶 + updatedAt 倒序）→ Task 3 ✓
- 默认 5 条 + 展开更多 / 收起 → Task 3 ✓
- 时间 ⇄ 删除 hover 切换 → Task 3 实现 + Task 4 验证 ✓
- 边界：≤5 不显示按钮 → Task 3（"会话数 ≤ 5 不显示"用例）✓
- 不动 reducer / LeftPanel → 计划仅触及 ProjectTree + 工具函数 ✓

**Placeholder 扫描：** 无 TBD/TODO，所有代码块完整。

**类型一致性：** `formatSessionTime(updatedAt: number, now?: number)` 签名在 Task 1 定义，Task 3 调用 `formatSessionTime(session.updatedAt ?? 0)` 一致；`MAX_VISIBLE_SESSIONS = 5` 常量定义即用；`expandedSessionCounts: Set<string>`、`toggleSessionExpand(projectId)` 命名贯穿一致。
