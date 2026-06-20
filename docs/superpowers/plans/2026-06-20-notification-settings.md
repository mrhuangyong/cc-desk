# 通知设置细粒度化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通知设置从单一总闸展开为主开关 + 折叠的 4 个场景开关 + 声音开关，新增 SDK notification 事件原生拦截。

**Architecture:** 后端 claude-service.ts 新增 `system.subtype='notification'` 拦截 + preload 暴露 onNotification。前端 ChatArea.tsx 重构通知逻辑为统一函数 + 子开关分流，GeneralSettings.tsx 通知区域改为主开关折叠卡片。

**Tech Stack:** TypeScript, Electron (IPC), React, vitest

---

## 文件结构

**修改：**
- `src/main/claude-service.ts` — forwardEvent 新增 notification subtype 拦截
- `src/preload/index.ts` — 暴露 onNotification + 补 removeAllListeners
- `src/renderer/global.d.ts` — ClaudeAPI 加 onNotification
- `src/renderer/types.ts` — AppSettings 加 4 个 notifyOn* 字段
- `src/main/settings-store.ts` — 默认值加 4 个字段
- `src/renderer/state/store.tsx` — 默认值加 4 个字段
- `src/renderer/components/ChatArea.tsx` — 通知逻辑重构
- `src/renderer/components/settings/GeneralSettings.tsx` — 通知折叠卡片
- `src/renderer/i18n/index.ts` — 新增通知相关 i18n key
- `tests/settings-pages.test.tsx` — 通知设置测试
- `tests/cc-desk-store.test.ts` — 默认值测试

---

## Task 1: 后端 — SDK notification 拦截 + preload + 类型

**Files:**
- Modify: `src/main/claude-service.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/renderer/types.ts`
- Modify: `src/main/settings-store.ts`
- Modify: `src/renderer/state/store.tsx`

- [ ] **Step 1: claude-service.ts 新增 notification 拦截**

在 `src/main/claude-service.ts` 的 `forwardEvent` 方法里，system 分支的 subtype 判断链中，在 `task_progress` 之后追加：

```typescript
        } else if (subtype === 'notification') {
          webContents.send('claude:notification', {
            localSessionId: lsid,
            text: sys.text || '',
            priority: sys.priority || 'medium',
          })
        }
```

- [ ] **Step 2: preload 暴露 onNotification**

在 `src/preload/index.ts` 的 claude 对象里，`onSubagentOutput` 之后追加：

```typescript
    onNotification: (cb: (data: any) => void) => { ipcRenderer.on('claude:notification', (_, data) => cb(data)) },
```

在 `removeAllListeners` 的 channel 列表数组里追加 `'claude:notification'`：

```typescript
      ['claude:system', 'claude:delta', 'claude:blocks', 'claude:notice', 'claude:task', 'claude:result', 'claude:error', 'claude:aborted', 'claude:dialog-request', 'claude:backend-task', 'claude:builtin-result', 'claude:plan', 'claude:subagent-output', 'claude:notification', 'update:state']
```

- [ ] **Step 3: global.d.ts 加 onNotification 类型**

在 `src/renderer/global.d.ts` 的 ClaudeAPI 接口里，`onDialogRequest` 之后追加：

```typescript
  onNotification(cb: (data: { localSessionId: string; text: string; priority: string }) => void): void
```

- [ ] **Step 4: AppSettings 加 4 个字段**

在 `src/renderer/types.ts` 的 AppSettings 接口里，`notifySound: boolean` 之后追加：

```typescript
  notifyOnComplete: boolean
  notifyOnError: boolean
  notifyOnConfirm: boolean
  notifyOnPermission: boolean
```

在 `src/main/settings-store.ts` 的接口定义里同样位置追加 4 个字段。在 `defaults` 对象里加默认值：

```typescript
  notifyOnComplete: true,
  notifyOnError: true,
  notifyOnConfirm: true,
  notifyOnPermission: true,
```

在 `src/renderer/state/store.tsx` 的 `initialSettings` 里，`notifySound: true` 之后追加：

```typescript
  notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true,
```

在 `src/main/settings-store.ts` 底部的 `PERSIST_KEYS` 数组里追加 4 个 key：

```typescript
;(['inheritTerminal', 'n', 'notifySound', 'notifyOnComplete', 'notifyOnError', 'notifyOnConfirm', 'notifyOnPermission', 'showThinking', 'showTodo', 'showBackendTask', 'autoArchive'] as const).forEach(k => {
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 6: 提交**

```bash
git add src/main/claude-service.ts src/preload/index.ts src/renderer/global.d.ts src/renderer/types.ts src/main/settings-store.ts src/renderer/state/store.tsx
git commit -m "feat(notify): SDK notification 拦截 + 4 个细粒度通知开关字段"
```

---

## Task 2: i18n 文案

**Files:**
- Modify: `src/renderer/i18n/index.ts`

- [ ] **Step 1: 新增 i18n key**

在 `src/renderer/i18n/index.ts` 的中文字典里（`'chat.taskDoneBody'` 之后）追加：

```typescript
    'chat.taskError': '任务出错',
    'chat.taskErrorBody': '任务执行失败，请检查',
    'chat.needsAttention': '需要确认',
    'chat.permissionRequest': '权限请求',
    'settings.notifyOnComplete': '任务完成',
    'settings.notifyOnCompleteDesc': 'AI 回复结束时通知',
    'settings.notifyOnError': '任务出错',
    'settings.notifyOnErrorDesc': '任务失败或出错时通知',
    'settings.notifyOnConfirm': '需要确认',
    'settings.notifyOnConfirmDesc': 'Claude 需要人类介入时通知',
    'settings.notifyOnPermission': '权限请求',
    'settings.notifyOnPermissionDesc': '工具需要权限确认时通知',
    'settings.notifyMaster': '桌面通知',
    'settings.notifyMasterDesc': '启用后可在下方按场景精细控制通知',
    'settings.notifySound': '通知声音',
    'settings.notifySoundDesc': '关闭后通知静音',
```

在英文字典里同样位置追加对应英文：

```typescript
    'chat.taskError': 'Task error',
    'chat.taskErrorBody': 'Task execution failed, please check',
    'chat.needsAttention': 'Needs attention',
    'chat.permissionRequest': 'Permission request',
    'settings.notifyOnComplete': 'Task complete',
    'settings.notifyOnCompleteDesc': 'Notify when AI response ends',
    'settings.notifyOnError': 'Task error',
    'settings.notifyOnErrorDesc': 'Notify when task fails or errors',
    'settings.notifyOnConfirm': 'Needs confirmation',
    'settings.notifyOnConfirmDesc': 'Notify when Claude needs human input',
    'settings.notifyOnPermission': 'Permission request',
    'settings.notifyOnPermissionDesc': 'Notify when a tool needs permission',
    'settings.notifyMaster': 'Desktop notifications',
    'settings.notifyMasterDesc': 'Enable to control notifications by scenario below',
    'settings.notifySound': 'Notification sound',
    'settings.notifySoundDesc': 'Mute notifications when off',
```

- [ ] **Step 2: 验证 i18n 完整性测试通过**

Run: `npx vitest run tests/i18n-completeness.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/renderer/i18n/index.ts
git commit -m "feat(i18n): 通知设置细粒度文案"
```

---

## Task 3: ChatArea.tsx 通知逻辑重构

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx`

- [ ] **Step 1: 提取统一通知函数 + 子开关分流**

在 `src/renderer/components/ChatArea.tsx` 中，找到 `settingsRef` 定义附近，新增防抖 ref 和统一 notify 函数。

在 `const settingsRef = useRef(...)` 之后追加：

```typescript
  const lastNotifRef = useRef<{ text: string; ts: number } | null>(null)
```

在 `onResult` 回调里，替换现有通知逻辑。找到这段代码：

```typescript
      // 任务通知：任务完成时发桌面通知（受常规设置 taskNotify 控制）
      const s = settingsRef.current
      if (s.taskNotify && 'Notification' in window) {
        const n = new Notification(t('chat.taskDone'), { body: t('chat.taskDoneBody'), silent: !s.notifySound })
        n.onclick = () => window.focus()
      }
```

替换为：

```typescript
      // 任务通知：按场景分流（主开关短路 + 子开关控制）
      const s = settingsRef.current
      const fireNotify = (title: string, body: string) => {
        if (!s.taskNotify) return
        if (!('Notification' in window)) return
        const now = Date.now()
        if (lastNotifRef.current && lastNotifRef.current.text === body && now - lastNotifRef.current.ts < 10000) return
        lastNotifRef.current = { text: body, ts: now }
        const n = new Notification(title, { body, silent: !s.notifySound })
        n.onclick = () => window.focus()
      }
      if (data.isError) {
        if (s.notifyOnError) fireNotify(t('chat.taskError'), t('chat.taskErrorBody'))
      } else {
        if (s.notifyOnComplete) fireNotify(t('chat.taskDone'), t('chat.taskDoneBody'))
      }
```

- [ ] **Step 2: 新增 onNotification 监听**

在 `onDialogRequest` 监听之后追加 `onNotification` 监听。找到 `api.onDialogRequest` 回调块，在其后追加：

```typescript
    api.onNotification((data: any) => {
      const s = settingsRef.current
      if (!s.notifyOnConfirm) return
      if (!s.taskNotify) return
      if (!('Notification' in window)) return
      const now = Date.now()
      const body = data.text || t('chat.needsAttention')
      if (lastNotifRef.current && lastNotifRef.current.text === body && now - lastNotifRef.current.ts < 10000) return
      lastNotifRef.current = { text: body, ts: now }
      const n = new Notification(t('chat.needsAttention'), { body, silent: !s.notifySound })
      n.onclick = () => window.focus()
    })
```

- [ ] **Step 3: onDialogRequest 加权限请求通知**

找到 `api.onDialogRequest` 回调块，在现有逻辑之后追加通知：

```typescript
    api.onDialogRequest((data: any) => {
      // ...existing dialog handling logic...
      // 权限请求通知
      const s = settingsRef.current
      if (s.notifyOnPermission && s.taskNotify && 'Notification' in window) {
        const n = new Notification(t('chat.permissionRequest'), {
          body: (data?.toolName || data?.tool_name) || '',
          silent: !s.notifySound,
        })
        n.onclick = () => window.focus()
      }
    })
```

注意：在现有 `onDialogRequest` 回调的末尾（dispatch 之后）追加通知代码，不改动现有弹窗逻辑。

- [ ] **Step 4: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/ChatArea.tsx
git commit -m "feat(notify): ChatArea 通知逻辑重构（4 场景分流 + 防抖去重）"
```

---

## Task 4: GeneralSettings.tsx 通知折叠卡片

**Files:**
- Modify: `src/renderer/components/settings/GeneralSettings.tsx`

- [ ] **Step 1: 重构通知区域**

在 `src/renderer/components/settings/GeneralSettings.tsx` 中，找到通知 SettingsCard 块：

```tsx
      {/* 通知 */}
      <SettingsCard>
        <SettingsRow title="任务通知" desc="任务完成、失败或需要确认时发送桌面通知。">
          <Toggle on={s.taskNotify} onChange={v => persist({ taskNotify: v })} />
        </SettingsRow>
        <SettingsRow title="通知声音" desc="通知开启后，可单独关闭任务通知提示音。" noBorder>
          <Toggle on={s.notifySound} onChange={v => persist({ notifySound: v })} />
        </SettingsRow>
      </SettingsCard>
```

替换为：

```tsx
      {/* 通知 */}
      <SettingsCard>
        <SettingsRow title={t('settings.notifyMaster')} desc={t('settings.notifyMasterDesc')}>
          <Toggle on={s.taskNotify} onChange={v => persist({ taskNotify: v })} />
        </SettingsRow>
        {s.taskNotify && (
          <div style={{ paddingLeft: 16 }}>
            <SettingsRow title={t('settings.notifyOnComplete')} desc={t('settings.notifyOnCompleteDesc')}>
              <Toggle on={s.notifyOnComplete} onChange={v => persist({ notifyOnComplete: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifyOnError')} desc={t('settings.notifyOnErrorDesc')}>
              <Toggle on={s.notifyOnError} onChange={v => persist({ notifyOnError: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifyOnConfirm')} desc={t('settings.notifyOnConfirmDesc')}>
              <Toggle on={s.notifyOnConfirm} onChange={v => persist({ notifyOnConfirm: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifyOnPermission')} desc={t('settings.notifyOnPermissionDesc')}>
              <Toggle on={s.notifyOnPermission} onChange={v => persist({ notifyOnPermission: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifySound')} desc={t('settings.notifySoundDesc')} noBorder>
              <Toggle on={s.notifySound} onChange={v => persist({ notifySound: v })} />
            </SettingsRow>
          </div>
        )}
      </SettingsCard>
```

注意：确保 `t` 函数在 GeneralSettings 组件作用域内可用（检查是否已 import useI18n）。

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无新错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/GeneralSettings.tsx
git commit -m "feat(ui): 通知设置折叠卡片（主开关 + 4 场景 + 声音）"
```

---

## Task 5: 测试更新

**Files:**
- Modify: `tests/settings-pages.test.tsx`
- Modify: `tests/cc-desk-store.test.ts`

- [ ] **Step 1: settings-pages 测试验证折叠行为**

在 `tests/settings-pages.test.tsx` 的 GeneralSettings 相关测试里，新增通知折叠测试。找到 GeneralSettings 的 describe 块，追加：

```typescript
  it('通知主开关关闭时子开关不渲染', async () => {
    const { GeneralSettings } = await import('../src/renderer/components/settings/GeneralSettings')
    setApi({ settings: { get: vi.fn().mockResolvedValue({ taskNotify: false, notifySound: true, notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true }) } })
    render(<GeneralSettings />)
    await screen.findByText('桌面通知')
    expect(screen.queryByText('任务完成')).toBeNull()
  })

  it('通知主开关开启时子开关渲染', async () => {
    const { GeneralSettings } = await import('../src/renderer/components/settings/GeneralSettings')
    setApi({ settings: { get: vi.fn().mockResolvedValue({ taskNotify: true, notifySound: true, notifyOnComplete: true, notifyOnError: true, notifyOnConfirm: true, notifyOnPermission: true }) } })
    render(<GeneralSettings />)
    await screen.findByText('任务完成')
    expect(screen.getByText('任务出错')).toBeTruthy()
    expect(screen.getByText('需要确认')).toBeTruthy()
    expect(screen.getByText('权限请求')).toBeTruthy()
  })
```

注意：测试文本用 i18n 的中文值。如果测试环境语言默认是中文（store 初始 lang 是 'zh'），直接用中文断言。如果 GeneralSettings 测试的 mock 方式不同（可能通过 store 而非 setApi），需适配现有模式。

- [ ] **Step 2: cc-desk-store 默认值测试**

在 `tests/cc-desk-store.test.ts` 里，找到默认值验证部分，追加 4 个新字段：

```typescript
  it('默认通知设置', () => {
    // 确认 4 个新字段默认 true
    expect(settings.notifyOnComplete).toBe(true)
    expect(settings.notifyOnError).toBe(true)
    expect(settings.notifyOnConfirm).toBe(true)
    expect(settings.notifyOnPermission).toBe(true)
  })
```

注意：适配现有测试结构——如果 cc-desk-store.test.ts 的默认值测试方式是检查 `initialSettings` 对象，直接加断言。

- [ ] **Step 3: 运行全部测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add tests/settings-pages.test.tsx tests/cc-desk-store.test.ts
git commit -m "test: 通知设置折叠行为 + 默认值测试"
```

---

## Task 6: 最终集成验证

- [ ] **Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: 全部通过

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 仅预存的 dataPath/bump-version 错误

- [ ] **Step 3: 提交（如有遗漏）**

```bash
git add -A
git commit -m "feat: 通知设置细粒度化完整实现"
```
