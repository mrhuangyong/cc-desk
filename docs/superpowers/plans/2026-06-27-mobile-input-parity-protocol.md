# 移动端输入框对齐 — 子项目 A:发送参数协议层对齐 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让移动端 session.message 协议能透传桌面端 claude.send 的全部参数(permission/thinking/images/extraDirs),并让移动端立即能用思考强度和权限模式两项。

**Architecture:** 三层改动对齐现有 thinking 透传模式——dispatcher 扩展 payload 解析 → deps.send 签名补齐 → index.ts spread 注入(无需改)。移动端 sendMessage 加可选参数,App.tsx 加 permission/thinking 状态随消息发出。主进程 claude.send 已支持全部参数,无需改动。

**Tech Stack:** TypeScript / vitest(根 + web) / Electron IPC / WebSocket relay 协议

## Global Constraints

- 所有新增协议字段可选,向后兼容(旧版移动端不传 → undefined,行为不变)
- 权限模式用中文标签字符串(与桌面 InputBar.tsx:16 一致):`'变更前确认' | '自动编辑' | '计划模式' | '完全访问'`
- 思考强度:`'low' | 'medium' | 'high'`,默认 `'medium'`
- 图片 data 为纯 base64(无 data: 前缀),与桌面 collectImages(InputBar.tsx:45-49)一致
- 测试遵循 TDD:先写失败测试,再实现
- Conventional Commits 提交规范
- 移动端权限/思考的 UI 控件(下拉)留给子项目 B,A 只做协议层 + 状态 + 传参

参考 spec: `docs/superpowers/specs/2026-06-27-mobile-input-parity-protocol-design.md`

---

## File Structure

- Modify: `src/main/remote-bridge.ts` — dispatcher session.message 分支(透传新字段) + DispatchDeps.send 签名(补字段)
- Modify: `tests/remote-bridge-dispatch.test.ts` — dispatcher 透传测试
- Modify: `web/src/hooks/useSessionChat.ts` — sendMessage 加可选 permission/thinking 参数
- Modify: `web/src/hooks/useSessionChat.test.tsx` — sendMessage 传参测试
- Modify: `web/src/App.tsx` — 加 permission/thinking 状态,handleSend 透传
- Modify: `web/src/pages/ChatPage.tsx` — 接收并回传 permission/thinking(为 B 的 UI 控件预留 props,A 阶段可只接 props 不渲染控件)
- 无需改: `src/main/index.ts`(spread 注入自动透传)、`src/main/claude-service.ts`(签名已支持)

---

## Task 1: dispatcher 透传 permission/extraDirs/images 给 deps.send

**Files:**
- Modify: `src/main/remote-bridge.ts:208`(DispatchDeps.send 签名)
- Modify: `src/main/remote-bridge.ts:282-296`(dispatcher session.message 分支)
- Test: `tests/remote-bridge-dispatch.test.ts`

**Interfaces:**
- Produces: `deps.send` 签名新增 `permission?: string` / `extraDirs?: string[]` / `images?: { mediaType: string; data: string; name?: string }[]`
- Consumes: 无(Task 1 是协议层基础,无前置依赖)

- [ ] **Step 1: 写失败测试 — session.message 带 permission 透传**

在 `tests/remote-bridge-dispatch.test.ts` 的 describe 块内(第 13 行 `session.message → 调 send` 测试后)追加:

```typescript
  it('session.message 带 permission 时 → 透传给 send（中文权限标签）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi', permission: '计划模式' } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'hi', localSessionId: 's1', permission: '计划模式' }))
  })

  it('session.message 带 extraDirs 时 → 透传给 send（附加目录数组）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi', extraDirs: ['/a/b', '/c/d'] } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ extraDirs: ['/a/b', '/c/d'] }))
  })

  it('session.message 带 images 时 → 透传给 send（base64 图片数组）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    const images = [{ mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'x.png' }]
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '看图', images } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ images }))
  })

  it('session.message 不带新字段时 → 向后兼容（permission/extraDirs/images 为 undefined）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi' } } as any)
    const call = send.mock.calls[0][0]
    expect(call.permission).toBeUndefined()
    expect(call.extraDirs).toBeUndefined()
    expect(call.images).toBeUndefined()
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/remote-bridge-dispatch.test.ts`
Expected: 4 个新测试 FAIL(`permission`/`extraDirs`/`images` 未透传,断言不匹配)

- [ ] **Step 3: 实现 — 扩展 DispatchDeps.send 签名**

修改 `src/main/remote-bridge.ts` 第 208 行,在签名里加三个可选字段:

```typescript
  send: (opts: {
    prompt: string
    localSessionId?: string
    sessionId?: string
    modelId?: string
    thinking?: 'low' | 'medium' | 'high'
    cwd?: string
    permission?: string
    extraDirs?: string[]
    images?: { mediaType: string; data: string; name?: string }[]
    webContents?: any
  }) => Promise<void>
```

- [ ] **Step 4: 实现 — dispatcher session.message 分支解析并透传新字段**

修改 `src/main/remote-bridge.ts` 第 283 行的 payload 类型断言,加三个字段:

```typescript
        const p = env.payload as {
          localSessionId: string
          text: string
          modelId?: string
          thinking?: 'low' | 'medium' | 'high'
          claudeSessionId?: string
          permission?: string
          extraDirs?: string[]
          images?: { mediaType: string; data: string; name?: string }[]
        }
```

修改第 295 行 `deps.send` 调用,透传新字段:

```typescript
        await deps.send({
          prompt: p.text,
          localSessionId: p.localSessionId,
          sessionId,
          cwd,
          thinking: p.thinking,
          permission: p.permission,
          extraDirs: p.extraDirs,
          images: p.images,
        })
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/remote-bridge-dispatch.test.ts`
Expected: 所有测试 PASS(含 4 个新测试 + 原有测试)

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误(exit 0)

- [ ] **Step 7: 提交**

```bash
git add src/main/remote-bridge.ts tests/remote-bridge-dispatch.test.ts
git commit -m "feat: 远程协议层透传 permission/extraDirs/images 到 claude.send

dispatcher 的 session.message 分支解析并透传权限模式/附加目录/图片附件,
deps.send 签名补齐对应字段。主进程 claude.send 已支持这些参数,
此前被远程协议层截断。向后兼容(字段全可选)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 移动端 sendMessage 接受并透传 permission/thinking

**Files:**
- Modify: `web/src/hooks/useSessionChat.ts:195-206`(sendMessage)
- Modify: `web/src/hooks/useSessionChat.test.tsx`

**Interfaces:**
- Consumes: Task 1 的协议层(session.message 现接受 permission/thinking/extraDirs/images)
- Produces: `sendMessage(localSessionId, text, opts?: { permission?: string; thinking?: 'low'|'medium'|'high'; extraDirs?: string[]; images?: ...[] })`

- [ ] **Step 1: 写失败测试 — sendMessage 传 permission/thinking**

在 `web/src/hooks/useSessionChat.test.tsx` 的 `useSessionChat - 输入与中断` describe 块内追加(找到该 describe 块,在第一个 it 后加):

```typescript
  it('sendMessage 带 permission/thinking 时 → session.message payload 含这些字段', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', 'hi', { permission: '计划模式', thinking: 'high' })
    })
    expect(send).toHaveBeenCalledWith('session.message', expect.objectContaining({
      localSessionId: 's1',
      text: 'hi',
      permission: '计划模式',
      thinking: 'high',
    }))
  })

  it('sendMessage 不带 opts 时 → payload 只有 localSessionId/text（向后兼容）', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', 'hi')
    })
    const payload = send.mock.calls[0][1]
    expect(payload).toEqual({ localSessionId: 's1', text: 'hi' })
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/hooks/useSessionChat.test.tsx`
Expected: 2 个新测试 FAIL(sendMessage 不接受第三参数,payload 不含 permission/thinking)

- [ ] **Step 3: 实现 — sendMessage 加可选 opts 参数**

修改 `web/src/hooks/useSessionChat.ts` 第 195-206 行的 sendMessage:

```typescript
  const sendMessage = useCallback(
    async (
      localSessionId: string,
      text: string,
      opts?: {
        permission?: string
        thinking?: 'low' | 'medium' | 'high'
        extraDirs?: string[]
        images?: { mediaType: string; data: string; name?: string }[]
      },
    ) => {
      const trimmed = text.trim()
      if (!trimmed) return
      // 本地 echo user 消息 + 开新 assistant 轮次（下一条 delta 续到这条 assistant）
      setMessages((prev) => [...prev, { role: 'user' as const, text: trimmed }, mkMessage()])
      finishedRef.current = false // 新 assistant 已就位，delta 续写它
      setRunning(true)
      await send('session.message', { localSessionId, text: trimmed, ...opts })
    },
    [send],
  )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd web && npx vitest run src/hooks/useSessionChat.test.tsx`
Expected: 所有测试 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/hooks/useSessionChat.ts web/src/hooks/useSessionChat.test.tsx
git commit -m "feat: 移动端 sendMessage 支持 permission/thinking/extraDirs/images 参数

为输入框能力对齐桌面端做准备:sendMessage 接受可选 opts,
随 session.message 透传。不传时向后兼容(只发 localSessionId/text)。
UI 控件留给子项目 B。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: App.tsx 管理 permission/thinking 状态并随发送透传

**Files:**
- Modify: `web/src/App.tsx`(状态 + handleSend + props 透传)
- Modify: `web/src/pages/ChatPage.tsx`(接收 onSendChange 或直接 props,A 阶段可不渲染控件)

**Interfaces:**
- Consumes: Task 2 的 sendMessage 第三参数
- Produces: App 持有 currentPermission/currentThinking 状态,handleSend 把它们传给 sendMessage

- [ ] **Step 1: 实现 — App.tsx 加 permission/thinking 状态**

在 `web/src/App.tsx` 找到 `const [activeModelId, setActiveModelId] = useState<string>('')`(约第 82 行)附近,加两个状态:

```typescript
  // 输入框发送参数(对齐桌面端):权限模式 + 思考强度。默认与桌面一致。
  // UI 控件(下拉)留给子项目 B,A 阶段用默认值随消息透传,验证协议层。
  const [currentPermission, setCurrentPermission] = useState<string>('变更前确认')
  const [currentThinking, setCurrentThinking] = useState<'low' | 'medium' | 'high'>('medium')
```

- [ ] **Step 2: 实现 — handleSend 透传状态**

修改 `web/src/App.tsx` 的 handleSend(约第 227-232 行):

```typescript
  const handleSend = useCallback(() => {
    if (view.kind !== 'chat') return
    const text = inputValue
    setInputValue('')
    void chat.sendMessage(view.localSessionId, text, {
      permission: currentPermission,
      thinking: currentThinking,
    })
  }, [view, inputValue, chat, currentPermission, currentThinking])
```

- [ ] **Step 3: 实现 — ChatPage 接收 permission/thinking 的 setter(A 阶段预留 props)**

修改 `web/src/pages/ChatPage.tsx` 的 props 接口(找到 ChatPageProps,约第 30 行),加可选 props 供 B 渲染控件。A 阶段先声明,不渲染:

```typescript
  /** 当前权限模式(对齐桌面)。B 子项目渲染下拉控件用。 */
  currentPermission?: string
  /** 当前思考强度。B 子项目渲染下拉控件用。 */
  currentThinking?: 'low' | 'medium' | 'high'
  /** 切换权限模式。B 子项目控件触发。 */
  onPermissionChange?: (permission: string) => void
  /** 切换思考强度。B 子项目控件触发。 */
  onThinkingChange?: (thinking: 'low' | 'medium' | 'high') => void
```

并在 App.tsx 渲染 ChatPage 处透传(找到 `<ChatPage ... />`,加上):

```typescript
          currentPermission={currentPermission}
          currentThinking={currentThinking}
          onPermissionChange={setCurrentPermission}
          onThinkingChange={setCurrentThinking}
```

- [ ] **Step 4: 运行 web 全套测试确认无破坏**

Run: `cd web && npx vitest run`
Expected: 所有测试 PASS(新增 props 不影响现有测试)

- [ ] **Step 5: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无错误(exit 0)

- [ ] **Step 6: 提交**

```bash
git add web/src/App.tsx web/src/pages/ChatPage.tsx
git commit -m "feat: 移动端 App 管理 permission/thinking 状态并随消息透传

App 持有 currentPermission/currentThinking 状态(A 阶段用默认值),
handleSend 把它们传给 sendMessage。ChatPage 预留控件 props 供 B 渲染下拉。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 全量验证 + smoke 准备

**Files:** 无代码改动,只验证

- [ ] **Step 1: 根全套测试**

Run: `npx vitest run tests/remote-bridge-dispatch.test.ts tests/reducer.test.ts tests/projects-store.test.ts tests/remote-bridge-session-list.test.ts`
Expected: 全 PASS(确认 Task 1 改动未破坏其他)

- [ ] **Step 2: 根类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: web 全套测试**

Run: `cd web && npx vitest run`
Expected: 全 PASS

- [ ] **Step 4: web 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: 手动 smoke 说明(交付给用户)**

子项目 A 完成后,协议层已通,但移动端 UI 还没控件(B 才做)。验证方式:
- A 阶段移动端用默认 permission('变更前确认')/thinking('medium')发送,桌面端 SDK 应按这些参数运行
- 想临时验证 thinking/permission 生效:可在 App.tsx 临时改 currentThinking/currentPermission 默认值,观察桌面端行为变化
- 图片/附加目录的协议层已通,但移动端无添加入口(B 才做 UI)

---

## Self-Review

**1. Spec coverage:**
- ✅ dispatcher 扩展 payload(thinking/permission/images/extraDirs)— Task 1
- ✅ deps.send 签名补齐 — Task 1
- ✅ index.ts spread 注入无需改 — 计划已注明
- ✅ 移动端 sendMessage 加 permission/thinking — Task 2
- ✅ 移动端状态管理(currentPermission/currentThinking)— Task 3
- ✅ 向后兼容测试 — Task 1 Step 1 含、Task 2 Step 1 含
- ✅ 图片 base64 协议层打通 — Task 1(透传),UI 留 B(spec 明确)

**2. Placeholder scan:** 无 TODO/TBD,每个 step 都有完整代码或精确命令。

**3. Type consistency:**
- `permission: string`(中文标签)在 Task 1/2/3 一致
- `thinking: 'low' | 'medium' | 'high'` 三处一致
- `images: { mediaType: string; data: string; name?: string }[]` 在 Task 1(dispatcher/deps.send)与 Task 2(sendMessage opts)一致,且与主进程 claude.send(claude-service.ts:322)签名一致
- `extraDirs: string[]` 一致

**注意点(实现时留意):**
- Task 1 Step 3 的行号(208)和 Step 4 的行号(283/295)是当前代码位置,若之前任务改过 remote-bridge.ts 行号会偏移,按函数名/payload 内容定位
- Task 3 的 ChatPage props 透传位置需找到实际 `<ChatPage` 渲染处
