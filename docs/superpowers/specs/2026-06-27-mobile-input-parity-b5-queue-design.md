# 移动端输入框对齐 — 子项目 B5:排队模式

**日期**:2026-06-27
**状态**:设计阶段
**关联**:移动端输入框全面对齐。A/B1/B2/B3/B4 已完成。本文档是 B5(最后一个)。

## Context(背景与目标)

移动端 AI 流式回复时,用户发的新消息当前直接走 sendMessage,行为不可预期(可能被 SDK 内部排队或拒绝)。桌面端有 queue/guide 双模式(queueMode 设置):queue=进队列 AI 结束后自动发,guide=中断当前 AI 立即发。桌面队列消息可编辑/立即发/取消。

**B5 目标**:移动端 AI 流式时,用户发新消息按当前模式处理——queue(默认)进队列 + AI 结束自动发,guide 中断 + 200ms 后立即发。模式在输入框上方控件栏切换。队列消息可见(显示 chip)。

**不在 B5 范围**:队列消息取消/立即发/编辑(YAGNI,先跑通核心排队闭环)。

## 设计决策(已与用户确认)

1. **模式范围**:queue + guide 双模式(与桌面完全一致)。
2. **模式切换 UI**:输入框上方控件栏加切换(与权限/思考 select 并排)。
3. **队列操作**:只做"可见"(排队消息在输入框上方显示 chip),不做取消/立即发/编辑。
4. **guide 时序**:interrupt 后 200ms 再发(对齐桌面)。
5. **默认模式**:queue(与桌面 store 默认一致)。

## 改动方案

### 层 1:useSessionChat.ts — 队列状态 + 排队逻辑

- 加 `queue` state(`string[]`,排队消息文本)
- `sendMessage` 改造,接受可选 `queueMode`:
  ```ts
  sendMessage(localSessionId, text, opts?: {...原opts, queueMode?: 'queue' | 'guide'})
  ```
  - running 且 queueMode='queue' → `setQueue(prev => [...prev, trimmed])`(不直接发,不 echo)
  - running 且 queueMode='guide' → `interrupt(localSessionId)` + setTimeout 200ms 后真正发送(echo + send)
  - !running → 直接发(原逻辑)
- running 结束(session.result 收尾时)的处理:**自动出队**——但 session.result 在 onInbound 里,需在 result 后检查 queue。加 useEffect 监听 running:false 且 queue 非空 → 发队首 + 出队。
- 暴露 queue 给 UI

**自动出队的实现(useEffect)**:
```ts
useEffect(() => {
  if (!running && queue.length > 0 && localSessionIdRef) {
    const next = queue[0]
    setQueue(prev => prev.slice(1))
    // 真正发送(echo + send),不再判断 queueMode(出队即直接发)
    setMessages(prev => [...prev, { role: 'user', text: next }, mkMessage()])
    finishedRef.current = false
    setRunning(true)
    void send('session.message', { localSessionId, text: next })
  }
}, [running, queue, send])
```
注:useSessionChat 不持有 localSessionId(参数传入),自动出队需要 localSessionId——用 ref 缓存最近的 localSessionId(sendMessage 调用时更新 localSessionIdRef.current)。

### 层 2:App.tsx — currentQueueMode state + handleSend 透传

- 加 `const [currentQueueMode, setCurrentQueueMode] = useState<'queue' | 'guide'>('queue')`
- handleSend 透传:`chat.sendMessage(lsId, text, { permission, thinking, images, queueMode: currentQueueMode })`
- 透传 currentQueueMode + setCurrentQueueMode + chat.queue 给 ChatPage

### 层 3:ChatPage.tsx — 模式切换 select + 队列 chip 栏

- ChatPageProps 加:`currentQueueMode?: 'queue' | 'guide'` / `onQueueModeChange?: (mode) => void` / `queue?: string[]`
- 控件栏(权限/思考 select 旁)加 queue/guide 切换 select(选项:`排队`/`中断`)
- 输入框上方(控件栏下、chip 栏位置)加队列消息显示:`queue.map(text => <div className="queue-chip">排队中: {text}</div>)`

## 关键点

- **双模式**:queue(排队,默认)/ guide(中断立即发)
- **队列可见**:排队消息显示 chip(只可见)
- **自动出队**:useEffect 监听 running:false + queue 非空,发队首 + 出队
- **guide 时序**:interrupt 后 setTimeout 200ms 再发
- **localSessionId ref**:useSessionChat 不持有 localSessionId,自动出队的 useEffect 用 ref 缓存最近的(sendMessage 时更新)
- **sendMessage 不 echo 排队消息**:queue 模式只入队不 echo(等出队时才 echo),避免 UI 显示未发的消息又没真正在跑
- 纯前端状态(queue 在 useSessionChat),不碰协议层

## 测试策略

1. **useSessionChat.test.tsx** 加:
   - running + queueMode='queue' → 消息进 queue,不直接 send
   - running + queueMode='guide' → interrupt 后 200ms 发(vi.useFakeTimers)
   - !running → 直接发(原逻辑)
   - running 结束 + queue 非空 → 自动发队首 + 出队
2. **ChatPage.test.tsx** 加:
   - 控件栏渲染 queue/guide select,选中值正确,onChange 触发
   - queue 非空 → 渲染对应数量 chip
3. 现有测试不破坏

## 验证

- `cd web && npx vitest run`(全套含新增)
- `cd web && npx tsc --noEmit`
- 手动 smoke(用户做):pnpm web:dev,AI 流式中发消息→排队(guide 则中断立即发)→AI 结束后排队消息自动发
