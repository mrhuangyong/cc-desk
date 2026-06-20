# 对话宽度、消息编辑重发、交互行为修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话区域宽度分档可调；最后一条用户消息支持就地编辑重发；修复任务执行阶段无法发送消息的 bug 并完善队列/引导交互模式。

**Architecture:** 纯渲染端 + settings 持久化改动，不涉及主进程 IPC 契约变更。宽度通过 CSS 变量动态注入；编辑重发通过新 reducer action 截断消息历史后重发；交互行为修复集中在 InputBar 的 onSendClick 入口逻辑。

**Tech Stack:** Electron + React + TypeScript + TipTap + Vitest + electron-store

**Spec:** `docs/superpowers/specs/2026-06-20-chat-width-edit-resend-interaction-design.md`

---

## File Structure

**修改文件清单:**
- `src/main/settings-store.ts` — schema 加 `chatWidth`，queueMode 默认值/兼容
- `src/renderer/types.ts` — AppSettings 加 `chatWidth`
- `src/renderer/state/reducer.ts` — AppState 加 `editingMessageId`/`editingQueueId`，新 action 处理
- `src/renderer/state/actions.ts` — 新 action 类型
- `src/renderer/App.tsx` — chatWidth → CSS 变量 useEffect
- `src/renderer/index.css` — `:root` 默认宽度改 960px
- `src/renderer/components/settings/GeneralSettings.tsx` — 对话宽度 Segmented + 交互行为文案
- `src/renderer/components/InputBar.tsx` — onSendClick 修复 + 按钮图标 + queueMode 值 + 队列编辑
- `src/renderer/components/ChatArea.tsx` — 用户消息 hover 编辑 + 就地编辑态
- `src/renderer/i18n/index.ts` — 新文案 key（中英）
- `tests/reducer.test.ts` — initialState 补字段 + 新 action 测试

---

### Task 1: settings 数据层 — chatWidth 字段 + queueMode 兼容

**Files:**
- Modify: `src/main/settings-store.ts:92-98`（schema）、`:196`（defaults）、`:245`（withDefaults 标量列表）
- Modify: `src/renderer/types.ts:235`（AppSettings）

- [ ] **Step 1: settings-store.ts — schema 加 chatWidth**

在 `src/main/settings-store.ts` 的 `AppSettings` interface 中，`zoom: string` 行下方加：

```typescript
  zoom: string              // 界面缩放 small | normal | large
  chatWidth: string         // 对话宽度 compact | standard | wide | xwide
```

- [ ] **Step 2: settings-store.ts — defaults 加 chatWidth**

在 `defaults` 对象中，`zoom: 'normal',` 行下方加：

```typescript
  zoom: 'normal',
  chatWidth: 'wide',
```

- [ ] **Step 3: settings-store.ts — withDefaults 标量列表加 chatWidth**

在 `withDefaults` 函数中，标量列表行：

```typescript
  ;(['theme', 'lang', 'zoom', 'proxy', 'terminalFont', 'queueMode', 'archiveDays'] as const).forEach(k => {
```

改为：

```typescript
  ;(['theme', 'lang', 'zoom', 'chatWidth', 'proxy', 'terminalFont', 'queueMode', 'archiveDays'] as const).forEach(k => {
```

- [ ] **Step 4: settings-store.ts — queueMode 旧值兼容**

在 `withDefaults` 函数中，`merged.queueMode = ...` 之后（标量列表之后），加一段 interrupt→guide 迁移：

```typescript
  // queueMode 旧值兼容：interrupt → guide
  if (merged.queueMode === 'interrupt') merged.queueMode = 'guide'
```

- [ ] **Step 5: settings-store.ts — defaults 中 queueMode 注释更新**

把 `queueMode: string         // queue | interrupt` 改为 `queueMode: string         // queue | guide`。

- [ ] **Step 6: types.ts — AppSettings 加 chatWidth**

在 `src/renderer/types.ts` 中，`zoom: string` 行下方加：

```typescript
  zoom: string
  chatWidth: string
```

- [ ] **Step 7: 类型检查**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx tsc --noEmit 2>&1 | head -30`
Expected: 可能有 "Property 'chatWidth' is missing" 报错（reducer.test.ts 的 initialState），暂不管，后续 Task 修复。

- [ ] **Step 8: Commit**

```bash
cd /Users/mrhua/projects/aieditor/cc-desk && git add src/main/settings-store.ts src/renderer/types.ts && git commit -m "feat(settings): chatWidth 字段 + queueMode interrupt→guide 兼容"
```

---

### Task 2: reducer 数据层 — editingMessageId / editingQueueId / 新 actions

**Files:**
- Modify: `src/renderer/state/reducer.ts`（AppState + 新 case）
- Modify: `src/renderer/state/actions.ts`（新 action 类型）
- Test: `tests/reducer.test.ts`

- [ ] **Step 1: reducer.ts — AppState 加两个字段**

在 `src/renderer/state/reducer.ts` 的 `AppState` interface 中，`updateStatus: UpdateStatus` 上方加：

```typescript
  // 就地编辑：当前正在编辑的消息 id（最后一条用户消息编辑重发）
  editingMessageId: string | null
  // 队列编辑：当前正在编辑的排队消息 id
  editingQueueId: string | null
  // 应用更新状态机（全局单例）。TitleBar / 应用菜单 / 关于页共享。
```

- [ ] **Step 2: actions.ts — 新 action 类型**

在 `src/renderer/state/actions.ts` 中，`CLEAR_QUEUE` action 之后加：

```typescript
  | { type: 'CLEAR_QUEUE'; sessionId: string }
  // 编辑重发：截断指定消息及其之后的所有消息，并用新文本替换该用户消息
  | { type: 'EDIT_RESEND'; sessionId: string; messageId: string; newPrompt: string }
  // 就地编辑态控制
  | { type: 'SET_EDITING_MESSAGE'; messageId: string | null }
  // 队列消息编辑态控制 + 更新排队消息文本
  | { type: 'SET_EDITING_QUEUE'; queueId: string | null }
  | { type: 'UPDATE_QUEUED_MESSAGE'; sessionId: string; queueId: string; prompt: string }
```

- [ ] **Step 3: reducer.ts — 处理 SET_EDITING_MESSAGE / SET_EDITING_QUEUE**

在 `CLEAR_QUEUE` case 之后加：

```typescript
    case 'SET_EDITING_MESSAGE': {
      return { ...state, editingMessageId: action.messageId }
    }
    case 'SET_EDITING_QUEUE': {
      return { ...state, editingQueueId: action.queueId }
    }
    case 'UPDATE_QUEUED_MESSAGE': {
      const q = state.queueBySession[action.sessionId] ?? []
      return {
        ...state,
        queueBySession: {
          ...state.queueBySession,
          [action.sessionId]: q.map(m => m.id === action.queueId ? { ...m, prompt: action.prompt } : m),
        },
      }
    }
```

- [ ] **Step 4: reducer.ts — 处理 EDIT_RESEND**

在 `UPDATE_QUEUED_MESSAGE` case 之后加：

```typescript
    case 'EDIT_RESEND': {
      // 截断：删除 messageId 及其之后的所有消息，用 newPrompt 替换该用户消息内容
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => {
          if (s.id !== action.sessionId) return s
          const idx = s.messages.findIndex(m => m.id === action.messageId)
          if (idx === -1) return s
          const replaced = {
            ...s.messages[idx],
            content: [{ type: 'text' as const, text: action.newPrompt }],
          }
          return { ...s, messages: [...s.messages.slice(0, idx), replaced] }
        }),
      }))
      return { ...state, projects, editingMessageId: null }
    }
```

- [ ] **Step 5: tests/reducer.test.ts — initialState 补字段**

在 `initialState()` 函数中，`updateStatus` 行之前加两个新字段，并在 settings 对象中加 `chatWidth`：

```typescript
    settings: {
      apiKey: '', model: 'model-sonnet', cwd: '', providers: [], models: [], modelRoleMap: {},
      theme: 'codex-light', lang: 'zh-CN', zoom: 'normal', chatWidth: 'wide', proxy: '', inheritTerminal: true,
      terminalFont: 'MesloLGS NF, monospace', taskNotify: true, notifySound: true, queueMode: 'queue',
      showThinking: false, showTodo: false, showBackendTask: true, autoArchive: true, archiveDays: '7', dataPath: '',
      codePreview: { lightTheme: 'GitHub Light', darkTheme: 'GitHub Dark', showLineNumbers: true, wordWrap: false, fontSize: 12 },
      skills: [], mcpServers: [], plugins: [], commands: [], hooks: [],
    },
```

并在 return 对象末尾 `updateStatus` 之前加：

```typescript
    editingMessageId: null,
    editingQueueId: null,
    updateStatus: { state: 'idle' },
```

- [ ] **Step 6: 写 EDIT_RESEND 测试**

在 `tests/reducer.test.ts` 中加测试用例：

```typescript
  it('EDIT_RESEND 截断指定消息及后续消息并替换文本', () => {
    const state = initialState()
    // s1 的 messages 从 fixtures 来，取第一条用户消息 id
    const firstMsg = state.projects[0].sessions[0].messages[0]
    const before = state.projects[0].sessions[0].messages.length
    const next = reducer(state, {
      type: 'EDIT_RESEND',
      sessionId: 's1',
      messageId: firstMsg.id,
      newPrompt: '编辑后的文本',
    })
    const msgs = next.projects[0].sessions[0].messages
    expect(msgs.length).toBeLessThanOrEqual(before)
    expect(msgs[msgs.length - 1].content[0]).toMatchObject({ type: 'text', text: '编辑后的文本' })
    expect(next.editingMessageId).toBeNull()
  })

  it('UPDATE_QUEUED_MESSAGE 更新排队消息文本', () => {
    const state = initialState()
    const enq = reducer(state, { type: 'ENQUEUE_MESSAGE', sessionId: 's1', prompt: '原始', attachments: [] })
    const qid = enq.queueBySession['s1'][0].id
    const next = reducer(enq, { type: 'UPDATE_QUEUED_MESSAGE', sessionId: 's1', queueId: qid, prompt: '修改后' })
    expect(next.queueBySession['s1'][0].prompt).toBe('修改后')
  })

  it('SET_EDITING_MESSAGE 设置编辑态', () => {
    const state = initialState()
    const next = reducer(state, { type: 'SET_EDITING_MESSAGE', messageId: 'm1' })
    expect(next.editingMessageId).toBe('m1')
  })
```

- [ ] **Step 7: 运行测试**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx vitest run tests/reducer.test.ts 2>&1 | tail -20`
Expected: 全部 PASS（包括新增 3 个用例）。

- [ ] **Step 8: Commit**

```bash
cd /Users/mrhua/projects/aieditor/cc-desk && git add src/renderer/state/reducer.ts src/renderer/state/actions.ts tests/reducer.test.ts && git commit -m "feat(reducer): EDIT_RESEND/SET_EDITING_MESSAGE/队列编辑 actions + chatWidth 测试适配"
```

---

### Task 3: 对话宽度 — CSS 变量 + App.tsx 应用 + 设置 UI

**Files:**
- Modify: `src/renderer/index.css:122`
- Modify: `src/renderer/App.tsx`（zoom 逻辑附近）
- Modify: `src/renderer/components/settings/GeneralSettings.tsx`
- Modify: `src/renderer/i18n/index.ts`

- [ ] **Step 1: index.css — 默认宽度改 960px**

把 `src/renderer/index.css` 中 `:root { --chat-max-width: 800px; }` 改为：

```css
:root { --chat-max-width: 960px; }
```

- [ ] **Step 2: App.tsx — chatWidth → CSS 变量 useEffect**

在 `src/renderer/App.tsx` 中，zoom 逻辑（`const zoomFactor = ...`）之后加：

```typescript
  // 对话宽度：按 chatWidth 档位动态写入 CSS 变量，覆盖 index.css 的 :root 默认值
  const chatWidthPx = (() => {
    const w = state.settings.chatWidth
    return w === 'compact' ? 760 : w === 'standard' ? 880 : w === 'xwide' ? 1080 : 960
  })()
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-max-width', `${chatWidthPx}px`)
  }, [chatWidthPx])
```

- [ ] **Step 3: i18n — 加文案 key**

在 `src/renderer/i18n/index.ts` 的 zh-CN 字典中，找到 `'settings.' 区域，加：

```typescript
    'settings.chatWidth': '对话宽度',
    'settings.chatWidthDesc': '调整对话区域的显示宽度。',
    'settings.chatWidthCompact': '紧凑',
    'settings.chatWidthStandard': '标准',
    'settings.chatWidthWide': '宽松',
    'settings.chatWidthXWide': '超宽',
    'settings.interaction': '交互行为',
    'settings.interactionDesc': 'Agent 运行时发送消息的处理方式。',
    'settings.interactionQueue': '队列',
    'settings.interactionQueueDesc': '运行中将后续消息加入队列，任务完成后逐条发送',
    'settings.interactionGuide': '引导',
    'settings.interactionGuideDesc': '运行中发送的消息会立即中断当前任务并优先处理',
```

在 en 字典中对应位置加：

```typescript
    'settings.chatWidth': 'Chat Width',
    'settings.chatWidthDesc': 'Adjust the display width of the chat area.',
    'settings.chatWidthCompact': 'Compact',
    'settings.chatWidthStandard': 'Standard',
    'settings.chatWidthWide': 'Wide',
    'settings.chatWidthXWide': 'X-Wide',
    'settings.interaction': 'Interaction',
    'settings.interactionDesc': 'How messages are handled when sent during an active task.',
    'settings.interactionQueue': 'Queue',
    'settings.interactionQueueDesc': 'Messages during an active task are queued and sent after completion',
    'settings.interactionGuide': 'Guide',
    'settings.interactionGuideDesc': 'Messages during an active task immediately interrupt and prioritize',
```

- [ ] **Step 4: GeneralSettings.tsx — 对话宽度 Segmented**

在 `src/renderer/components/settings/GeneralSettings.tsx` 中，「界面缩放」SettingsRow 之后、「终端」SettingsCard 之前，在「外观」卡片内加：

```tsx
        <SettingsRow title={t('settings.chatWidth')} desc={t('settings.chatWidthDesc')} noBorder>
          <Segmented
            value={s.chatWidth}
            onChange={v => persist({ chatWidth: v })}
            options={[
              { id: 'compact', label: t('settings.chatWidthCompact') },
              { id: 'standard', label: t('settings.chatWidthStandard') },
              { id: 'wide', label: t('settings.chatWidthWide') },
              { id: 'xwide', label: t('settings.chatWidthXWide') },
            ]}
          />
        </SettingsRow>
```

注意：原来「界面缩放」行的 `noBorder` 要去掉（改为普通行），把 `noBorder` 移到新的「对话宽度」行。

- [ ] **Step 5: GeneralSettings.tsx — 交互行为选项改 guide + 文案**

在「交互行为」SettingsRow 中，把 select 的 options 改为：

```tsx
        <SettingsRow title={t('settings.interaction')} desc={t('settings.interactionDesc')}>
          <select value={s.queueMode} onChange={e => persist({ queueMode: e.target.value })} style={selectStyle}>
            <option value="queue">{t('settings.interactionQueue')}</option>
            <option value="guide">{t('settings.interactionGuide')}</option>
          </select>
        </SettingsRow>
```

- [ ] **Step 6: 类型检查 + 运行**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误。

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx vitest run tests/i18n-completeness.test.ts 2>&1 | tail -10`
Expected: PASS（中英 key 对齐）。

- [ ] **Step 7: Commit**

```bash
cd /Users/mrhua/projects/aieditor/cc-desk && git add src/renderer/index.css src/renderer/App.tsx src/renderer/components/settings/GeneralSettings.tsx src/renderer/i18n/index.ts && git commit -m "feat(ui): 对话宽度分档设置 + 交互行为改 guide 文案"
```

---

### Task 4: 交互行为 Bug 修复 — onSendClick + 按钮图标 + queueMode 值

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: InputBar.tsx — onSendClick 修复**

把 `onSendClick` 函数替换为：

```tsx
  const onSendClick = () => {
    if (!canSend) {
      if (isStreaming) handleStop()
      return
    }
    // 有内容时，无论是否流式都走 handleSend（queue/guide 分支会接管流式情况）
    handleSend()
  }
```

- [ ] **Step 2: InputBar.tsx — handleSend 中 queueMode 值改 guide**

把 `handleSend` 中的条件判断：

```tsx
      if (state.settings.queueMode === 'interrupt') {
```

改为：

```tsx
      if (state.settings.queueMode === 'guide') {
```

并把注释 `// 引导模式：立即中断当前任务并发送` 保留。

- [ ] **Step 3: InputBar.tsx — 按钮图标逻辑调整**

找到圆形发送按钮的渲染部分，把图标三元判断：

```tsx
            {isStreaming ? <Square size={12} /> : <ArrowUp size={14} />}
```

改为（有内容时显示发送，无内容流式时显示停止）：

```tsx
            {isStreaming && !canSend ? <Square size={12} /> : <ArrowUp size={14} />}
```

- [ ] **Step 4: InputBar.tsx — 按钮颜色/可点逻辑同步**

把按钮 style 中的条件，从 `isStreaming || canSend` 改为 `canSend || (isStreaming && !canSend)`。具体把：

```tsx
              background: isStreaming || canSend ? 'var(--accent)' : 'var(--bg-hover)',
              color: isStreaming || canSend ? 'var(--accent-text)' : 'var(--text-faint)',
              border: 'none', cursor: isStreaming || canSend ? 'pointer' : 'not-allowed',
```

改为：

```tsx
              background: canSend ? 'var(--accent)' : isStreaming ? 'var(--accent)' : 'var(--bg-hover)',
              color: canSend ? 'var(--accent-text)' : isStreaming ? 'var(--accent-text)' : 'var(--text-faint)',
              border: 'none', cursor: canSend || isStreaming ? 'pointer' : 'not-allowed',
```

- [ ] **Step 5: Tooltip label 调整**

把 Tooltip label 从：

```tsx
          <Tooltip label={isStreaming ? t('input.stop') : t('input.send')}>
```

改为：

```tsx
          <Tooltip label={isStreaming && !canSend ? t('input.stop') : t('input.send')}>
```

- [ ] **Step 6: 类型检查**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
cd /Users/mrhua/projects/aieditor/cc-desk && git add src/renderer/components/InputBar.tsx && git commit -m "fix(input): 任务执行阶段可发送消息（onSendClick 不再截断 queue/guide 分支）"
```

---

### Task 5: 队列消息编辑操作

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: InputBar.tsx — 队列列表加编辑按钮 + 编辑态渲染**

在 InputBar.tsx 中，找到队列消息渲染的 `{queue.map((qm, i) => (...))}` 块。把整个 map 回调替换为：

```tsx
          {queue.map((qm, i) => (
            <div key={qm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg-hover)', borderRadius: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>#{i + 1}</span>
              {state.editingQueueId === qm.id ? (
                <>
                  <input
                    type="text"
                    defaultValue={qm.prompt}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                      if (e.key === 'Escape') { dispatch({ type: 'SET_EDITING_QUEUE', queueId: null }) }
                    }}
                    style={{ flex: 1, padding: '2px 6px', fontSize: 12, border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface-1)', color: 'var(--text)' }}
                  />
                  <button
                    onClick={(e) => {
                      const val = ((e.target as HTMLElement).previousSibling as HTMLInputElement)?.value?.trim() ?? qm.prompt
                      if (val) dispatch({ type: 'UPDATE_QUEUED_MESSAGE', sessionId: state.activeSessionId, queueId: qm.id, prompt: val })
                      dispatch({ type: 'SET_EDITING_QUEUE', queueId: null })
                    }}
                    title="保存"
                    style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--accent)', color: 'var(--accent-text)' }}
                  >保存</button>
                  <button
                    onClick={() => dispatch({ type: 'SET_EDITING_QUEUE', queueId: null })}
                    title="取消"
                    style={{ padding: '0 6px', fontSize: 13, lineHeight: 1, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}
                  >×</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{qm.prompt || '(空消息)'}</span>
                  <button
                    onClick={() => sendQueuedNow(qm.id)}
                    title="中断当前任务并立即发送"
                    style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--accent)', color: 'var(--accent-text)' }}
                  >立即</button>
                  <button
                    onClick={() => dispatch({ type: 'SET_EDITING_QUEUE', queueId: qm.id })}
                    title="编辑"
                    style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)' }}
                  >编辑</button>
                  <button
                    onClick={() => dispatch({ type: 'DEQUEUE_MESSAGE', sessionId: state.activeSessionId, queueId: qm.id })}
                    title="取消排队"
                    style={{ padding: '0 6px', fontSize: 13, lineHeight: 1, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}
                  >×</button>
                </>
              )}
            </div>
          ))}
```

- [ ] **Step 2: 类型检查**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
cd /Users/mrhua/projects/aieditor/cc-desk && git add src/renderer/components/InputBar.tsx && git commit -m "feat(input): 队列消息支持就地编辑（保存/取消）"
```

---

### Task 6: 最后一条用户消息编辑重发

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx`
- Modify: `src/renderer/i18n/index.ts`

- [ ] **Step 1: i18n — 加编辑相关文案**

在 `src/renderer/i18n/index.ts` 的 zh-CN 字典中加：

```typescript
    'chat.edit': '编辑重发',
    'chat.editCancel': '取消',
    'chat.editSend': '重发',
```

在 en 字典中加：

```typescript
    'chat.edit': 'Edit & resend',
    'chat.editCancel': 'Cancel',
    'chat.editSend': 'Resend',
```

- [ ] **Step 2: ChatArea.tsx — import 加 Pencil 图标**

在 `src/renderer/components/ChatArea.tsx` 顶部的 lucide-react import 中加 `Pencil`。

- [ ] **Step 3: ChatArea.tsx — 找到最后一条用户消息**

在 ChatArea 组件中，session 定义之后，加一个计算：

```tsx
  // 最后一条用户消息 id（用于编辑重发按钮）
  const lastUserMessage = (() => {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') return session.messages[i]
    }
    return null
  })()
```

- [ ] **Step 4: ChatArea.tsx — 编辑态本地 state + 编辑发送逻辑**

在 ChatArea 组件中（state/dispatch 之后），加：

```tsx
  const [editDoc, setEditDoc] = useState<any>(null)
  const editPreviewRef = useRef('')
```

并加编辑发送函数：

```tsx
  // 编辑重发：截断历史 + 用新文本发送
  const handleEditResend = () => {
    if (!lastUserMessage || !editPreviewRef.current.trim()) return
    dispatch({ type: 'EDIT_RESEND', sessionId: state.activeSessionId, messageId: lastUserMessage.id, newPrompt: editPreviewRef.current })
    setEditDoc(null)
    // 截断后用新文本发送
    const claudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
    const project = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
    const cwd = project?.path || state.settings?.cwd || undefined
    dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
    window.api?.claude?.send({
      prompt: editPreviewRef.current,
      localSessionId: state.activeSessionId,
      sessionId: claudeSessionId || undefined,
      cwd,
    })
  }
```

- [ ] **Step 5: ChatArea.tsx — 用户消息气泡加编辑按钮 + 编辑态**

找到用户消息渲染的 `// 用户消息：右对齐` 部分。把整个用户消息 div 替换为（保留原有渲染，加编辑按钮和编辑态）：

```tsx
            // 用户消息：右对齐，收紧气泡
            <div key={m.id} className="msg-row is-user" style={{
              alignSelf: 'flex-end', maxWidth: '75%',
              background: 'var(--surface-1)', borderRadius: 'var(--radius)', padding: '5px 11px',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 2,
              userSelect: 'text', cursor: 'text',
              position: 'relative',
            }}>
              {/* 编辑重发按钮：仅最后一条用户消息 + 非流式 + 非编辑态时显示 */}
              {m.id === lastUserMessage?.id && !isStreaming && state.editingMessageId !== m.id && (
                <button
                  onClick={() => {
                    setEditDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: (m.content.find((b: any) => b.type === 'text') as any)?.text ?? '' }] }] })
                    editPreviewRef.current = (m.content.find((b: any) => b.type === 'text') as any)?.text ?? ''
                    dispatch({ type: 'SET_EDITING_MESSAGE', messageId: m.id })
                  }}
                  title={t('chat.edit')}
                  style={{
                    position: 'absolute', left: -28, top: 0, opacity: 0,
                    width: 24, height: 24, borderRadius: '50%', border: 'none',
                    background: 'var(--surface-1)', boxShadow: 'var(--shadow-float)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'opacity .15s',
                  }}
                  onMouseOver={e => { e.currentTarget.style.opacity = '1' }}
                  className="edit-resend-btn"
                >
                  <Pencil size={13} />
                </button>
              )}
              {state.editingMessageId === m.id && editDoc ? (
                /* 就地编辑态：PromptEditor + 取消/重发 */
                <div style={{ minWidth: 280 }}>
                  <PromptEditor
                    doc={editDoc}
                    placeholder=""
                    allSlashItems={[]}
                    getCwd={() => ''}
                    onDocChange={(doc) => {
                      setEditDoc(doc)
                      // 提取纯文本到 ref
                      const txt = (doc?.content ?? []).map((b: any) => b.content?.map((c: any) => c.text ?? '').join('') ?? '').join('\n')
                      editPreviewRef.current = txt
                    }}
                    onSend={handleEditResend}
                    onEditorReady={() => {}}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setEditDoc(null); dispatch({ type: 'SET_EDITING_MESSAGE', messageId: null }) }}
                      style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)' }}
                    >{t('chat.editCancel')}</button>
                    <button
                      onClick={handleEditResend}
                      disabled={!editPreviewRef.current.trim()}
                      style={{ padding: '4px 12px', fontSize: 12, cursor: editPreviewRef.current.trim() ? 'pointer' : 'not-allowed', border: 'none', borderRadius: 6, background: editPreviewRef.current.trim() ? 'var(--accent)' : 'var(--bg-hover)', color: editPreviewRef.current.trim() ? 'var(--accent-text)' : 'var(--text-faint)' }}
                    >{t('chat.editSend')}</button>
                  </div>
                </div>
              ) : (
                <>
                  {m.attachment && <AttachmentChip attachment={{ type: 'pickedElement', el: m.attachment }} />}
                  {renderBlocks(m.content, true, state.subagentOutputBySession[state.activeSessionId] ?? {}, new Set((state.backendTasksBySession[state.activeSessionId] ?? []).filter(tt => tt.kind === 'subagent' && tt.toolUseId).map(tt => tt.toolUseId!)))}
                  <CopyButton text={extractText(m.content)} />
                </>
              )}
            </div>
```

- [ ] **Step 6: ChatArea.tsx — CSS hover 显示编辑按钮**

在 `src/renderer/index.css` 中加：

```css
/* 编辑重发按钮：hover 消息行时显示 */
.msg-row.is-user:hover .edit-resend-btn { opacity: 1 !important; }
```

- [ ] **Step 7: ChatArea.tsx — import 补充**

确保 ChatArea.tsx 顶部 import 包含 `useState`（已有）和 `PromptEditor`：

```tsx
import { PromptEditor } from '../editor/PromptEditor'
```

- [ ] **Step 8: 类型检查**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误。

- [ ] **Step 9: Commit**

```bash
cd /Users/mrhua/projects/aieditor/cc-desk && git add src/renderer/components/ChatArea.tsx src/renderer/index.css src/renderer/i18n/index.ts && git commit -m "feat(chat): 最后一条用户消息支持就地编辑重发"
```

---

### Task 7: 全量测试 + 构建验证

**Files:**
- 无修改，仅验证

- [ ] **Step 1: 运行全量测试**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && pnpm test 2>&1 | tail -30`
Expected: 全部 PASS。如有失败，检查是否 initialState 缺 `chatWidth` 或 `editingMessageId`/`editingQueueId` 字段。

- [ ] **Step 2: 类型检查**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && npx tsc --noEmit 2>&1 | head -20`
Expected: 无错误。

- [ ] **Step 3: 构建**

Run: `cd /Users/mrhua/projects/aieditor/cc-desk && pnpm build 2>&1 | tail -20`
Expected: 构建成功。

- [ ] **Step 4: 手动验证清单**

启动 dev server 后验证：
1. 设置 → 常规 → 对话宽度四档切换，对话区宽度实时变化
2. 发一条消息，等 Claude 回复完，hover 最后一条用户消息，出现编辑按钮
3. 点编辑，修改文本，点重发，旧消息及回复被删除，新消息发出
4. 设置 → 交互行为 → 选「队列」，Claude 任务执行中输入并发送，消息进队列，队列列表有「立即」「编辑」「×」
5. 设置 → 交互行为 → 选「引导」，Claude 任务执行中输入并发送，当前任务被中断，新消息发出
6. 流式中无内容时按钮显示停止图标（Square），输入内容后显示发送图标（ArrowUp）

---

## Self-Review

**Spec coverage:**
- 需求1（对话宽度）：Task 1（字段）+ Task 3（CSS/UI）✓
- 需求2（编辑重发）：Task 2（reducer actions）+ Task 6（UI）✓
- 需求3a（bug 修复）：Task 4 ✓
- 需求3b（命名）：Task 1（兼容）+ Task 3（文案）+ Task 4（值）✓
- 需求3c（队列编辑）：Task 2（actions）+ Task 5（UI）✓

**Placeholder scan:** 无 TBD/TODO，每步都有具体代码。

**Type consistency:** `chatWidth` 全程字符串档位 id；`editingMessageId`/`editingQueueId` 为 `string | null`；`EDIT_RESEND` / `SET_EDITING_MESSAGE` / `SET_EDITING_QUEUE` / `UPDATE_QUEUED_MESSAGE` 命名一致。
