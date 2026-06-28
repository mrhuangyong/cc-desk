# 移动端输入框对齐 — 子项目 B3:草稿持久化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移动端输入框文本按会话持久化到 localStorage——切会话/退出/刷新后回到该会话仍能看到未发送输入,发送后清、归档后清。

**Architecture:** 两任务递进——draft-storage 纯函数封装 localStorage 读写(可独立单测) → App.tsx 接入(进会话恢复/输入保存/发送清/归档清)。复用现有 useTheme/pair.ts 的 localStorage try/catch 模式。

**Tech Stack:** React + TypeScript + localStorage + @testing-library/react + vitest(web 子项目)

## Global Constraints

- 按 localSessionId 存草稿(localStorage key 前缀 `cc-desk-draft:` + localSessionId)
- 只存文本(不存图片附件)
- localStorage 全程 try/catch + `typeof localStorage === 'undefined'` 守卫(隐私模式/SSR 不崩)
- 发送后清 + 归档后清
- 每次 onInputChange 直接写(不防抖)
- 只在 view.kind === 'chat' 时操作(有 localSessionId)
- 测试用 web 子项目 vitest:`cd web && npx vitest run ...`
- Conventional Commits 提交

参考 spec: `docs/superpowers/specs/2026-06-27-mobile-input-parity-b3-draft-design.md`

---

## File Structure

- Create: `web/src/lib/draft-storage.ts` — localStorage 草稿读写纯函数(loadDraft/saveDraft/clearDraft)
- Create: `web/src/lib/draft-storage.test.ts` — 纯函数单测
- Modify: `web/src/App.tsx` — 进会话恢复(useEffect) + onInputChange 保存 + handleSend 清 + handleArchive 清

无需改: ChatPage.tsx(inputValue/onInputChange props 已有)、useSessionChat.ts、协议层。

---

## Task 1: draft-storage 纯函数(loadDraft/saveDraft/clearDraft)

**Files:**
- Create: `web/src/lib/draft-storage.ts`
- Create: `web/src/lib/draft-storage.test.ts`

**Interfaces:**
- Consumes: 无(纯函数)
- Produces: `loadDraft(localSessionId: string): string` / `saveDraft(localSessionId: string, text: string): void` / `clearDraft(localSessionId: string): void`。Task 2 的 App 调用它们。

- [ ] **Step 1: 写失败测试 — draft-storage 纯函数**

创建 `web/src/lib/draft-storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { loadDraft, saveDraft, clearDraft } from './draft-storage'

// jsdom 提供真实 localStorage,每个用例前清空避免污染
beforeEach(() => {
  localStorage.clear()
})

describe('draft-storage', () => {
  it('saveDraft + loadDraft 往返一致', () => {
    saveDraft('s1', '我在写的东西')
    expect(loadDraft('s1')).toBe('我在写的东西')
  })

  it('不同会话的草稿独立(按 localSessionId 隔离)', () => {
    saveDraft('s1', '会话1的草稿')
    saveDraft('s2', '会话2的草稿')
    expect(loadDraft('s1')).toBe('会话1的草稿')
    expect(loadDraft('s2')).toBe('会话2的草稿')
  })

  it('saveDraft 空文本 → 删除该 key(loadDraft 返回空串)', () => {
    saveDraft('s1', '有内容')
    saveDraft('s1', '')  // 清空
    expect(loadDraft('s1')).toBe('')
  })

  it('loadDraft 不存在的会话 → 空串', () => {
    expect(loadDraft('never-exists')).toBe('')
  })

  it('clearDraft → loadDraft 返回空串', () => {
    saveDraft('s1', '待清除')
    clearDraft('s1')
    expect(loadDraft('s1')).toBe('')
  })

  it('localStorage 抛错时(隐私模式)函数静默不崩', () => {
    // 模拟 localStorage.setItem 抛错(隐私模式/容量满)
    const orig = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota exceeded') }
    expect(() => saveDraft('s1', 'x')).not.toThrow()
    expect(loadDraft('s1')).toBe('')  // 抛错时返回空串
    localStorage.setItem = orig  // 恢复
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/lib/draft-storage.test.ts`
Expected: FAIL(`draft-storage.ts` 不存在,import 报错)

- [ ] **Step 3: 实现 — draft-storage.ts**

创建 `web/src/lib/draft-storage.ts`:

```typescript
// web/src/lib/draft-storage.ts
// 按会话(localSessionId)持久化输入草稿到 localStorage。
// 只存文本(不存图片附件,避开 localStorage 容量限制)。
// PWA 同源持久:切会话/退出/刷新后回到该会话仍能看到未发送输入。
//
// 全程 try/catch + typeof 守卫:隐私模式/SSR/localStorage 禁用时不崩,
// 草稿不持久但不影响输入功能(对齐 useTheme.ts 的容错模式)。

const PREFIX = 'cc-desk-draft:'

/** 读取某会话的草稿文本。无则返回空串。localStorage 不可用时静默返回 ''。 */
export function loadDraft(localSessionId: string): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(PREFIX + localSessionId) ?? ''
  } catch {
    return ''
  }
}

/** 保存某会话草稿。text 为空则删除该 key(避免残留空草稿)。localStorage 不可用时静默。 */
export function saveDraft(localSessionId: string, text: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (text) localStorage.setItem(PREFIX + localSessionId, text)
    else localStorage.removeItem(PREFIX + localSessionId)
  } catch {
    // 隐私模式/容量满/禁用时静默(草稿不持久,但不影响输入)
  }
}

/** 清除某会话草稿(发送后/归档后调用)。localStorage 不可用时静默。 */
export function clearDraft(localSessionId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(PREFIX + localSessionId)
  } catch {
    // 静默
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd web && npx vitest run src/lib/draft-storage.test.ts`
Expected: 6 测试 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/draft-storage.ts web/src/lib/draft-storage.test.ts
git commit -m "feat: 移动端 draft-storage 纯函数(按会话 localStorage 草稿读写)

为草稿持久化做准备:loadDraft/saveDraft/clearDraft 按 localSessionId
存取输入文本(只存文本,避开容量限制)。全程 try/catch 隐私模式不崩。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: App.tsx 接入草稿(进会话恢复/输入保存/发送清/归档清)

**Files:**
- Modify: `web/src/App.tsx`(import + onInputChange 包装修改 + useEffect 恢复 + handleSend 清 + handleArchive 清)

**Interfaces:**
- Consumes: Task 1 的 `loadDraft(localSessionId): string` / `saveDraft(localSessionId, text): void` / `clearDraft(localSessionId): void`
- Produces: 无(集成终点)

- [ ] **Step 1: 实现 — import draft-storage**

修改 `web/src/App.tsx` 顶部 import 区(找到现有 import,加一行,放在 read-image import 附近):

```typescript
import { loadDraft, saveDraft, clearDraft } from './lib/draft-storage'
```

- [ ] **Step 2: 实现 — onInputChange 包装修改(输入时保存)**

修改 `web/src/App.tsx`。当前 ChatPage 的 prop 是 `onInputChange={setInputValue}`(约第 294 行)。改为包一层:在 handleSend 定义之前(约第 244 行前)加一个回调:

```typescript
  // 输入时同步保存草稿到 localStorage(按会话)。每次按键直接写(文本小)。
  const handleInputChange = useCallback((v: string) => {
    setInputValue(v)
    if (view.kind === 'chat') saveDraft(view.localSessionId, v)
  }, [view])
```

修改 ChatPage 的 prop(约第 294 行):

```typescript
          inputValue={inputValue}
          onInputChange={handleInputChange}
```

- [ ] **Step 3: 实现 — useEffect 进会话恢复草稿**

在 `web/src/App.tsx` 的 useEffect 区(找到已有的 useEffect 块,如 `useEffect(() => { settingsRef...` 附近,或任意 useEffect 之后)加一个:

```typescript
  // 进会话时恢复该会话的草稿(view.localSessionId 变化时触发)。
  // 切会话/退出后回来都能看到上次未发送的输入。
  useEffect(() => {
    if (view.kind === 'chat') {
      setInputValue(loadDraft(view.localSessionId))
    }
  }, [view.kind, view.kind === 'chat' ? view.localSessionId : null])
```

- [ ] **Step 4: 实现 — handleSend 发送后清草稿**

修改 `web/src/App.tsx` 的 handleSend(约第 244-255 行),在 `setInputValue('')` 之后加 clearDraft:

```typescript
  const handleSend = useCallback(() => {
    if (view.kind !== 'chat') return
    const text = inputValue
    setInputValue('')
    clearDraft(view.localSessionId)  // 发送后清草稿
    const imagesToSend = attachments.length ? attachments : undefined
    void chat.sendMessage(view.localSessionId, text, {
      permission: currentPermission,
      thinking: currentThinking,
      images: imagesToSend,
    })
    if (attachments.length) setAttachments([])
  }, [view, inputValue, chat, currentPermission, currentThinking, attachments])
```

- [ ] **Step 5: 实现 — handleArchive 归档后清草稿**

修改 `web/src/App.tsx` 的 handleArchive(约第 220-233 行),在 `void relay.send('session.archive', { localSessionId })` 之前加 clearDraft:

```typescript
  const handleArchive = useCallback(
    (localSessionId: string) => {
      clearDraft(localSessionId)  // 归档后清草稿
      setSessions((prev) => prev.filter((s) => s.localSessionId !== localSessionId))
      setView((prev) => {
        if (prev.kind === 'chat' && prev.localSessionId === localSessionId) {
          chat.reset()
          return { kind: 'list' }
        }
        return prev
      })
      void relay.send('session.archive', { localSessionId })
    },
    [relay, chat],
  )
```

- [ ] **Step 6: 运行全套测试确认不破坏**

Run: `cd web && npx vitest run`
Expected: 全 PASS(含 Task 1 的 draft-storage 测试 + 现有测试)

- [ ] **Step 7: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 8: 提交**

```bash
git add web/src/App.tsx
git commit -m "feat: 移动端输入框草稿按会话持久化(切会话/退出/刷新恢复)

App 接入 draft-storage:进会话时 loadDraft 恢复输入,onInputChange 时
saveDraft 保存,handleSend 发送后 clearDraft,handleArchive 归档后 clearDraft。
按 localSessionId 隔离各会话草稿。只存文本(图片附件不持久)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 按会话存草稿(localSessionId) — Task 1 key 前缀 + Task 2 按 view.localSessionId
- ✅ 只存文本 — Task 1 saveDraft 只接受 string(无附件参数)
- ✅ localStorage — Task 1 实现
- ✅ 发送后清 — Task 2 Step 4 handleSend clearDraft
- ✅ 归档后清 — Task 2 Step 5 handleArchive clearDraft
- ✅ 每次按键直接写 — Task 2 Step 2 handleInputChange(无防抖)
- ✅ try/catch + typeof 守卫 — Task 1 实现 + Task 1 测试覆盖(localStorage 抛错)
- ✅ 进会话恢复 — Task 2 Step 3 useEffect

**2. Placeholder scan:** 无 TODO/TBD,每个 step 有完整代码或精确命令。

**3. Type consistency:**
- `loadDraft(localSessionId: string): string` — Task 1 定义,Task 2 Step 3 调用,签名一致
- `saveDraft(localSessionId: string, text: string): void` — Task 1 定义,Task 2 Step 2 调用 `saveDraft(view.localSessionId, v)`,签名一致
- `clearDraft(localSessionId: string): void` — Task 1 定义,Task 2 Step 4/5 调用,签名一致
- PREFIX `cc-desk-draft:` — Task 1 定义,测试断言 key 隔离

**注意点(实现时留意):**
- Task 2 Step 2:handleInputChange 的 deps 是 `[view]`(因 view.kind/view.localSessionId 都来自 view)。原 `onInputChange={setInputValue}` 改为 `onInputChange={handleInputChange}`
- Task 2 Step 3:useEffect 依赖用 `view.kind === 'chat' ? view.localSessionId : null` 避免 view 对象引用变化导致重复触发(只在 localSessionId 实际变化时恢复)
- Task 2 Step 5:handleArchive 参数名是 `localSessionId`(不是 lsid),clearDraft(localSessionId)
- App.tsx 已 import useEffect(顶部 react import 含 useEffect,无需额外加)
