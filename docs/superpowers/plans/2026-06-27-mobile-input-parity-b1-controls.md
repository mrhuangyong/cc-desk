# 移动端输入框对齐 — 子项目 B1:发送参数控件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在移动端 ChatPage 输入框上方渲染权限模式 + 思考强度两个原生 select 下拉,让用户能控制 Agent 行为(A 阶段协议层已通)。

**Architecture:** 纯 UI 层改动——ChatPage 解构 A 阶段预留的 4 个 props,在 footer 输入框上方加控件栏渲染两个 select,onChange 调对应 setter。无需改 App.tsx/useSessionChat/协议层(A 已铺好)。

**Tech Stack:** React + TypeScript + @testing-library/react + vitest(web 子项目)

## Global Constraints

- 权限模式选项(中文标签,逐字):`变更前确认` / `自动编辑` / `计划模式` / `完全访问`
- 思考强度选项(逐字):`low` / `medium` / `high`
- 默认值:`变更前确认` / `medium`(与 App state 默认值、桌面 InputBar 一致)
- select 用原生 `<select>`(与现有模型 select 风格统一)
- 控件栏条件渲染:仅当 onPermissionChange 或 onThinkingChange 注入时显示(向后兼容)
- 测试用 web 子项目的 vitest:工作目录在 web/ 下跑(`cd web && npx vitest run ...`)
- Conventional Commits 提交
- 思考强度 select 选项显示 `low/medium/high`(不翻译为中文)

参考 spec: `docs/superpowers/specs/2026-06-27-mobile-input-parity-b1-controls-design.md`

---

## File Structure

- Modify: `web/src/pages/ChatPage.tsx` — 顶部加 PERMISSIONS/THINKINGS 常量;解构 4 个 props;footer 内 textarea 上方加控件栏
- Modify: `web/src/styles.css` — 加 `.chat-input-controls` 和 `.param-select` 样式
- Modify: `web/src/pages/ChatPage.test.tsx` — 控件栏渲染 + onChange 测试

无需改: `web/src/App.tsx`(A 阶段已铺 state + handleSend 透传 + props 下发)、`web/src/hooks/useSessionChat.ts`、协议层。

---

## Task 1: ChatPage 渲染权限/思考控件 + 接 onChange

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`(顶部常量 + 解构 + footer 控件栏)
- Modify: `web/src/styles.css`(加 `.chat-input-controls` / `.param-select`)
- Test: `web/src/pages/ChatPage.test.tsx`

**Interfaces:**
- Consumes: A 阶段在 ChatPageProps 预留的 4 个可选 props:`currentPermission?: string` / `currentThinking?: 'low'|'medium'|'high'` / `onPermissionChange?: (permission: string) => void` / `onThinkingChange?: (thinking: 'low'|'medium'|'high') => void`
- Produces: 无(B1 是 UI 终点,无下游消费者)

- [ ] **Step 1: 写失败测试 — 控件栏渲染 + 选中值**

在 `web/src/pages/ChatPage.test.tsx` 末尾(`describe('ChatPage - 进入会话自动滚动', ...)` 块之后,文件末尾)追加新 describe 块:

```typescript
describe('ChatPage - 发送参数控件(权限/思考)', () => {
  const baseProps = {
    title: 't', messages: [], running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('传入 setter 时渲染权限/思考两个 select,选中值正确', () => {
    render(
      <ChatPage
        {...baseProps}
        currentPermission="计划模式"
        currentThinking="high"
        onPermissionChange={() => {}}
        onThinkingChange={() => {}}
      />,
    )
    const permSelect = screen.getByLabelText('权限模式') as HTMLSelectElement
    const thinkSelect = screen.getByLabelText('思考强度') as HTMLSelectElement
    expect(permSelect.value).toBe('计划模式')
    expect(thinkSelect.value).toBe('high')
    // 选项齐全
    expect(permSelect.options.length).toBe(4)
    expect(thinkSelect.options.length).toBe(3)
  })

  it('未传 currentPermission/currentThinking 时 select 用默认值(变更前确认/medium)', () => {
    render(
      <ChatPage
        {...baseProps}
        onPermissionChange={() => {}}
        onThinkingChange={() => {}}
      />,
    )
    expect((screen.getByLabelText('权限模式') as HTMLSelectElement).value).toBe('变更前确认')
    expect((screen.getByLabelText('思考强度') as HTMLSelectElement).value).toBe('medium')
  })

  it('改权限 select → 触发 onPermissionChange(新值)', () => {
    const onPermissionChange = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        currentPermission="变更前确认"
        onPermissionChange={onPermissionChange}
        onThinkingChange={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('权限模式'), { target: { value: '完全访问' } })
    expect(onPermissionChange).toHaveBeenCalledWith('完全访问')
  })

  it('改思考 select → 触发 onThinkingChange(新值)', () => {
    const onThinkingChange = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        currentThinking="medium"
        onPermissionChange={() => {}}
        onThinkingChange={onThinkingChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('思考强度'), { target: { value: 'low' } })
    expect(onThinkingChange).toHaveBeenCalledWith('low')
  })

  it('未传任何 setter 时不渲染控件栏(向后兼容)', () => {
    render(<ChatPage {...baseProps} />)
    expect(screen.queryByLabelText('权限模式')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('思考强度')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 5 个新测试 FAIL(控件栏未渲染,getByLabelText 找不到元素抛错)

- [ ] **Step 3: 实现 — ChatPage 顶部加选项常量**

在 `web/src/pages/ChatPage.tsx` 找到文件顶部的 import 区之后(约第 29 行 `}` 之后,`export interface ChatPageProps` 之前),加常量:

```typescript
/** 权限模式选项(对齐桌面 InputBar.tsx:16,中文标签经主进程 getPermissionMode 翻译)。 */
const PERMISSIONS = ['变更前确认', '自动编辑', '计划模式', '完全访问'] as const
/** 思考强度选项(对齐桌面 InputBar.tsx:17)。 */
const THINKINGS = ['low', 'medium', 'high'] as const
```

- [ ] **Step 4: 实现 — 解构 A 阶段预留的 4 个 props**

修改 `web/src/pages/ChatPage.tsx` 组件函数体的解构(约第 108-126 行),在 `onSetActiveModel,` 之后、`} = props` 之前加 4 个:

```typescript
    onSetActiveModel,
    currentPermission,
    currentThinking,
    onPermissionChange,
    onThinkingChange,
  } = props
```

- [ ] **Step 5: 实现 — footer 内 textarea 上方加控件栏**

修改 `web/src/pages/ChatPage.tsx` 的 footer(约第 300 行 `<footer className="chat-input-bar">`),在 `<div className="chat-input-wrap">` **之前**插入控件栏:

```tsx
      <footer className="chat-input-bar">
        {(onPermissionChange || onThinkingChange) && (
          <div className="chat-input-controls">
            {onPermissionChange && (
              <select
                className="param-select"
                value={currentPermission || '变更前确认'}
                onChange={(e) => onPermissionChange(e.target.value)}
                aria-label="权限模式"
              >
                {PERMISSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {onThinkingChange && (
              <select
                className="param-select"
                value={currentThinking || 'medium'}
                onChange={(e) => onThinkingChange(e.target.value as 'low' | 'medium' | 'high')}
                aria-label="思考强度"
              >
                {THINKINGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="chat-input-wrap">
```

- [ ] **Step 6: 实现 — styles.css 加控件栏样式**

在 `web/src/styles.css` 找到 `.model-select { ... }` 规则(约第 376-383 行)之后,加两条规则(参考 `.model-select` 但 `.param-select` 不限 max-width,权限选项较长):

```css
.chat-input-controls {
  display: flex; gap: 8px; align-items: center;
  padding: 0 0 6px 0; flex-wrap: wrap;
}
.param-select {
  font-size: 11px; padding: 3px 8px; border-radius: var(--r-sm);
  background: var(--bg-sunken); color: var(--text-muted);
  border: 1px solid var(--border); cursor: pointer;
  font-family: var(--font-mono);
  flex-shrink: 0; outline: none;
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 所有测试 PASS(含 5 个新测试 + 原有测试)

- [ ] **Step 8: 类型检查 + 全套回归**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

Run: `cd web && npx vitest run`
Expected: 全 PASS(确认未破坏其他测试)

- [ ] **Step 9: 提交**

```bash
git add web/src/pages/ChatPage.tsx web/src/styles.css web/src/pages/ChatPage.test.tsx
git commit -m "feat: 移动端输入框上方加权限模式/思考强度控件(对齐桌面端)

ChatPage 渲染两个原生 select,接 A 阶段预留的 props(setter 来自 App state)。
权限 4 项(变更前确认/自动编辑/计划模式/完全访问)+ 思考 3 档(low/medium/high),
默认值与桌面 InputBar 一致。A 阶段协议层已透传 permission/thinking,本任务让其
变成用户可操作能力。条件渲染(未传 setter 不显示)向后兼容。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 输入框上方控件栏 — Task 1 Step 5
- ✅ 两个原生 select(权限/思考) — Task 1 Step 5
- ✅ 选项完全照搬桌面(权限4项/思考3档) — Task 1 Step 3 常量 + Step 5 渲染
- ✅ 默认值 变更前确认/medium — Task 1 Step 5 (`|| '变更前确认'` / `|| 'medium'`)
- ✅ 思考文案 low/medium/high — Task 1 Step 3/5
- ✅ 条件渲染(向后兼容) — Task 1 Step 5 + Step 1 测试覆盖
- ✅ styles.css 样式 — Task 1 Step 6
- ✅ 测试(渲染/选中值/onChange/默认值/向后兼容) — Task 1 Step 1

**2. Placeholder scan:** 无 TODO/TBD,每个 step 有完整代码或精确命令。

**3. Type consistency:**
- `currentPermission?: string` / `onPermissionChange?: (permission: string) => void` — 与 A 阶段 ChatPageProps(第 54/58 行)一致
- `currentThinking?: 'low'|'medium'|'high'` / `onThinkingChange?: (thinking: 'low'|'medium'|'high') => void` — 与 A 阶段(第 56/60 行)一致
- Step 5 的 `e.target.value as 'low'|'medium'|'high'` 转换与 THINKINGS 常量值域一致
- PERMISSIONS/THINKINGS 与桌面 InputBar.tsx:16-17 选项逐字一致

**注意点(实现时留意):**
- Step 4 解构位置:在 `onSetActiveModel,` 之后加,行号可能因前面改动偏移,按 `onSetActiveModel` 关键字定位
- Step 5 footer 插入位置:在 `<div className="chat-input-wrap">` 之前,按该 class 定位
- Step 6 CSS 插入位置:在 `.model-select {}` 规则块之后,按该选择器定位
