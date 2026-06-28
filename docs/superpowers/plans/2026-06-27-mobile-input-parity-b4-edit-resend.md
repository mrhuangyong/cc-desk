# 移动端输入框对齐 — 子项目 B4:编辑重发 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移动端最后一条 user 消息可编辑重发——点编辑按钮 → 原位变 textarea → 保存后截断该消息及之后的回复 + 中断当前流(若在跑) + 用新文本重发(resume 旧会话)。

**Architecture:** 三任务递进——useSessionChat 加 editAndResend(截断+重发,interrupt 配合,内联发送避免 echo 重复) + editing 态 → ChatPage 渲染编辑按钮+原位编辑 UI → App 接线。纯前端,不碰协议层(session.interrupt/session.message 已有)。

**Tech Stack:** React + TypeScript + @testing-library/react + vitest(web 子项目)

## Global Constraints

- 仅最后一条 user 消息可编辑,且非流式(!running)时显示编辑按钮
- 编辑态:原位变 textarea + 保存/取消按钮(editValue 独立 state,不污染 inputValue/草稿)
- UI 截断该消息及之后所有回复 + 用新文本重发;SDK resume 旧会话(带历史),对齐桌面
- running 时编辑重发先 interrupt 再发
- editAndResend 内联发送(截断到 index[不含] + 加新 user + mkMessage 开 assistant + 发 session.message),**不调 sendMessage**(避免重复 echo user)
- localSessionId 作为参数传入(useSessionChat 不持有 localSessionId,与 sendMessage/interrupt 同款)
- 测试用 web 子项目 vitest:`cd web && npx vitest run ...`
- Conventional Commits 提交

参考 spec: `docs/superpowers/specs/2026-06-27-mobile-input-parity-b4-edit-resend-design.md`

---

## File Structure

- Modify: `web/src/hooks/useSessionChat.ts` — 加 editingIndex state + setEditing + editAndResend(localSessionId 参数,截断+内联重发),handle 暴露这三者
- Modify: `web/src/hooks/useSessionChat.test.tsx` — editAndResend 测试(截断/重发/中断/无重复echo)
- Modify: `web/src/pages/ChatPage.tsx` — props(onEditResend/editingIndex/onStartEdit/onCancelEdit) + user 消息渲染编辑按钮 + 原位编辑 textarea
- Modify: `web/src/pages/ChatPage.test.tsx` — 编辑按钮/原位编辑/保存取消测试
- Modify: `web/src/App.tsx` — 透传 chat.editAndResend/editingIndex/setEditing 给 ChatPage

无需改: 协议层(session.interrupt/session.message 已有)。

---

## Task 1: useSessionChat 加 editAndResend + editing 态

**Files:**
- Modify: `web/src/hooks/useSessionChat.ts`(state + editAndResend + handle 暴露)
- Modify: `web/src/hooks/useSessionChat.test.tsx`

**Interfaces:**
- Consumes: 现有 `send`(session.message/session.interrupt)、`mkMessage`、`running`、`finishedRef`
- Produces: handle 新增 `editingIndex: number | null` / `setEditing: (index: number | null) => void` / `editAndResend: (localSessionId: string, index: number, newText: string) => Promise<void>`。Task 2/3 复用。

- [ ] **Step 1: 写失败测试 — editAndResend**

在 `web/src/hooks/useSessionChat.test.tsx` 末尾(`describe('useSessionChat - 历史灌入', ...)` 块之后,文件末尾)追加新 describe 块:

```typescript
describe('useSessionChat - 编辑重发', () => {
  // 构造已有 user+assistant 消息的会话状态(模拟发过一轮)
  function seedConversation(result: any, messages: any[]) {
    act(() => {
      // 用 sendMessage 预置:echo user + 开 assistant,然后塞入历史 assistant 文本
      // 简化:直接通过 onInbound 历史灌入构造 user/assistant 交替
    })
  }

  it('editAndResend 截断该 index 及之后消息,替换为新文本,发 session.message(不重复echo)', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    // 预置:[user "原文", assistant "回复"]
    act(() => {
      const historyEnv: any = {
        v: 1, type: 'session.history', deviceId: 'd', ts: 1, nonce: 'n', sig: '',
        payload: { items: [
          { role: 'user', text: '原文' },
          { role: 'assistant', text: '回复' },
        ] },
      }
      result.current.onInbound(historyEnv)
    })
    expect(result.current.messages.map((m: any) => m.text)).toEqual(['回复', '原文']) // 历史前置

    // 编辑 index 1(最后一条 user "原文"),新文本 "改后的"
    await act(async () => {
      await result.current.editAndResend('s1', 1, '改后的')
    })
    // 截断:user "原文" 被替换为 "改后的",之后的 assistant "回复"... 注意历史前置顺序
    // 历史灌入后 messages = [assistant "回复"(idx0), user "原文"(idx1)],editAndResend(1) 截断 idx1 及之后
    // → [assistant "回复"(idx0)] + 新 user "改后的" + 空 assistant mkMessage
    const texts = result.current.messages.map((m: any) => (m.role === 'user' ? m.text : '(assistant)'))
    expect(texts).toEqual(['(assistant)', '改后的', '(assistant)'])
    // 发了 session.message,文本是改后的
    const lastCall = send.mock.calls[send.mock.calls.length - 1]
    expect(lastCall[0]).toBe('session.message')
    expect(lastCall[1].text).toBe('改后的')
    // 只发了 1 次 session.message(没有重复 echo 导致多次发送)
    const messageCalls = send.mock.calls.filter((c) => c[0] === 'session.message')
    expect(messageCalls.length).toBe(1)
  })

  it('editAndResend 在 running 时先调 interrupt', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    // 预置一条 user + 进入 running(模拟流式中)
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.history', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { items: [{ role: 'user', text: '原文' }] } } as any)
    })
    act(() => {
      // session.delta 触发 setRunning(true)
      result.current.onInbound({ v: 1, type: 'session.delta', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { localSessionId: 's1', text: '流式中' } } as any)
    })
    expect(result.current.running).toBe(true)

    await act(async () => {
      await result.current.editAndResend('s1', 0, '改后')
    })
    // running 时应先 interrupt 再 message
    const interruptCall = send.mock.calls.find((c) => c[0] === 'session.interrupt')
    const messageCall = send.mock.calls.find((c) => c[0] === 'session.message')
    expect(interruptCall).toBeTruthy()
    expect(messageCall).toBeTruthy()
    // interrupt 在 message 之前(按调用顺序)
    expect(send.mock.calls.indexOf(interruptCall!)).toBeLessThan(send.mock.calls.indexOf(messageCall!))
  })

  it('editAndResend 空文本不发送', async () => {
    const send = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useSessionChat({ send }))
    act(() => {
      result.current.onInbound({ v: 1, type: 'session.history', deviceId: 'd', ts: 1, nonce: 'n', sig: '', payload: { items: [{ role: 'user', text: '原文' }] } } as any)
    })
    await act(async () => {
      await result.current.editAndResend('s1', 0, '   ')
    })
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/hooks/useSessionChat.test.tsx`
Expected: 3 个新测试 FAIL(editAndResend 不存在)

- [ ] **Step 3: 实现 — useSessionChat 加 editingIndex state + setEditing**

修改 `web/src/hooks/useSessionChat.ts`。在 `const [running, setRunning] = useState(false)` 附近(约第 97-100 行 state 声明区)加:

```typescript
  // 编辑重发态:正在编辑的 user 消息 index(null=非编辑态)。仅最后一条 user 可编辑。
  const [editingIndex, setEditing] = useState<number | null>(null)
```

- [ ] **Step 4: 实现 — editAndResend 方法**

修改 `web/src/hooks/useSessionChat.ts`。在 `interrupt` 的 useCallback 之后(约第 232 行 `)`,之后)、`loadHistory` 之前加:

```typescript
  // 编辑重发:截断 index 及之后的消息,用新文本替换该 user 消息 + 重发。
  // 内联发送(不调 sendMessage)避免重复 echo user。running 时先 interrupt。
  // SDK resume 旧会话带历史(UI 截断但 SDK 上下文完整,与桌面 EDIT_RESEND 一致)。
  const editAndResend = useCallback(
    async (localSessionId: string, index: number, newText: string) => {
      const trimmed = newText.trim()
      if (!trimmed) return
      // 1) 截断:丢弃 index 及之后所有消息,加新 user + 空 assistant(开新轮次)
      setMessages((prev) => {
        if (index < 0 || index >= prev.length || prev[index].role !== 'user') return prev
        return [...prev.slice(0, index), { role: 'user' as const, text: trimmed }, mkMessage()]
      })
      setEditing(null)
      finishedRef.current = false // 新 assistant 已就位,delta 续写它
      setRunning(true)
      // 2) 若在跑,先中断当前流(避免并发)
      if (running) {
        await send('session.interrupt', { localSessionId })
      }
      // 3) 用新文本重发(resume 旧会话,带历史)
      await send('session.message', { localSessionId, text: trimmed })
    },
    [send, running],
  )
```

- [ ] **Step 5: 实现 — handle 暴露 editingIndex/setEditing/editAndResend**

修改 `web/src/hooks/useSessionChat.ts` 的返回值(约第 249 行):

```typescript
  return { messages, running, hasMoreHistory, historyVersion, onInbound, sendMessage, interrupt, loadHistory, reset, editingIndex, setEditing, editAndResend }
```

同时修改 `UseSessionChatHandle` 接口(约第 52-81 行的接口定义),在 `reset()` 之后加:

```typescript
  /** 当前编辑的 user 消息 index(null=非编辑态)。 */
  editingIndex: number | null
  /** 进入/退出编辑态(传 index 进入编辑该消息,传 null 退出)。 */
  setEditing: (index: number | null) => void
  /** 编辑重发:截断 index 及之后消息,用新文本替换该 user + 中断(若在跑)+ 重发。 */
  editAndResend(localSessionId: string, index: number, newText: string): Promise<void>
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd web && npx vitest run src/hooks/useSessionChat.test.tsx`
Expected: 所有测试 PASS(含 3 个新测试 + 原有测试)

- [ ] **Step 7: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 8: 提交**

```bash
git add web/src/hooks/useSessionChat.ts web/src/hooks/useSessionChat.test.tsx
git commit -m "feat: 移动端 useSessionChat 加 editAndResend(编辑重发)+ editing 态

截断 index 及之后消息用新文本替换 + 重发。内联发送(不调sendMessage避免重复echo)。
running 时先 interrupt 再 message。SDK resume 旧会话带历史(对齐桌面EDIT_RESEND)。
localSessionId 作为参数传入(与sendMessage/interrupt同款)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: ChatPage 渲染编辑按钮 + 原位编辑 UI

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`(props + user 消息渲染编辑按钮 + 原位编辑)
- Modify: `web/src/pages/ChatPage.test.tsx`

**Interfaces:**
- Consumes: App 透传的 `editingIndex` / `onStartEdit` / `onCancelEdit` / `onEditResend`
- Produces: 无(UI 终点)

- [ ] **Step 1: 写失败测试 — 编辑按钮 + 原位编辑**

在 `web/src/pages/ChatPage.test.tsx` 末尾追加新 describe 块:

```typescript
describe('ChatPage - 编辑重发', () => {
  const userMsg = (text: string): AnyMessage => ({ role: 'user', text })
  const assistantMsg = (text: string): AnyMessage => ({ role: 'assistant', text, thinking: '', blocks: [] })
  const baseProps = {
    title: 't', running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('最后一条 user 消息(非running)显示编辑按钮', () => {
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('问题'), assistantMsg('回复'), userMsg('最后一个问题')]}
        editingIndex={null}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    // 只在最后一条 user 消息上有编辑按钮(共1个)
    expect(screen.getAllByLabelText(/编辑/).length).toBe(1)
  })

  it('running 时不显示编辑按钮', () => {
    render(
      <ChatPage
        {...baseProps}
        running={true}
        messages={[userMsg('问题')]}
        editingIndex={null}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/编辑/)).not.toBeInTheDocument()
  })

  it('editingIndex 命中时,该消息原位变 textarea(初始值=消息文本)+ 保存/取消', () => {
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('待编辑')]}
        editingIndex={0}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('待编辑')
    expect(screen.getByRole('button', { name: /保存/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /取消/ })).toBeInTheDocument()
  })

  it('点保存 → onEditResend(index, 新文本)', () => {
    const onEditResend = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('原文')]}
        editingIndex={0}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onEditResend={onEditResend}
      />,
    )
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '改后' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    expect(onEditResend).toHaveBeenCalledWith(0, '改后')
  })

  it('点取消 → onCancelEdit', () => {
    const onCancelEdit = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('原文')]}
        editingIndex={0}
        onStartEdit={() => {}}
        onCancelEdit={onCancelEdit}
        onEditResend={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    expect(onCancelEdit).toHaveBeenCalled()
  })

  it('点编辑按钮 → onStartEdit(该消息 index)', () => {
    const onStartEdit = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        messages={[userMsg('问题'), assistantMsg('回复'), userMsg('最后')]}
        editingIndex={null}
        onStartEdit={onStartEdit}
        onCancelEdit={() => {}}
        onEditResend={() => {}}
      />,
    )
    fireEvent.click(screen.getAllByLabelText(/编辑/)[0])
    expect(onStartEdit).toHaveBeenCalledWith(2) // 最后一条 user 在 index 2
  })

  it('未传 onEditResend 时不渲染编辑按钮(向后兼容)', () => {
    render(<ChatPage {...baseProps} messages={[userMsg('x')]} />)
    expect(screen.queryByLabelText(/编辑/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 7 个新测试 FAIL(新 props 未声明/未渲染)

- [ ] **Step 3: 实现 — ChatPageProps 加 4 个可选 props**

修改 `web/src/pages/ChatPage.tsx` 的 ChatPageProps 接口(找到 `onRemoveImage?: (index: number) => void` 之后,约第 65 行)加:

```typescript
  /** 编辑重发:正在编辑的 user 消息 index(null=非编辑态)。 */
  editingIndex?: number | null
  /** 点编辑按钮进入编辑态(传该消息 index)。 */
  onStartEdit?: (index: number) => void
  /** 取消编辑。 */
  onCancelEdit?: () => void
  /** 保存编辑并重发(传 index + 新文本)。 */
  onEditResend?: (localSessionId: undefined, index: number, newText: string) => void
```

注: onEditResend 的 localSessionId 由 App 在透传时用闭包绑定(见 Task 3),ChatPage 只传 (index, newText)。为简单起见,ChatPage 的 prop 签名是 `(index: number, newText: string) => void`:

```typescript
  /** 保存编辑并重发(传 index + 新文本)。localSessionId 由 App 绑定。 */
  onEditResend?: (index: number, newText: string) => void
```

(用这个简化签名,删掉上面带 localSessionId 的那行)

- [ ] **Step 4: 实现 — 解构 props + 编辑态 state**

修改 ChatPage 组件解构(找到 `onRemoveImage,` 之后,约第 137 行)加:

```typescript
    onRemoveImage,
    editingIndex,
    onStartEdit,
    onCancelEdit,
    onEditResend,
  } = props
```

在组件内 canSend 附近加编辑态本地 state:

```typescript
  // 原位编辑:正在编辑的文本(初始从被编辑消息取)。保存/取消时清空。
  const [editValue, setEditValue] = useState('')
  // editingIndex 变化时(进入编辑),同步 editValue 为该消息文本
  useEffect(() => {
    if (editingIndex != null && messages[editingIndex]?.role === 'user') {
      setEditValue((messages[editingIndex] as any).text || '')
    }
  }, [editingIndex, messages])
```

需在顶部 import 加 useEffect(若未有):`import React, { useCallback, useEffect, useRef, useState } from 'react'`(useEffect 已 import,确认即可)。

- [ ] **Step 5: 实现 — user 消息渲染:编辑按钮 + 原位编辑**

修改 `web/src/pages/ChatPage.tsx` 的 `messages.map` 渲染(约第 290-296 行的 `if (m.role === 'user')` 分支)。替换整个 user 分支:

```tsx
        {messages.map((m, i) => {
          if (m.role === 'user') {
            // 编辑态:该消息原位变 textarea + 保存/取消
            if (editingIndex === i) {
              return (
                <div key={i} className="msg user editing">
                  <textarea
                    className="edit-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={2}
                  />
                  <div className="edit-actions">
                    <button className="edit-save-btn" onClick={() => onEditResend?.(i, editValue)}>保存</button>
                    <button className="edit-cancel-btn" onClick={() => onCancelEdit?.()}>取消</button>
                  </div>
                </div>
              )
            }
            // 找最后一条 user 消息的 index(决定是否显示编辑按钮)
            const lastUserIndex = (() => {
              for (let j = messages.length - 1; j >= 0; j--) if (messages[j].role === 'user') return j
              return -1
            })()
            const canEdit = !running && i === lastUserIndex && onEditResend
            return (
              <div key={i} className="msg user">
                <div className="msg-bubble user-bubble">{m.text}</div>
                {canEdit && (
                  <button className="edit-btn" onClick={() => onStartEdit?.(i)} aria-label="编辑">编辑</button>
                )}
              </div>
            )
          }
          return (
            <div key={i} className="msg assistant">
```

- [ ] **Step 6: 实现 — styles.css 加编辑样式**

在 `web/src/styles.css` 末尾追加:

```css
/* 编辑重发 */
.edit-btn {
  background: transparent; border: 0; color: var(--text-muted);
  font-size: 12px; padding: 4px 0 0 0; cursor: pointer;
}
.edit-btn:hover { color: var(--text); }
.msg.user.editing { display: flex; flex-direction: column; gap: 6px; }
.edit-input {
  width: 100%; font-size: 14px; padding: 8px; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  resize: vertical; min-height: 40px; font-family: inherit;
}
.edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
.edit-save-btn { padding: 4px 14px; border-radius: var(--r-sm); background: var(--accent); color: #fff; border: 0; cursor: pointer; font-size: 13px; }
.edit-cancel-btn { padding: 4px 14px; border-radius: var(--r-sm); background: var(--bg-sunken); color: var(--text); border: 1px solid var(--border); cursor: pointer; font-size: 13px; }
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 所有测试 PASS(含 7 个新测试 + 原有测试)

- [ ] **Step 8: 类型检查 + 全套回归**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

Run: `cd web && npx vitest run`
Expected: 全 PASS

- [ ] **Step 9: 提交**

```bash
git add web/src/pages/ChatPage.tsx web/src/styles.css web/src/pages/ChatPage.test.tsx
git commit -m "feat: 移动端 ChatPage 编辑重发 UI(编辑按钮+原位编辑)

最后一条user消息(非running)显示编辑按钮,点后原位变textarea+保存/取消。
editingIndex命中时渲染编辑态,editValue独立state(不污染inputValue/草稿)。
保存→onEditResend(index,新文本),取消→onCancelEdit。条件渲染向后兼容。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: App 接线(editAndResend/editingIndex/setEditing 透传 ChatPage)

**Files:**
- Modify: `web/src/App.tsx`(透传 4 个 props,App 用闭包绑定 localSessionId)

**Interfaces:**
- Consumes: Task 1 的 `chat.editingIndex` / `chat.setEditing` / `chat.editAndResend(localSessionId, index, newText)`、Task 2 的 ChatPageProps(onEditResend(index, newText) / editingIndex / onStartEdit / onCancelEdit)
- Produces: 无(集成终点)

- [ ] **Step 1: 实现 — App 透传编辑相关 props**

修改 `web/src/App.tsx` 渲染 ChatPage 处(找到 `onRemoveImage={removeImage}` 之后,约第 312 行)加 4 个 props:

```typescript
          onRemoveImage={removeImage}
          editingIndex={chat.editingIndex}
          onStartEdit={chat.setEditing}
          onCancelEdit={() => chat.setEditing(null)}
          onEditResend={(index, newText) => {
            if (view.kind === 'chat') void chat.editAndResend(view.localSessionId, index, newText)
          }}
          headerExtra={themeToggle}
```

- [ ] **Step 2: 运行全套测试确认不破坏**

Run: `cd web && npx vitest run`
Expected: 全 PASS

- [ ] **Step 3: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: 提交**

```bash
git add web/src/App.tsx
git commit -m "feat: 移动端 App 接线编辑重发(透传 editAndResend/editing/setEditing)

App 用闭包绑定 view.localSessionId 给 editAndResend,ChatPage 只传(index,新文本)。
onStartEdit=chat.setEditing,onCancelEdit=()=>setEditing(null)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 仅最后一条 user 可编辑(非running) — Task 2 Step 5(canEdit = !running && i===lastUserIndex)
- ✅ 编辑入口:消息上编辑按钮 — Task 2 Step 5(edit-btn)
- ✅ 原位编辑(textarea+保存/取消) — Task 2 Step 5(editingIndex===i 分支)
- ✅ UI 截断 + SDK resume — Task 1 Step 4(editAndResend 截断+发 session.message,localSessionId 透传 resume)
- ✅ running 时先 interrupt — Task 1 Step 4(if running await interrupt)
- ✅ 内联发送避免 echo 重复 — Task 1 Step 4(不调 sendMessage,手动 setMessages 截断+加 user+mkMessage)
- ✅ editValue 独立 state 不污染草稿 — Task 2 Step 4(editValue state)
- ✅ 向后兼容 — Task 2 Step 1 测试(未传 onEditResend 不渲染)

**2. Placeholder scan:** 无 TODO/TBD,每个 step 有完整代码或精确命令。

**3. Type consistency:**
- `editAndResend(localSessionId: string, index: number, newText: string): Promise<void>` — Task 1 handle 定义,Task 3 App 调用 `chat.editAndResend(view.localSessionId, index, newText)`,签名一致
- `editingIndex: number | null` / `setEditing: (index: number | null) => void` — Task 1 handle,Task 2 ChatPageProps(editingIndex?: number | null / onStartEdit?: (index)=>void),Task 3 透传,一致
- ChatPage `onEditResend?: (index: number, newText: string) => void`(Task 2 简化签名,localSessionId 由 App 闭包绑定)— Task 3 透传 `(index, newText) => chat.editAndResend(view.localSessionId, index, newText)`,一致

**注意点(实现时留意):**
- Task 1 Step 5 接口签名:onEditResend 在 ChatPageProps 用简化签名 `(index, newText) => void`(不带 localSessionId,因 App 闭包绑定)。Task 2 Step 3 实现时用简化签名(删掉带 localSessionId 那行)
- Task 1 测试里历史灌入后 messages 是前置的(assistant "回复" 在 idx0,user "原文" 在 idx1),editAndResend(1) 截断 idx1 及之后。测试断言已考虑这个顺序
- Task 2 Step 5 的 lastUserIndex 计算放在 map 内每次算(可优化但 messages 小,可接受),或提到 map 外 useMemo。计划内联简单实现
- editValue useEffect 依赖 [editingIndex, messages],editingIndex 变化时同步初始值
