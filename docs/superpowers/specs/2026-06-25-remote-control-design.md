# 远程控制功能设计（手机控制桌面 cc-desk）

- **日期**: 2026-06-25
- **状态**: 已批准（设计阶段）
- **作者**: brainstorming 协作产出

## 1. 目标与范围

### 1.1 目标

让用户通过手机（PWA）远程操控运行在桌面端的 cc-desk：发消息、批准/拒绝计划卡片和权限弹窗，使长任务可以脱离电脑持续运行。

### 1.2 范围（已确认）

| 维度 | 决定 |
|------|------|
| **形态** | 远程对话 + 批准（看流式输出 + 发消息 + 批准/拒绝计划卡片与权限弹窗） |
| **组网** | 公网中继（用户自有的云端服务器），任意网络可连 |
| **手机端** | 先做 PWA，协议按可演进到原生 App 设计 |
| **会话关系** | 默认接管现有桌面会话，也支持新建独立会话 |
| **安全边界** | 仅对话流（不碰文件树、终端、tab 切换） |
| **重连** | 自动重连 + 续看后续输出；断线期间挂起的批准请求会重连后补发 |
| **访问方式** | 默认域名 `ccdesk.mrhua.top`（设置页可改），HTTPS（DNS/证书由用户自行处理） |

### 1.3 非目标（YAGNI，明确不做）

- 远程文件树浏览 / 终端操作 / tab 控制（超出「仅对话流」边界）
- 离线消息缓存 / 断线期间普通输出补发（中继保持无状态）
- 原生 App（v1 只做 PWA，协议为演进留口子）
- IM 机器人接入（微信/Telegram 等，不做）
- 推送通知作为核心闭环依赖（做成可选增强；核心靠「打开即重连」）

## 2. 整体架构

### 2.1 三组件

```
┌─────────────┐         WSS(公网)          ┌──────────────────┐         WSS(公网)         ┌──────────────────┐
│  手机 PWA   │ ◄══════════════════════► │   云端中继 relay  │ ◄════════════════════► │  桌面 cc-desk     │
│ (React UI)  │   配对绑定 + JSON 消息     │ (无状态纯转发)    │  配对绑定 + JSON 消息    │ (Electron 主进程) │
└─────────────┘                            └──────────────────┘                            └──────────────────┘
```

**1. 云端中继 relay**（新增 `relay/`，独立部署在用户服务器）：
- 两条 WebSocket 端点：`/pair`（配对交换）、`/ws`（已配对设备的常驻消息转发）
- **无状态**：内存只存「deviceId ↔ 活跃连接」路由表 + 短期 nonce 去重窗口；不存对话内容/历史
- 唯一持久化：配对绑定关系（deviceId ↔ deviceId）
- 托管 PWA 静态资源（HTTP 服务）

**2. 桌面端 remote-bridge**（新增 `src/main/remote-bridge.ts`）：
- 中继的客户端，维护 WSS 长连接 + 自动重连
- 双向桥接：桌面 Claude 事件流 → 中继 → 手机；手机命令 → 现有 ClaudeService/resolveDialog
- 配对码生成、已配对设备管理

**3. 手机 PWA**（新增 `web/`，React，构建产物部署在中继）：
- 配对（扫码/输码）、会话列表（接管/新建）、对话（流式输出 + 输入 + 批准卡片）
- 自动重连 + 断线提示

### 2.2 设计原则

- **中继无状态纯转发**：简单可靠易运维，数据不落云端（隐私与安全边界最干净）
- **桌面端是会话真相源**：所有 SDK 状态、历史、批准握手都在桌面，中继只是「远程管线」
- **协议是稳定层，UI 是可替换层**：协议与传输/UI 无关，将来换原生 App，中继与桌面端不改
- **桌面端复用现有机制**：不重造流式会话/批准/中断逻辑，只调用现有 API

## 3. 连接建立与配对

### 3.1 首次连接（配对，一次性）

核心障碍：手机第一次连中继时，中继凭什么相信这个手机有权控制桌面。用一次性配对码作为「认亲信物」。

```
桌面 cc-desk                          中继                              手机 PWA
   │                                   │                                   │
   │ 启用远程，本地已有 deviceId_D      │                                   │
   │ + deviceKey_D（32字节随机密钥）   │                                   │
   │                                   │                                   │
   │ 点「生成配对码」                  │                                   │
   │ ── POST /pair/code ─────────────► │                                   │
   │   {deviceId_D}                    │ 生成6位码，存 pairCode→deviceId_D  │
   │ ◄──── ok + pairCode ──────────── │   TTL 60s                         │
   │   显示配对码 + 二维码             │                                   │
   │   (二维码= https://domain/?pair=码)│                                  │
   │                                   │                                   │
   │                                   │ ◄── 手机扫系统相机/输码 ────────── │
   │                                   │     本地生成 deviceId_M+deviceKey_M│
   │                                   │ WSS /pair: {pairCode, deviceId_M, │
   │                                   │        deviceKey_M}               │
   │                                   │ 校验码存在+未过期+未用→找deviceId_D│
   │                                   │                                   │
   │ ◄──── pairRequest ────────────── │ （转发配对请求给桌面）             │
   │ 桌面弹窗「手机请求配对」          │                                   │
   │ ── pairApprove (deviceKey_D签名)► │                                   │
   │                                   │ 落盘绑定 deviceId_D ↔ deviceId_M  │
   │                                   │ 安全下发 deviceKey_D 给手机       │
   │                                   │ ──── pairSuccess ───────────────► │
   │                                   │   {deviceKey_D, deviceId_D}       │
   │                                   │                                   │ 手机本地存密钥
   │ ◄──── 绑定完成 ───────────────── │                                   │
```

**配对安全点**：
- 配对码 6 位数字、TTL 60s、一次性、每 IP 限频（防暴力枚举 10⁶ 空间）
- 配对需**桌面端二次确认**（弹窗「手机 XXX 请求配对，是否允许」），防猜码直绑
- `deviceKey_D` 只在「码已校验 + 桌面已确认」后下发；全程 WSS（TLS）已保证传输机密性，故应用层直接明文下发 deviceKey_D 即可（无额外应用层加密），手机收到后本地存储

**配对产物**：
- 中继持久化绑定表 `deviceId_D ↔ deviceId_M`
- 桌面存 `pairedDevices: [deviceId_M]`
- 手机本地存 `{deviceId_D, deviceKey_D}`

### 3.2 常驻转发连接（配对后每次都用 `/ws` + bind 握手）

配对完成后，桌面与手机各自独立连 `/ws`，中继靠 deviceId 路由表撮合：

```
桌面                                   中继                                手机
  │ WSS /ws, 首条 {bind, deviceId_D,    │                                    │
  │   sig: HMAC(deviceKey_D,...)} ───► │ 验签 + 查绑定 → 路由表登记          │
  │ ◄──── bind.ok ─────────────────── │   connections[deviceId_D] = ws_D   │
  │                                     │                                    │
  │                                     │ ◄── WSS /ws, {bind, deviceId_M,   │
  │                                     │      sig(HMAC deviceKey_M)} ───── │
  │                                     │ 验签+查绑定→路由表登记             │
  │                                     │   connections[deviceId_M] = ws_M  │
  │                                     │ ──── bind.ok ───────────────────► │
  │                                     │                                    │
  │   此后任何消息：发送方 deviceId → 查绑定 → 对端 deviceId → 查路由表 → 转发        │
```

**bind 握手机制**：
- 每端连上 `/ws` 后第一条消息必须是 `bind`，带 deviceId + deviceKey 签名
- 中继验签 + 查绑定表确认合法 → 登记到路由表 `Map<deviceId, ws>`
- 之后所有消息中继只按 deviceId 路由，不解析 payload

### 3.3 自动重连（凭密钥恢复，不走配对）

断线重连只需重发 `bind`（同一套密钥），不重新配对、不需用户干预：
- 双端内置状态机：`disconnected → connecting → connected`
- 指数退避（1s→2s→4s…上限 30s）
- 网络恢复（Wi-Fi 切 4G、解锁屏幕）自动重连
- 重连成功后：手机自动 `session.attach` → 桌面补发挂起的 `dialog.request`

### 3.4 三个端点职责

| 端点 | 用途 | 生命周期 |
|------|------|---------|
| `GET /` | 返回 PWA 页面 | HTTP，手机浏览器/扫码打开 |
| `WSS /pair` | 配对握手（码校验、密钥下发） | 短连接，配对完即断 |
| `WSS /ws` | 常驻消息转发（bind + 所有消息） | 长连接，双端各维持一条 |

## 4. 认证与安全

### 4.1 身份与密钥

- **桌面端**：启用远程时生成 `deviceId`（UUID）+ `deviceKey`（32 字节随机），持久化到 `~/.cc-desk/config.json` 的 `remote` 段。`deviceKey` 永不离桌面。
- **手机端**：配对成功后保存 `{deviceId_D, deviceKey_D}` 到本地存储。
- 双端用 `deviceKey` 给每条消息签名、互认身份。

### 4.2 消息认证（防伪造/防重放）

每条消息带 `sig = HMAC-SHA256(deviceKey, timestamp + nonce + payload)`：
- **防伪造**：无 deviceKey 无法造合法签名，中继被攻破也只能转发，无法伪造命令
- **防重放**：`timestamp`（±60s 容差）+ `nonce`（单调，中继去重窗口）

### 4.3 安全清单

| # | 威胁 | 防护 | 落点 |
|---|------|------|------|
| 1 | 配对码暴力枚举 | 6位、TTL 60s、一次性、每 IP 限频 10次/分 | 中继 pairing.ts |
| 2 | 陌生人猜码直绑 | 桌面二次确认弹窗 | 桌面 remote-bridge |
| 3 | 中继被攻破伪造命令 | 每条消息 HMAC 签名，中继无 deviceKey | 协议信封+双端验签 |
| 4 | 消息重放 | timestamp + nonce 去重 | 协议信封+中继去重 |
| 5 | 传输窃听 | 全程 WSS(TLS)，用户保证域名+证书有效 | 中继 HTTPS/WSS |
| 6 | deviceKey 泄漏 | 桌面密钥永不离机；手机本地安全存储 | 双端存储 |
| 7 | 远程端能力越界 | 协议只暴露 6 种入站命令，桌面白名单校验 type | 协议类型表+桌面校验 |
| 8 | 挂起 dialog 内存泄漏 | 24h 兜底硬上限 + 事件驱动取消 | 桌面 remote-bridge |
| 9 | 中继被刷流量 | 每 deviceId 限流 50 msg/s + 配对限频 | 中继 router.ts |
| 10 | 解绑后旧密钥可用 | 解绑=中继删绑定+双端清密钥 | 中继 binding-store |
| 11 | 中间人冒充中继 | 中继地址配置固定，WSS 证书校验；可选中继公钥指纹固定 | 桌面配置+连接校验 |

### 4.4 最小特权边界

远程端能做的**只有**：看对话流、发消息、中断、批准/拒绝/忽略。
**不能**：读写文件、跑命令、开终端、切 tab。
协议层硬保证（无对应消息类型，桌面不可能执行）。

## 5. 中继消息协议

### 5.1 消息信封（统一外壳）

```jsonc
{
  "v": 1,                       // 协议版本
  "type": "session.delta",      // 类型（命名空间.动作）
  "deviceId": "uuid",           // 发送方
  "ts": 1719300000000,          // 毫秒时间戳
  "nonce": "base64",            // 单调随机，防重放
  "sig": "hmac-base64",         // HMAC-SHA256(deviceKey, ts+nonce+payload)
  "payload": { /* 类型相关 */ }
}
```

中继只看 `deviceId/type/ts/nonce/sig`，**不解析 payload**。payload 对中继不透明。

### 5.2 消息类型

**桌面 → 手机（状态/事件推送）**：

| type | payload | 对应现有 IPC |
|------|---------|-------------|
| `session.list` | `{sessions:[{localSessionId,title,status}]}` | projects-store 快照 |
| `session.delta` | `{localSessionId, text?, thinking?}` | claude:delta |
| `session.blocks` | `{localSessionId, kind, block}` | claude:blocks（含计划卡片） |
| `session.notice` | `{localSessionId, level, msg}` | claude:notice |
| `session.result` | `{localSessionId, cost, duration}` | claude:result |
| `dialog.request` | `{reqId, localSessionId, dialogKind, payload, toolUseId}` | claude:dialog-request |
| `connection.state` | `{online: bool}` | — |

**手机 → 桌面（命令）**：

| type | payload | 桌面动作 |
|------|---------|---------|
| `session.attach` | `{localSessionId}` | 标记会话为「手机在看」 |
| `session.create` | `{projectId, title?}` | 建新会话 |
| `session.message` | `{localSessionId, text}` | claudeService.send(lsid, text) |
| `session.interrupt` | `{localSessionId}` | manager.interrupt(lsid) |
| `dialog.response` | `{reqId, result}` | claudeService.resolveDialog(reqId, result) |

### 5.3 dialog.request 的断线补发（唯一状态化消息）

- 桌面发 `dialog.request` 时登记 `reqId → {payload, expiresAt}`，不立即丢弃
- 手机断线期间，请求挂在桌面 `dialogResolvers` 里（Promise 未 resolve）
- 手机重连 + `session.attach` 后，桌面补发所有未超时的挂起 `dialog.request`
- **取消时机（纯事件驱动 + 24h 兜底）**：
  - 手机用户拒绝/批准 → 正常 resolveDialog
  - 手机用户主动「忽略」→ 发 `{behavior:'dismissed'}`
  - 桌面会话被中断/关闭/SDK abort → 现有 signal.abort 回 `{behavior:'cancelled'}`
  - 配对解除 → 清理所有挂起请求
  - **24h 兜底硬上限** → 极端防泄漏，日常永不触发

### 5.4 双端批准去重

`resolveDialog` 内部先 `delete(reqId)` 再调 resolver（现有机制），天然保证桌面先批准则手机回答失效，反之亦然。零新逻辑。

### 5.5 错误与限流

- 校验失败回 `{type:'error', code:'bad_sig'|'stale'|'replay'|'unbound'|'peer_offline'}`
- 每 deviceId 限流 50 msg/s

## 6. 桌面端集成

### 6.1 新增模块 `src/main/remote-bridge.ts`

独立服务，生命周期跟随 app。边界：**不直接碰 SDK，只通过现有 ClaudeService / SessionQueryManager / webContents IPC 交互**。远程功能是「挂在现有架构上的远程入口」，不侵入已验证的流式会话核心。

### 6.2 四个集成点

**① 出站：事件转发（只读旁路监听）**
对主窗口 webContents 注册监听器，捕获现有 `claude:*` 事件转成协议消息发中继（delta/blocks/notice/result）。不改 webContents.send 原有行为，桌面渲染端照常收事件，remote-bridge 只「多接一份」。

**② dialog 双向桥（批准核心，唯一介入点）**
- 出站：`askUserViaPanel` 发 IPC 后，额外让 remote-bridge 发一份 `dialog.request` 给手机（本地登记 reqId 用于断线补发）。桌面渲染端照常弹窗，双端都能批准。
- 入站：手机发 `dialog.response`，remote-bridge 调现有 `claudeService.resolveDialog(reqId, result)`，零新逻辑。

**③ 入站命令**
session.message→send / session.interrupt→manager.interrupt / session.attach→标记 / session.create→建会话。

**④ 会话清单推送**
手机连上时调 projects-store 读会话列表发 `session.list`，复用现有快照。

### 6.3 配置存储（复用 `~/.cc-desk/config.json`）

新增 `remote` 段，深合并写入（遵循 append-only，保留未知字段）：
```jsonc
{
  "remote": {
    "enabled": false,
    "relayUrl": "https://ccdesk.mrhua.top",
    "deviceId": "uuid",
    "deviceKey": "base64-32bytes",
    "pairedDevices": ["mobile-uuid"]
  }
}
```

### 6.4 设置页入口

设置页加「远程控制」区块：开关、中继地址、配对按钮（生成码+二维码）、已配对设备列表（可解绑）。解绑=移除 pairedDevices + 通知中继清绑定 + 清理挂起 dialog。

## 7. 手机 PWA 与中继部署

### 7.1 中继服务（`relay/`，独立 Node 服务）

```
relay/
├── server.ts          # HTTP + WebSocket 入口
├── pairing.ts         # 配对码生成/校验、绑定表读写
├── router.ts          # deviceId ↔ ws 路由 + 转发
├── binding-store.ts   # 绑定关系持久化（轻量 KV，可换 Redis）
├── crypto.ts          # HMAC 验签、nonce 去重
└── public/            # PWA 静态资源（构建产物）
```

### 7.2 手机 PWA（`web/`，React）

```
web/
├── App.tsx
├── pages/  PairPage / SessionListPage / ChatPage
├── hooks/  useRelay（WSS+自动重连+签名）/ useDialogQueue（批准队列）
└── store.ts  # deviceId/deviceKey 本地存储
```

PWA 能力：manifest + 图标（加主屏幕全屏像 App）；Service Worker（壳缓存）；Web Push 推送（可选增强，Android 全支持，iOS 16.4+）。

### 7.3 部署形态（用户自处理）

- **访问方式**：用户的域名 + HTTPS（用户负责域名注册、DNS、TLS 证书）
- **进程**：中继 = HTTP 静态托管 + WebSocket 转发，同一域名同一端口同一进程
- **守护**：pm2 / systemd 常驻 + 崩溃重启
- **构建**：`web/` 源码 → `pnpm build` → `web/dist` → 复制/软链到 `relay/public/` → 中继 serve
- **硬要求**：公网必须 HTTPS/WSS（PWA 高级能力 + 传输安全要求）；代码不掺和证书管理，依赖用户保证证书有效

### 7.4 扫码体验

桌面二维码内容 `https://your-domain.com/?pair=<code>`，手机用**系统相机**扫 → 顶部横条 → 点一下直接跳 PWA（自动带配对码）。配对界面提示「请用手机相机扫，勿用微信扫」（微信会拦外部链接）。配对后引导「添加到主屏幕」。

### 7.5 演进到原生 App

协议是纯 JSON 信封 + HMAC，与传输/UI 无关。将来做原生 App：中继一行不改、桌面端一行不改，只把 React UI 换成 iOS/Android 原生 UI 接同一套 WSS + 消息类型。

## 8. 测试策略

遵循 CLAUDE.md 测试约定（隔离配置目录、复用 fixtures、纯函数优先）。

### 8.1 单元测试（vitest）

| 模块 | 测试 | 隔离 |
|------|------|------|
| 协议信封/签名 | HMAC 签名/验签、ts/nonce 重放检测、版本兼容 | 纯函数 |
| 消息映射 | message→send、dialog.response→resolveDialog、interrupt 映射 | mock ClaudeService/manager |
| 配对码 | TTL 过期、一次性、限频计数 | 纯函数+假时钟 |
| dialog 断线补发 | 重连补发、24h 清理、事件驱动取消 | mock 状态 |
| config 持久化 | remote 段深合并、保留未知字段、解绑清密钥 | withFakeConfigDir() |

### 8.2 中继测试（node 环境）

两个假 ws 客户端模拟桌面+手机，验证纯转发+路由+限流+去重；配对全流程；验签失败/重放/未绑定的拒绝路径。

### 8.3 集成测试（核心链路，最高优先级）

端到端验证「远程批准」（mock askUserViaPanel，不用真实 SDK）：
1. 桌面 dialog.request → 中继 → 手机收到
2. 手机 dialog.response → 中继 → 桌面 resolveDialog → Promise resolve
3. 双端去重：桌面先 resolve，手机回答变 no-op
4. 断线补发：断线期间发 dialog，重连后收到
5. 超时清理：24h 后 resolver 取消

### 8.4 不测

不测真实 SDK 对话流（已有 e2e）；不测 PWA 视觉细节（人工验收）；v1 不测推送通知。

## 9. 开放问题 / 后续扩展

### 9.1 合并后 follow-up（实现期发现，已记录，按优先级）

- **【高】桌面二次确认（方案 A）**：v1 配对走「手机单方 consume 即落 binding」（方案 B），靠 IP 限频+失败锁定把暴力枚举压到不可行（单 IP 全空间约 2.4 年）。但 spec §3.1 原设计的「桌面二次确认」未闭合——因为 /ws 的 bind 握手要求 bindings.has(deviceId)，首次配对时桌面无绑定收不到 pair.request（鸡生蛋）。闭合需新增「桌面在配对阶段持 /pair 长连接收 pair.request」的 listener 通道。残留风险：码被旁路泄漏的单次命中（60s TTL+一次性+二维码即时显示，窗口极窄）。
- **【中】中继 IP/deviceId map 内存泄漏**：pairing 的 consumeLog/failCount/lockUntil（按 IP）和 router 的 counters（按 deviceId）不主动清理，长生命周期累积。加 TTL/CAP。
- **【低】AskUserQuestion 远程答案 UI**：现回 cancelled（经代理未注册的已知坑），核心批准场景（计划/permission）不受影响。
- **【低】session.create 主进程建会话 API**：会话由渲染端 reducer 建，主进程无 API，dispatcher 现静默。
- **【低】协议签名加固**：签名覆盖 ts+nonce+payload，未覆盖 type/deviceId；拼接无分隔符（当前不可利用，攻击者无 deviceKey）。

### 9.2 功能扩展

- **推送通知**（v1 可选）：批准请求来时推送，Web Push API；iOS 需 16.4+
- **断线期间普通输出补发**（v2）：目前不补，UI 标注「N 条未显示」
- **多设备**（v2）：同一桌面绑多台手机
- **原生 App**（未来）：协议已为其留口子
