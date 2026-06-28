# 移动端输入框对齐 — 子项目 B4:编辑重发

**日期**:2026-06-27
**状态**:设计阶段
**关联**:移动端输入框全面对齐。A/B1/B2/B3 已完成。本文档是 B4。

## Context(背景与目标)

移动端发错消息后无法修改。桌面端有编辑重发(ChatArea):最后一条 user 消息的编辑按钮 → 就地编辑 → 截断该消息及之后的所有回复 + 用新文本重发(EDIT_RESEND reducer 截断 + claude.send resume 旧会话)。

**关键发现:远程协议层无需新通道。** 编辑重发的截断是纯前端(本地 messages 数组),中断用现有 session.interrupt,重发用现有 session.message(带 claudeSessionId resume,A 阶段已通)。SDK resume 旧会话带历史(UI 截断但 SDK 上下文完整,与桌面行为一致)。**B4 是纯前端改动**。

**B4 目标**:移动端最后一条 user 消息可编辑重发——点编辑按钮 → 原位变可编辑输入框 → 保存后截断该消息及之后的回复 + 中断当前流(若在跑) + 用新文本重发(resume 旧会话)。

**不在 B4 范围**:任意消息编辑(仅最后一条)、排队模式(B5)。

## 设计决策(已与用户确认)

1. **编辑范围**:仅最后一条 user 消息(且非流式 running 时),与桌面一致。
2. **编辑入口**:该消息上显示编辑按钮(非长按),非流式时可见。
3. **编辑态 UI**:原位编辑——该 user 消息气泡变 textarea + 保存/取消按钮,保存后恢复气泡。
4. **SDK 上下文**:UI 截断 + SDK resume 旧会话(带历史),对齐桌面。不新开 session。
5. **中断配合**:编辑重发时若 running,先 interrupt 再发新 message。

## 改动方案

### 层 1:useSessionChat.ts — editAndResend + 编辑态

- 加 `editingIndex` state(`number | null`,null=非编辑态)和 setEditing
- 加 `editAndResend(index: number, newText: string)`:
  ```ts
  const editAndResend = useCallback(async (index: number, newText: string) => {
    const trimmed = newText.trim()
    if (!trimmed) return
    // 1) 截断本地 messages:保留 index 之前 + 替换该 user 消息为新文本,丢弃之后所有(assistant 回复)
    setMessages(prev => {
      if (index < 0 || index >= prev.length || prev[index].role !== 'user') return prev
      return [...prev.slice(0, index), { role: 'user' as const, text: trimmed }]
    })
    setEditingIndex(null)
    // 2) 若在跑,先中断当前流(避免并发)
    if (running) await interrupt(localSessionId)
    // 3) 用新文本重发(resume 旧会话,带历史——与桌面 EDIT_RESEND 一致)
    await sendMessage(localSessionId, trimmed)
  }, [running, localSessionId, interrupt, sendMessage])
  ```
  - 注:sendMessage 内部已 echo user 消息 + 开新 assistant 轮次,但这里我们手动截断+替换了 user 消息,sendMessage 的 echo 会再加一条重复 user。**需调整**:editAndResend 不走 sendMessage 的 echo,而是直接发 session.message + 手动开 assistant 轮次。详见实现注意事项。

**实现注意事项(echo 重复问题):**
sendMessage 内部会 `setMessages(prev => [...prev, { role:'user', text }, mkMessage()])`(echo user + 开 assistant)。editAndResend 已手动截断+替换 user,若再调 sendMessage 会重复加 user。
解决:editAndResend 内联发送逻辑,不调 sendMessage:
```ts
// 截断+替换 user 后,手动开新 assistant 轮次 + 发 session.message(不 echo user)
setMessages(prev => [...prev, { role: 'user', text: trimmed }, mkMessage()])
finishedRef.current = false
setRunning(true)
if (editingInterruptNeeded) await interrupt(localSessionId)
await send('session.message', { localSessionId, text: trimmed })
```
即:editAndResend 自己负责"截断到 index(不含) + 加新 user + 开 assistant + 发 message",复用 sendMessage 的 send/echo 模式但起点是截断而非追加。

### 层 2:ChatPage.tsx — 编辑按钮 + 原位编辑 UI

- ChatPageProps 加:`onEditResend?: (index: number, newText: string) => void` / `editingIndex?: number | null` / `onStartEdit?: (index: number) => void` / `onCancelEdit?: () => void`
- 渲染逻辑:遍历 messages 时,若 `i === editingIndex`,渲染 textarea + 保存/取消(而非气泡);否则正常渲染气泡
- 最后一条 user 消息(且非 running、非编辑态)渲染编辑按钮(点 → onStartEdit(i))
- 编辑态:本地 editValue state(初始=该消息文本),保存 → onEditResend(i, editValue),取消 → onCancelEdit

### 层 3:App.tsx — 接线

- useSessionChat 已暴露 editAndResend/editingIndex/setEditing(层 1 加的)
- 透传给 ChatPage:onEditResend={chat.editAndResend} / editingIndex={chat.editingIndex} / onStartEdit={chat.setEditing} / onCancelEdit={() => chat.setEditing(null)}

## 关键点

- **纯前端改动**:不碰协议层(session.interrupt / session.message 已有)
- **echo 不重复**:editAndResend 内联发送(截断到 index + 加新 user + 开 assistant + 发 message),不调 sendMessage 的 echo
- **中断时序**:先 setRunning(false) 视觉停止?不——先 interrupt(SDK 层中断),interrupt 后 SDK 会发 claude:aborted/result 收尾。editAndResend 在 interrupt 后再发新 message。running 态判断:若当前 running 才 interrupt。
- **仅最后一条 user + 非流式**:编辑按钮只在「该消息是最后一条 user」且「!running」且「非编辑态」时显示
- **草稿不污染**:编辑用独立 editValue state,不动 inputValue(B3 草稿)

## 测试策略

1. **useSessionChat.test.tsx** 加 editAndResend 测试:
   - 编辑中间 user 消息 → 截断该 index 及之后 + 替换为新文本 + 发 session.message(interrupt 若 running)
   - running 时 editAndResend 先调 interrupt
   - 不调 sendMessage 的 echo(无重复 user)
2. **ChatPage.test.tsx** 加:
   - 最后一条 user 消息(非 running)显示编辑按钮
   - 点编辑 → 该消息变 textarea(editValue 初始=消息文本)
   - 保存 → onEditResend(index, newText)
   - 取消 → onCancelEdit
   - running 时不显示编辑按钮
3. 现有测试不破坏

## 验证

- `cd web && npx vitest run`(全套含新增)
- `cd web && npx tsc --noEmit`
- 手动 smoke(用户做):pnpm web:dev,发消息→AI 回复→点最后一条 user 编辑→改文本→保存→观察截断+重发
