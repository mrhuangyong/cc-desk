# 分享链接认证（替代配对码）

**日期**:2026-06-28
**状态**:设计阶段

## Context

当前配对码流程（6 位码、60 秒过期、一次性）在手机端从未成功过——时限紧、步骤多、换设备/清缓存就要重来。改为"桌面生成带 token 的 URL + 二维码，任何设备扫码/打开即连"。

## 设计决策（已与用户确认）

1. **token 即凭证**：URL 含 token（`https://ccdesk.mrhua.top/?t=xxx`），打开即连，中继认 token 不认设备。
2. **桌面注册到中继**：桌面生成 token 后经 `/pair` 注册到中继，中继存 `tokens.json`。
3. **token→桌面映射**：手机用 token 连，中继映射到桌面 deviceId 转发，手机无需自己的 deviceId。
4. **不签名**：认 token 即可（WSS/TLS 加密链路保证 token 不被窃取）。
5. **桌面设过期+可撤销**：生成时选有效期（7天/30天/永久），可手动删除。
6. **列表管理**：桌面设置页显示所有已生成链接（URL+二维码+创建时间+过期+状态），可复制/删除。
7. **每个链接有二维码**：手机扫码直接打开 URL 建立连接。
8. **完全切换**：移除配对码流程，现有已配对设备需重新用链接连。

## 数据流

### 1. 桌面生成链接
```
桌面 → /pair ws → { type:'token.create', deviceId, deviceKey, expiresIn }
中继 → 生成 token(32字节hex) + 存 tokens.json { token: { desktopId, expiresAt } }
中继 → 回 { type:'token.created', token, url, expiresAt }
桌面 → 显示 URL + 二维码(QRCode.toDataURL) + 存链接列表
```

### 2. 手机扫码/打开 URL 连接
```
手机 → 打开 https://ccdesk.mrhua.top/?t=abc123
PWA  → 从 URL 提取 token → 连 /ws → 发 { type:'bind', token }
中继 → 查 tokens.json: token 有效且未过期? → 映射 desktopId → bind.ok
中继 → router.register(用 token 作为连接标识)
```

### 3. 消息路由
```
手机发消息 → { type:'session.message', token, ... }
中继 → 查 token → 找到 desktopId → 转发给桌面的所有在线连接
桌面发消息 → 转发给该桌面的所有 token 连接
```

### 4. 撤销
```
桌面 → /pair ws → { type:'token.revoke', deviceId, deviceKey, token }
中继 → 从 tokens.json 删除该 token
```

## 改动范围

### relay（中继）
- **新建 `relay/token-store.ts`**：token CRUD（存 tokens.json，结构 `{ token: { desktopId, expiresAt, createdAt } }`）
  - `createToken(desktopId, expiresIn): { token, expiresAt }`
  - `getToken(token): { desktopId, expiresAt } | null`（含过期检查）
  - `revokeToken(token): boolean`
  - `listTokens(desktopId): token[]`（桌面查自己的所有 token）
- **`relay/server.ts`**：
  - `/pair` 加 `token.create` / `token.revoke` / `token.list` handler（桌面 deviceId+deviceKey 验证身份）
  - `/ws` bind 改为认 token：`{ type:'bind', token }` → 查 token-store → 有效则 bind.ok
  - 移除 pair.code / pair.consume 流程（或保留但不再用）
- **`relay/router.ts`**：
  - `register` 的 key 从 deviceId 改为支持 token（或 token 映射后的 desktopId）
  - `route` 时按 token → desktopId 映射找对端

### 桌面端
- **`src/main/remote-config.ts`**：RemoteConfig 加 `shareLinks: { token, url, createdAt, expiresAt }[]`
- **`src/main/index.ts`**：`requestPairCode` 改为 `createShareLink(expiresIn)`（生成 token + URL + 二维码）
- **设置页 UI**：链接列表（生成新链接选有效期 / 每个链接显示 URL+二维码+复制+删除）

### 移动端
- **`web/src/App.tsx`**：从 URL `?t=xxx` 提取 token（替代 `?pair=CODE` 和 deviceId/deviceKey 配对）
- **`web/src/hooks/useRelay.ts`**：bind 信封改为 `{ type:'bind', token }`（不再签名）
- **移除/简化 `PairPage`**：无 token 时提示"请扫描桌面端的二维码"，不再需要配对码输入

## 关键点

- **token 格式**：32 字节 hex（64 字符），足够防猜测
- **tokens.json 落盘**：中继重启不丢 token（与 bindings.json/keys.json 同款持久化）
- **过期检查**：getToken 时检查 expiresAt，过期返回 null（惰性删除或定期清理）
- **二维码**：桌面用 `QRCode.toDataURL(url)` 生成（现有依赖已有 qrcode 库）
- **完全切换**：移除 pair.code/consume/bindings/keys 验签链路（但 bindings.json/keys.json 文件保留兼容，只是不再新增）

## 不在范围

- 多桌面（一个 token 只对应一个桌面）
- token 权限分级（所有 token 权限相同）
- 旧配对设备迁移（完全切换，旧设备重新用链接）

## 验证

- relay：token-store 纯函数单测 + server.ts token.create/revoke/bind 流程
- 桌面：createShareLink 生成 URL+二维码 + 设置页列表 UI
- 移动端：URL 提取 token + bind 连接 + 无 PairPage 配对码
- 手动 smoke：桌面生成链接 → 手机扫码 → 连接成功 → 发消息
