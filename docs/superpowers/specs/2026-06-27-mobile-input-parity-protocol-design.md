# 移动端输入框对齐桌面端 — 子项目 A:发送参数协议层对齐

**日期**:2026-06-27
**状态**:设计阶段
**关联**:移动端输入框全面对齐桌面端(分解为 A 协议层 / B UI控件 / C 智能输入 三个子项目)

## Context(背景与目标)

桌面端输入框(InputBar)能传递 `claude.send` 的全部参数(思考强度、权限模式、图片附件、附加目录、模型等共 14 类能力),移动端目前只是"纯文本对讲机"——`sendMessage` 只传 `{localSessionId, text}`,远程协议层把其余参数全部截断。

**根因**:主进程 `claude.send`(claude-service.ts:313)已完整支持所有参数,但远程控制协议层(remote-bridge.ts 的 `deps.send` 签名 + `session.message` dispatcher 分支)只解析透传了 `thinking`/`modelId`,缺 `permission`/`extraDirs`/`images`。

**子项目 A 目标**:把远程协议层这层"截断"补齐,让移动端 session.message 能透传桌面端 claude.send 的全部参数。同时让移动端**立即能用**思考强度和权限模式两项(协议层改完后,移动端 sendMessage 加这两个参数 + 简单状态即可,UI 控件留给子项目 B)。

**不在 A 范围**(留给 B/C):
- 移动端 UI 控件(权限/思考下拉、图片 chip 栏、队列 UI)
- 移动端草稿持久化、编辑重发 UI
- @ 文件搜索、/ 斜杠命令(C 子项目)

## 设计决策(已与用户确认)

1. **移动端原生实现,不引 TipTap**——桌面端富文本最终塌缩为纯文本交给 Claude,移动端用纯 textarea + 控件功能等价,首屏体积友好。
2. **权限模式 per-send 传**——每次 session.message 带当前 permission(与桌面 buildQuery 一致),不引入会话级状态协议。移动端 UI 记住当前选择随消息发出。
3. **协议层一次全通**——思考/权限/图片/目录都在 A 加到协议层,B 只做 UI,无需再动协议。
4. **逐个子项目推进**——A 走完整设计→计划→实现→验证流程后,再启动 B。

## 改动方案(三层,对齐现有 thinking 透传模式)

### 层 1:dispatcher `session.message` 分支(remote-bridge.ts:282-296)

扩展 payload 解析 + 透传给 `deps.send`:

```ts
const p = env.payload as {
  localSessionId: string; text: string;
  claudeSessionId?: string; modelId?: string;
  thinking?: 'low' | 'medium' | 'high';
  permission?: string;        // 新增:中文标签(变更前确认/自动编辑/计划模式/完全访问)
  extraDirs?: string[];       // 新增:附加目录绝对路径
  images?: { mediaType: string; data: string; name?: string }[];  // 新增:data 为纯 base64
}
// ...已有 cwd/sessionId/notifyRemoteUserMessage 逻辑不变
await deps.send({
  prompt: p.text, localSessionId: p.localSessionId, sessionId, cwd,
  thinking: p.thinking,
  permission: p.permission,      // 新增透传
  extraDirs: p.extraDirs,        // 新增透传
  images: p.images,              // 新增透传
})
```

### 层 2:`deps.send` 签名补齐(remote-bridge.ts:208)

```ts
send: (opts: {
  prompt: string; localSessionId?: string; sessionId?: string;
  modelId?: string; thinking?: 'low' | 'medium' | 'high';
  cwd?: string;
  permission?: string;          // 新增
  extraDirs?: string[];         // 新增
  images?: { mediaType: string; data: string; name?: string }[];  // 新增
  webContents?: any;
}) => Promise<void>
```

### 层 3:index.ts 注入(index.ts:181)— 无需改

现有注入 `send: (opts) => claude.send({ ...opts, webContents: wc })` 用 spread,opts 含新字段会自动透传给 claude.send(其签名已支持,claude-service.ts:313)。

### 层 4:移动端 sendMessage 立即用上思考/权限(useSessionChat.ts)

`sendMessage` 签名扩展,接受可选 permission/thinking,随 session.message 发出:

```ts
const sendMessage = useCallback(
  async (localSessionId: string, text: string, opts?: { permission?: string; thinking?: 'low'|'medium'|'high' }) => {
    // ...已有逻辑
    await send('session.message', { localSessionId, text: trimmed, ...opts })
  }, [send],
)
```

调用方(App.tsx handleSend)需提供当前 permission/thinking。**当前选择的状态存储**:在 App.tsx 加两个 useState(`currentPermission`/`currentThinking`),默认 `'变更前确认'`/`'medium'`。UI 控件(下拉)留给 B,但状态已就绪,A 完成后可在代码层面传参验证。

## 关键技术点

- **图片 base64 体积**:relay WebSocket 透传大 payload。探索确认 relay 只限流 50msg/s,无字节上限——可行。单张图片 base64 可能几 MB,但 WebSocket 默认无 frame 限制,relay/server.ts 不设 maxPayload。无需额外处理。
- **permission 中文标签**:与桌面端一致(桌面 InputBar.tsx:16 硬编码 `['变更前确认','自动编辑','计划模式','完全访问']`),主进程 `getPermissionMode`(builtin-commands.ts:23)翻译为 SDK permissionMode。移动端硬编码同一份常量。
- **向后兼容**:所有新增字段可选。旧版移动端不传 → 主进程按 undefined 处理(permission 默认 'default',images/extraDirs 空),行为与现在一致。

## 测试策略

1. **dispatcher 测试**(tests/remote-bridge-dispatch.test.ts,已有模式):
   - session.message 带 permission → deps.send 收到 permission
   - session.message 带 extraDirs → deps.send 收到 extraDirs
   - session.message 带 images → deps.send 收到 images
   - session.message 不带这些字段 → 向后兼容(undefined,不报错)
2. **移动端 sendMessage 测试**(web/src/hooks/useSessionChat.test.tsx):
   - sendMessage 传 permission/thinking → session.message payload 含这些字段
3. 现有 thinking 透传测试保持通过(回归)

## 验证

- `pnpm test`(根)全套通过,新增 dispatcher 测试覆盖 permission/extraDirs/images 透传
- `pnpm --filter web test`(或 cd web && pnpm test)通过,新增 sendMessage 传参测试
- `npx tsc --noEmit`(根 + web)类型检查通过
- 手动 smoke(用户做):pnpm dev + pnpm dev:remote,移动端 sendMessage 传 thinking/permission,观察桌面端 SDK 行为(思考强度/权限模式生效)

## 后续子项目(本文档不展开)

- **B**:移动端 UI 控件——权限/思考/模型下拉、图片附件选择+粘贴+chip栏、草稿持久化、排队模式 UI、编辑重发入口
- **C**:@ 文件搜索(需远程 fs.searchFiles IPC)、/ 斜杠命令(需拉取命令/技能列表 + builtin 通道)、可选富文本格式
