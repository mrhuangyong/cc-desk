# 移动端输入框对齐 — 子项目 B3:草稿持久化

**日期**:2026-06-27
**状态**:设计阶段
**关联**:移动端输入框全面对齐。A(协议层)/B1(控件)/B2(图片附件)已完成。本文档是 B3。

## Context(背景与目标)

移动端输入框文本目前是 App.tsx 的普通 useState(inputValue),切会话/退出 PWA/刷新即丢失。桌面端是 store.draft 按 localSessionId 持久化(切会话各自保留)。移动端已有 localStorage 机制(useTheme.ts、pair.ts 存 deviceId/desktopKey)。

**B3 目标**:移动端输入框文本按会话持久化到 localStorage——切会话、退出、刷新后回到该会话仍能看到上次未发送的输入。发送后清除,会话归档后也清除。

**不在 B3 范围**:图片附件持久化(base64 可能几 MB,localStorage 容量限制,已确认不做——切会话/退出后未发图片丢失)、编辑重发(B4)、排队(B5)。

## 设计决策(已与用户确认)

1. **持久化粒度**:按会话存(每个 localSessionId 各自的草稿,与桌面 store.draft 一致)。
2. **草稿内容**:只存文本(不存图片附件,避开 localStorage 5-10MB 容量限制)。
3. **存储方式**:localStorage(复用现有 useTheme/pair.ts 机制,PWA 同源持久)。
4. **清理时机**:发送后清 + 会话归档后清(避免残留垃圾)。
5. **写入频率**:每次按键(onInputChange)直接写(文本小,开销可忽略,不丢输入)。

## 改动方案

### 层 1:纯函数 — draft-storage(可独立单测)

新建 `web/src/lib/draft-storage.ts`(对齐 pair.ts 的 localStorage 封装模式):

```ts
// web/src/lib/draft-storage.ts
// 按会话(localSessionId)持久化输入草稿到 localStorage。
// 只存文本(不存图片附件,避开 localStorage 容量限制)。PWA 同源持久,切会话/退出/刷新后恢复。

const PREFIX = 'cc-desk-draft:'

/** 读取某会话的草稿文本。无则返回空串。localStorage 不可用时静默返回 ''。 */
export function loadDraft(localSessionId: string): string {
  try {
    return localStorage.getItem(PREFIX + localSessionId) ?? ''
  } catch {
    return ''  // 隐私模式/禁用 localStorage 时静默
  }
}

/** 保存某会话草稿。text 为空则删除该 key(避免残留空草稿)。localStorage 不可用时静默。 */
export function saveDraft(localSessionId: string, text: string): void {
  try {
    if (text) localStorage.setItem(PREFIX + localSessionId, text)
    else localStorage.removeItem(PREFIX + localSessionId)
  } catch {
    // 隐私模式/容量满/禁用时静默(草稿不持久,但不影响输入功能)
  }
}

/** 清除某会话草稿(发送后/归档后调用)。localStorage 不可用时静默。 */
export function clearDraft(localSessionId: string): void {
  try {
    localStorage.removeItem(PREFIX + localSessionId)
  } catch {
    // 静默
  }
}
```

### 层 2:App.tsx 接入草稿

- **进会话时恢复**:当 view 切到 chat(view.localSessionId 变化),用 loadDraft 初始化 inputValue。
  - 用 useEffect 监听 view.localSessionId,变化时 setInputValue(loadDraft(localSessionId))
- **输入时保存**:onInputChange 已是 setInputValue,需在 setInputValue 同时 saveDraft(localSessionId, value)。
  - 改 onInputChange 回调为 `(v) => { setInputValue(v); if (view.kind === 'chat') saveDraft(view.localSessionId, v) }`
- **发送后清**:handleSend 里发送成功后 clearDraft(view.localSessionId)(与 setInputValue('') 并列)。
- **归档后清**:onArchive 回调里 clearDraft(localSessionId)。

### 关键点

- **进会话恢复**用 useEffect 监听 view.localSessionId(不是每次 render),避免重复 load。
- **onInputChange 改造**:当前直接传 setInputValue,需包一层加上 saveDraft。
- **localStorage 全程 try/catch**:隐私模式/容量满/禁用时不崩(草稿不持久但输入功能不受影响)。
- **发送/归档清**:与 setInputValue('')/归档逻辑并列加 clearDraft。
- 只在 view.kind === 'chat' 时操作(view 为 list 时无 localSessionId)。

## 测试策略

1. **draft-storage.ts 纯函数单测**(`web/src/lib/draft-storage.test.ts`,mock localStorage):
   - saveDraft + loadDraft 往返一致
   - saveDraft 空文本 → 删除 key(loadDraft 返回 '')
   - clearDraft → loadDraft 返回 ''
   - loadDraft 不存在的会话 → ''
   - localStorage 抛错(隐私模式)→ 静默不崩
2. **App 集成**:进会话恢复草稿、输入时保存、发送后清空(可用 jsdom localStorage,无需 mock)
3. 现有测试不破坏

## 验证

- `cd web && npx vitest run`(全套含新增)
- `cd web && npx tsc --noEmit`
- 手动 smoke(用户做):pnpm web:dev,输入文本 → 切到列表 → 回到该会话 → 文本恢复;退出/刷新同验证;发送后清空
