# 通知设置细粒度化设计

> 将常规设置的通知开关从单一总闸展开为主开关 + 折叠的 4 个场景开关 + 声音开关，同时新增对 SDK notification 事件的原生拦截。

## 背景

当前通知设置只有两个开关：`taskNotify`（任务完成时通知）和 `notifySound`（通知声音）。通知逻辑硬编码在 `ChatArea.tsx` 的 `onResult` 里，只在任务完成时触发，不支持任务出错、需要确认、权限请求等场景。

SDK 会发 `system.subtype='notification'` 消息（Claude 需要人类介入时），但 `claude-service.ts` 的 `forwardEvent` 目前未处理该 subtype，落入兜底分支。

## 通知事件来源映射

| 开关 | 触发时机 | SDK 事件来源 |
|---|---|---|
| 任务完成 | AI 回复结束 | `result` 消息（`isError: false`） |
| 任务出错 | 任务失败 | `result` 消息（`isError: true`）或 `error` 事件 |
| 需要确认 | Claude 请求人类介入 | `system` 消息（`subtype: 'notification'`）— **新增拦截** |
| 权限请求 | 工具权限弹窗 | `dialog-request` 事件（已有 IPC 通道） |

## 后端设计

### claude-service.ts 新增 notification 拦截

在 `forwardEvent` 的 system 分支 subtype 判断链中新增：

```typescript
} else if (subtype === 'notification') {
  webContents.send('claude:notification', {
    localSessionId: lsid,
    text: sys.text || '',
    priority: sys.priority || 'medium',
  })
}
```

### preload 暴露 onNotification

```typescript
onNotification: (cb: (data: any) => void) => {
  ipcRenderer.on('claude:notification', (_, data) => cb(data))
},
```

同时补到 `removeAllListeners` 的清理列表里（`'claude:notification'`）。

### AppSettings 新增字段

`src/renderer/types.ts` 和 `src/main/settings-store.ts`：

```typescript
notifyOnComplete: boolean    // 默认 true
notifyOnError: boolean       // 默认 true
notifyOnConfirm: boolean     // 默认 true
notifyOnPermission: boolean  // 默认 true
```

## 前端设计

### ChatArea.tsx 通知逻辑重构

提取统一通知函数，主开关短路 + 子开关分流：

```typescript
function notify(title: string, body: string) {
  const s = settingsRef.current
  if (!s.taskNotify) return       // 主开关关闭，直接短路
  if (!('Notification' in window)) return
  const n = new Notification(title, { body, silent: !s.notifySound })
  n.onclick = () => window.focus()
}
```

- **onResult**：`isError` 为 true 走 `notifyOnError`，否则走 `notifyOnComplete`
- **onNotification**（新增监听）：走 `notifyOnConfirm`，防抖 10 秒去重
- **onDialogRequest**：走 `notifyOnPermission`

### 防抖去重

同一 `text` 内容 10 秒内只通知一次，避免 SDK notification 频繁触发（如权限等待超时反复重试）。

用 `useRef` 存最近通知的 `{ text, ts }`，在 `notify` 函数里检查：

```typescript
const lastNotifRef = useRef<{ text: string; ts: number } | null>(null)
function notify(title: string, body: string) {
  const s = settingsRef.current
  if (!s.taskNotify) return
  // 防抖：同一 body 10 秒内不重复
  const now = Date.now()
  if (lastNotifRef.current && lastNotifRef.current.text === body && now - lastNotifRef.current.ts < 10000) return
  lastNotifRef.current = { text: body, ts: now }
  if (!('Notification' in window)) return
  const n = new Notification(title, { body, silent: !s.notifySound })
  n.onclick = () => window.focus()
}
```

### GeneralSettings.tsx 通知区域重构

主开关 + 折叠详细设置：

```
┌─ 通知 ─────────────────────────────────┐
│  桌面通知            [Toggle: taskNotify] │  ← 主开关，控制折叠
│                                         │
│  （主开关开启时展开以下）                  │
│  ├ 任务完成          [Toggle]             │
│  ├ 任务出错          [Toggle]             │
│  ├ 需要确认          [Toggle]             │
│  ├ 权限请求          [Toggle]             │
│  └ 通知声音          [Toggle]  noBorder   │
└─────────────────────────────────────────┘
```

交互逻辑：
- `taskNotify` 关闭：详细区域不渲染（条件渲染，非 CSS 隐藏），运行时通知逻辑短路
- `taskNotify` 开启：展开 5 个子开关，子开关值保留
- 子开关行 `paddingLeft: 16px` 缩进
- 主开关描述改为「启用后可在下方按场景精细控制通知」

### i18n 文案

新增 key（中/英）：
- `chat.taskError` / `chat.taskErrorBody`：任务出错通知标题/正文
- `chat.needsAttention`：需要确认通知标题
- `chat.permissionRequest`：权限请求通知标题
- `settings.notifyOnComplete` / `desc`：任务完成 + 描述
- `settings.notifyOnError` / `desc`：任务出错 + 描述
- `settings.notifyOnConfirm` / `desc`：需要确认 + 描述
- `settings.notifyOnPermission` / `desc`：权限请求 + 描述

## 测试策略

1. **settings-store 默认值**：扩展 `cc-desk-store.test.ts`，确认 4 个新字段默认 `true`
2. **前端组件测试**：扩展 `settings-pages.test.tsx`，验证主开关关闭时子开关不渲染、开启时渲染 5 行
3. **手动验证**：`npm run dev`，操作通知开关 + 触发不同场景

## 风险与缓解

1. **SDK notification 频繁触发**：10 秒防抖去重
2. **dialog-request 与 notification 时序**：权限请求时可能同时触发两个事件。notification 拦截里不额外过滤——两个事件语义不同（dialog-request 是权限弹窗，notification 是超时等待），用户可能分别想开/关。防抖已覆盖极短时间内的重复文本
3. **Notification 权限**：Electron 桌面通知需要系统授权，首次使用时可能弹系统授权框（已有行为，不改变）
