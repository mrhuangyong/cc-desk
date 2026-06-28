# 移动端输入框对齐 — 子项目 B5:排队模式 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移动端 AI 流式时用户发新消息按 queue(排队,AI 结束自动发)/ guide(中断立即发)双模式处理,模式在控件栏切换,排队消息可见。

**Architecture:** 三任务递进——useSessionChat 加 queue 状态 + sendMessage 接受 queueMode(running 时 queue 入队/guide 中断200ms后发)+ 自动出队 useEffect → App 加 currentQueueMode 状态 + handleSend 透传 → ChatPage 控件栏加模式 select + 队列 chip 栏。纯前端,不碰协议层。

**Tech Stack:** React + TypeScript + vitest fake timers(web 子项目)

## Global Constraints

- 双模式:`queue`(默认,排队)/ `guide`(中断立即发)
- guide 模式:interrupt 后 setTimeout 200ms 再发(对齐桌面)
- 队列消息只可见(chip 显示),不做取消/立即发/编辑(YAGNI)
- 自动出队:running:false 且 queue 非空时 useEffect 发队首 + 出队
- useSessionChat 不持有 localSessionId,自动出队用 ref 缓存最近 localSessionId(sendMessage 时更新)
- queue 模式入队时不 echo(出队时才 echo + send)
- 测试用 web 子项目 vitest:`cd web && npx vitest run ...`;guide 200ms 测试用 `vi.useFakeTimers`
- Conventional Commits 提交

参考 spec: `docs/superpowers/specs/2026-06-27-mobile-input-parity-b5-queue-design.md`

---

## File Structure

- Modify: `web/src/hooks/useSessionChat.ts` — queue state + localSessionIdRef + sendMessage 接受 queueMode + 自动出队 useEffect + handle 暴露 queue
- Modify: `web/src/hooks/useSessionChat.test.tsx` — queue/guide/自动出队测试(含 fake timers)
- Modify: `web/src/App.tsx` — currentQueueMode state + handleSend 透传 queueMode + ChatPage props 下发
- Modify: `web/src/pages/ChatPage.tsx` — 控件栏加模式 select + 队列 chip 栏
- Modify: `web/src/pages/ChatPage.test.tsx` — 模式 select + 队列 chip 测试

无需改: 协议层。

---

## Task 1: useSessionChat 加 queue 状态 + sendMessage queueMode + 自动出队

**Files:**
- Modify: `web/src/hooks/useSessionChat.ts`
- Modify: `web/src/hooks/useSessionChat.test.tsx`

**Interfaces:**
- Consumes: 现有 `send`/`interrupt`/`mkMessage`/`running`/`finishedRef`
- Produces: handle 新增 `queue: string[]`;sendMessage opts 新增 `queueMode?: 'queue' | 'guide'`。Task 2/3 复用。

- [ ] **Step 1: 写失败测试 — queue/guide/自动出队**

在 `web/src/hooks/useSessionChat.test.tsx` 末尾追加新 describe 块:

```typescript
describe('useSessionChat - 排队模式', () => {
  it('running + queueMode=queue → 消息进队列,不直接 send', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    // 先进入 running(模拟流式中)
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    expect(result.current.running).toBe(true)
    const sendCallsBefore = send.mock.calls.length
    // queue 模式发送
    await act(async () => {
      await result.current.sendMessage('s1', '排队消息', { queueMode: 'queue' })
    })
    // 进了队列,没有新 session.message 调用
    expect(result.current.queue).toEqual(['排队消息'])
    expect(send.mock.calls.length).toBe(sendCallsBefore) // 无新 send
  })

  it('running + queueMode=guide → interrupt 后 200ms 发', async () => {
    vi.useFakeTimers()
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    await act(async () => {
      await result.current.sendMessage('s1', '立即发', { queueMode: 'guide' })
    })
    // 应已 interrupt(session.interrupt 调用)
    expect(send.mock.calls.some((c) => c[0] === 'session.interrupt')).toBe(true)
    // 200ms 前还没发 session.message(只有 interrupt)
    const msgBefore = send.mock.calls.filter((c) => c[0] === 'session.message').length
    // 推进 200ms
    act(() => { vi.advanceTimersByTime(200) })
    const msgAfter = send.mock.calls.filter((c) => c[0] === 'session.message').length
    expect(msgAfter).toBeGreaterThan(msgBefore) // 200ms 后发了 message
    vi.useRealTimers()
  })

  it('!running → 直接发(不受 queueMode 影响)', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    await act(async () => {
      await result.current.sendMessage('s1', '直接发', { queueMode: 'queue' })
    })
    expect(send.mock.calls.some((c) => c[0] === 'session.message')).toBe(true)
    expect(result.current.queue).toEqual([]) // 没进队列
  })

  it('running 结束 + queue 非空 → 自动发队首 + 出队', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    await act(async () => {
      await result.current.sendMessage('s1', '排队1', { queueMode: 'queue' })
    })
    expect(result.current.queue).toEqual(['排队1'])
    // AI 结束(session.result → running:false)
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.result', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1' } } as any)
    })
    // 自动出队:queue 清空,发了队首
    expect(result.current.queue).toEqual([])
    expect(send.mock.calls.some((c) => c[0] === 'session.message' && c[1]?.text === '排队1')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/hooks/useSessionChat.test.tsx`
Expected: 4 个新测试 FAIL(queue 状态/queueMode 不存在)

- [ ] **Step 3: 实现 — 加 queue state + localSessionIdRef**

修改 `web/src/hooks/useSessionChat.ts`。在 `const [editingIndex, setEditing] = useState...`(约第 106 行)附近加:

```typescript
  // 排队模式:流式中 queue 模式发送的消息暂存队列,AI 结束后自动发队首。
  const [queue, setQueue] = useState<string[]>([])
  // 自动出队的 useEffect 需 localSessionId,但 hook 不持有它(sendMessage 参数传入)。
  // 用 ref 缓存最近一次 sendMessage 的 localSessionId,供出队 useEffect 使用。
  const localSessionIdRef = useRef<string>('')
```

- [ ] **Step 4: 实现 — sendMessage 接受 queueMode + 排队/中断逻辑**

修改 `web/src/hooks/useSessionChat.ts` 的 sendMessage(约第 213-232 行),替换整个 sendMessage:

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
        queueMode?: 'queue' | 'guide'
      },
    ) => {
      const trimmed = text.trim()
      if (!trimmed) return
      localSessionIdRef.current = localSessionId
      // 流式中按 queueMode 处理(非流式直接发)
      if (running) {
        if (opts?.queueMode === 'queue') {
          // queue:进队列,不直接发(等 AI 结束自动出队)
          setQueue((prev) => [...prev, trimmed])
          return
        }
        if (opts?.queueMode === 'guide') {
          // guide:中断当前 AI,200ms 后立即发(确保 SDK 中断完成)
          await send('session.interrupt', { localSessionId })
          setTimeout(() => {
            setMessages((prev) => [...prev, { role: 'user' as const, text: trimmed }, mkMessage()])
            finishedRef.current = false
            setRunning(true)
            void send('session.message', { localSessionId, text: trimmed })
          }, 200)
          return
        }
      }
      // 非流式 / 无 queueMode:直接 echo + 发
      setMessages((prev) => [...prev, { role: 'user' as const, text: trimmed }, mkMessage()])
      finishedRef.current = false
      setRunning(true)
      await send('session.message', { localSessionId, text: trimmed, ...opts })
    },
    [send, running],
  )
```

注意:透传 opts 时需排除 queueMode(不该发给 session.message)。修改最后一行 spread 为显式字段或先剔除 queueMode。简单做法:

```typescript
      const { queueMode: _qm, ...sendOpts } = opts ?? {}
      await send('session.message', { localSessionId, text: trimmed, ...sendOpts })
```
(把上面"非流式"分支最后一行的 `...opts` 替换为 `...sendOpts`,guide 分支同理不用 opts 的 spread)

- [ ] **Step 5: 实现 — 自动出队 useEffect**

修改 `web/src/hooks/useSessionChat.ts`。在 sendMessage 之后(约第 240 行附近)加 useEffect(需 import useEffect):

```typescript
  // 自动出队:AI 结束(running:false)且 queue 非空时,发队首 + 出队。
  // 用 localSessionIdRef 拿最近的 localSessionId(hook 不持有它)。
  useEffect(() => {
    if (!running && queue.length > 0 && localSessionIdRef.current) {
      const next = queue[0]
      setQueue((prev) => prev.slice(1))
      const localSessionId = localSessionIdRef.current
      // 出队即直接发(echo + send,不再判断 queueMode)
      setMessages((prev) => [...prev, { role: 'user' as const, text: next }, mkMessage()])
      finishedRef.current = false
      setRunning(true)
      void send('session.message', { localSessionId, text: next })
    }
  }, [running, queue, send])
```

确认顶部已 import useEffect(现有 import `import { useCallback, useRef, useState } from 'react'` 需加 useEffect):

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
```

- [ ] **Step 6: 实现 — handle 暴露 queue**

修改 `web/src/hooks/useSessionChat.ts` 的返回值(约第 270 行附近,找到 return):

```typescript
  return { messages, running, hasMoreHistory, historyVersion, onInbound, sendMessage, interrupt, loadHistory, reset, editingIndex, setEditing, editAndResend, queue }
```

同时修改 `UseSessionChatHandle` 接口(约第 52-90 行),在 editAndResend 之后加:

```typescript
  /** 排队中的消息文本(queue 模式流式时发送的消息,AI 结束后自动发)。 */
  queue: string[]
```

并在 sendMessage 接口签名(约第 66-77 行)的 opts 加 `queueMode?: 'queue' | 'guide'`:

```typescript
    opts?: {
      permission?: string
      thinking?: 'low' | 'medium' | 'high'
      extraDirs?: string[]
      images?: { mediaType: string; data: string; name?: string }[]
      queueMode?: 'queue' | 'guide'
    },
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd web && npx vitest run src/hooks/useSessionChat.test.tsx`
Expected: 所有测试 PASS(含 4 个新测试 + 原有测试)

- [ ] **Step 8: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 9: 提交**

```bash
git add web/src/hooks/useSessionChat.ts web/src/hooks/useSessionChat.test.tsx
git commit -m "feat: 移动端 useSessionChat 加排队模式(queue/guide)+ 自动出队

sendMessage 接受 queueMode:running 时 queue 入队(不echo)/guide interrupt后200ms发。
AI 结束(running:false)且 queue 非空时 useEffect 自动发队首+出队。
localSessionIdRef 缓存最近 localSessionId 供出队用(hook 不持有 localSessionId)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: App 加 currentQueueMode 状态 + handleSend 透传 + ChatPage props 下发

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 1 的 sendMessage queueMode opts、chat.queue
- Produces: App 透传给 ChatPage 的 3 个 props(Task 3 声明):`currentQueueMode` / `onQueueModeChange` / `queue`

- [ ] **Step 1: 实现 — App 加 currentQueueMode state**

修改 `web/src/App.tsx`。在 `const [currentThinking, setCurrentThinking] = useState...`(约第 86 行)附近加:

```typescript
  // 排队模式(对齐桌面 queueMode):queue=流式时排队AI结束后发,guide=中断立即发。默认 queue。
  const [currentQueueMode, setCurrentQueueMode] = useState<'queue' | 'guide'>('queue')
```

- [ ] **Step 2: 实现 — handleSend 透传 queueMode**

修改 `web/src/App.tsx` 的 handleSend(约第 260-275 行),在 sendMessage 的 opts 加 queueMode:

```typescript
    void chat.sendMessage(view.localSessionId, text, {
      permission: currentPermission,
      thinking: currentThinking,
      images: imagesToSend,
      queueMode: currentQueueMode,
    })
```

handleSend 的 useCallback deps 需加 currentQueueMode(在依赖数组末尾加)。

- [ ] **Step 3: 实现 — ChatPage props 下发**

修改 `web/src/App.tsx` 渲染 ChatPage 处(找到 `onThinkingChange={setCurrentThinking}` 之后,约第 305 行附近)加 3 个 props:

```typescript
          onThinkingChange={setCurrentThinking}
          currentQueueMode={currentQueueMode}
          onQueueModeChange={setCurrentQueueMode}
          queue={chat.queue}
```

- [ ] **Step 4: 类型检查(此时 ChatPageProps 还没声明 3 个 props,会报错——预期)**

Run: `cd web && npx tsc --noEmit`
Expected: 报错(ChatPageProps 缺 currentQueueMode/onQueueModeChange/queue)——Task 3 接好。**预期,本任务不单独验证 tsc,合并 Task 3 后验证。**

- [ ] **Step 5: 提交**

```bash
git add web/src/App.tsx
git commit -m "feat: 移动端 App 加 currentQueueMode 状态 + handleSend 透传 queueMode

App 持有 currentQueueMode(默认queue),handleSend 透传给 sendMessage。
下发 currentQueueMode/onQueueModeChange/chat.queue 给 ChatPage。
ChatPageProps 接线在 Task 3。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: ChatPage 控件栏加模式 select + 队列 chip 栏

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`(props + 解构 + 控件栏 select + 队列 chip)
- Modify: `web/src/styles.css`(队列 chip 样式)
- Modify: `web/src/pages/ChatPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 App 下发的 props:`currentQueueMode?: 'queue'|'guide'` / `onQueueModeChange?: (mode)=>void` / `queue?: string[]`
- Produces: 无(UI 终点)

- [ ] **Step 1: 写失败测试 — 模式 select + 队列 chip**

在 `web/src/pages/ChatPage.test.tsx` 末尾追加新 describe 块:

```typescript
describe('ChatPage - 排队模式', () => {
  const baseProps = {
    title: 't', messages: [], running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('传入 onQueueModeChange 时渲染模式 select,选中值正确', () => {
    render(
      <ChatPage
        {...baseProps}
        currentQueueMode="guide"
        onQueueModeChange={() => {}}
      />,
    )
    const select = screen.getByLabelText('排队模式') as HTMLSelectElement
    expect(select.value).toBe('guide')
    expect(select.options.length).toBe(2) // queue / guide
  })

  it('改模式 select → onQueueModeChange(新值)', () => {
    const onQueueModeChange = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        currentQueueMode="queue"
        onQueueModeChange={onQueueModeChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('排队模式'), { target: { value: 'guide' } })
    expect(onQueueModeChange).toHaveBeenCalledWith('guide')
  })

  it('queue 非空 → 渲染对应数量的排队 chip', () => {
    render(
      <ChatPage
        {...baseProps}
        queue={['排队消息1', '排队消息2']}
      />,
    )
    const chips = screen.getAllByText(/排队消息/)
    expect(chips.length).toBe(2)
  })

  it('未传 onQueueModeChange 时不渲染模式 select(向后兼容)', () => {
    render(<ChatPage {...baseProps} />)
    expect(screen.queryByLabelText('排队模式')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 4 个新测试 FAIL(新 props 未声明/未渲染)

- [ ] **Step 3: 实现 — ChatPageProps 加 3 个可选 props**

修改 `web/src/pages/ChatPage.tsx` 的 ChatPageProps 接口(找到 `onEditResend?: (index: number, newText: string) => void` 之后,约第 162 行)加:

```typescript
  /** 当前排队模式(queue=排队/guide=中断立即发)。 */
  currentQueueMode?: 'queue' | 'guide'
  /** 切换排队模式。 */
  onQueueModeChange?: (mode: 'queue' | 'guide') => void
  /** 排队中的消息文本(流式时 queue 模式发送的,AI 结束后自动发)。 */
  queue?: string[]
```

- [ ] **Step 4: 实现 — 解构 props**

修改 ChatPage 组件解构(找到 `onEditResend,` 之后,约第 149 行)加:

```typescript
    onEditResend,
    currentQueueMode,
    onQueueModeChange,
    queue,
  } = props
```

- [ ] **Step 5: 实现 — 控件栏加模式 select + 顶部声明常量**

修改 `web/src/pages/ChatPage.tsx`。在文件顶部常量区(找到 `const THINKINGS = ...` 之后,约第 29 行)加:

```typescript
/** 排队模式选项(对齐桌面 queueMode)。 */
const QUEUE_MODES = ['queue', 'guide'] as const
```

修改控件栏(约第 378-401 行的 `<div className="chat-input-controls">`),在 thinking select 之后、`</div>` 之前加模式 select。注意条件渲染要扩展——把控件栏的显示条件改为包含 onQueueModeChange:

```tsx
        {(onPermissionChange || onThinkingChange || onQueueModeChange) && (
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
            {onQueueModeChange && (
              <select
                className="param-select"
                value={currentQueueMode || 'queue'}
                onChange={(e) => onQueueModeChange(e.target.value as 'queue' | 'guide')}
                aria-label="排队模式"
              >
                <option value="queue">排队</option>
                <option value="guide">中断</option>
              </select>
            )}
          </div>
        )}
```

- [ ] **Step 6: 实现 — 队列 chip 栏(输入框上方,附件 chip 栏旁)**

修改 `web/src/pages/ChatPage.tsx`。在附件 chip 栏(约第 402 行 `{attachments && attachments.length > 0 && (...)}`)之后、`<div className="chat-input-wrap">` 之前加队列 chip:

```tsx
        {queue && queue.length > 0 && (
          <div className="queue-chips">
            {queue.map((text, i) => (
              <div className="queue-chip" key={i}>排队中: {text}</div>
            ))}
          </div>
        )}
```

- [ ] **Step 7: 实现 — styles.css 加队列 chip 样式**

在 `web/src/styles.css` 末尾追加:

```css
/* 排队消息 chip */
.queue-chips {
  display: flex; flex-direction: column; gap: 4px; padding: 0 0 6px 0;
}
.queue-chip {
  font-size: 12px; color: var(--text-muted); padding: 4px 8px;
  background: var(--bg-sunken); border-radius: var(--r-sm);
  border-left: 2px solid var(--accent);
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 所有测试 PASS(含 4 个新测试 + 原有测试)

- [ ] **Step 9: 类型检查 + 全套回归**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

Run: `cd web && npx vitest run`
Expected: 全 PASS

- [ ] **Step 10: 提交**

```bash
git add web/src/pages/ChatPage.tsx web/src/styles.css web/src/pages/ChatPage.test.tsx
git commit -m "feat: 移动端 ChatPage 排队模式 UI(模式select+队列chip栏)

控件栏加排队模式select(排队/中断),接Task2的App props。
输入框上方加队列chip栏显示排队中消息(只可见)。
条件渲染向后兼容。消除Task2的tsc报错。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 双模式 queue/guide — Task 1 Step 4(sendMessage queueMode 分支)
- ✅ 默认 queue — Task 2 Step 1(useState('queue'))
- ✅ 控件栏切换 — Task 3 Step 5(select)
- ✅ 队列消息只可见 — Task 3 Step 6(chip 栏,无取消/编辑/立即发)
- ✅ guide interrupt 后 200ms 发 — Task 1 Step 4(setTimeout 200)
- ✅ 自动出队(running:false + queue 非空) — Task 1 Step 5(useEffect)
- ✅ localSessionIdRef 缓存 — Task 1 Step 3 + Step 4(sendMessage 更新 ref)

**2. Placeholder scan:** 无 TODO/TBD,每个 step 有完整代码或精确命令。

**3. Type consistency:**
- `queue: string[]` — Task 1 handle 定义,Task 2 `chat.queue` 下发,Task 3 ChatPageProps `queue?: string[]`,一致
- `queueMode?: 'queue' | 'guide'` — Task 1 sendMessage opts + 接口,Task 2 handleSend 透传,Task 3 currentQueueMode/onQueueModeChange,一致
- `currentQueueMode?: 'queue' | 'guide'` / `onQueueModeChange?: (mode: 'queue' | 'guide') => void` — Task 2 下发,Task 3 ChatPageProps,一致
- QUEUE_MODES 常量 Task 3 Step 5 声明(select 选项用)

**注意点(实现时留意):**
- Task 1 Step 4:opts spread 到 session.message 时要剔除 queueMode(用 `const { queueMode: _qm, ...sendOpts } = opts ?? {}`),否则 queueMode 会被透传给 session.message payload(协议层不需要这个字段)。guide 分支不 spread opts(直接发 trimmed)。
- Task 1 Step 4:sendMessage deps 改为 `[send, running]`(新增 running 依赖,因判断 running)
- Task 1 Step 7 fake timers:guide 测试用 vi.useFakeTimers + vi.advanceTimersByTime(200),测完 vi.useRealTimers 恢复
- Task 2 Step 2:handleSend deps 数组加 currentQueueMode
- Task 3 Step 5:控件栏显示条件从 `(onPermissionChange || onThinkingChange)` 扩展为含 `onQueueModeChange`
- Task 2 的 tsc 报错(ChatPageProps 待 Task3)是预期,Task 3 接好后 Step 9 验证
