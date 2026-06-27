# 远程控制（手机控制桌面 cc-desk）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过手机 PWA 远程操控桌面 cc-desk——发消息、批准/拒绝计划卡片与权限弹窗，长任务脱离电脑持续运行。

**Architecture:** 三组件——①无状态中继 relay（用户服务器，纯转发 + 托管 PWA）；②桌面 remote-bridge（Electron 主进程模块，桥接现有 ClaudeService/IPC）；③手机 PWA（React）。两端凭长期 deviceKey + HMAC 签名互认，配对码一次性认亲，之后走 `/ws` + bind 凭密钥恢复。远程消息直接映射现有 IPC（send/resolveDialog/interrupt）。

**Tech Stack:** TypeScript、Electron（主进程）、React（PWA）、Node `ws`（WebSocket）、`qrcode`（二维码生成）、vitest（测试）、electron-store（配置）。

**Spec:** `docs/superpowers/specs/2026-06-25-remote-control-design.md`

## Global Constraints

- **真实现，无 mock/模拟**：所有功能必须真实实现（CLAUDE.md 硬约定）。
- **不侵入流式会话核心**：remote-bridge 是「挂在现有架构上的远程入口」，只调用现有 API（send/resolveDialog/interrupt），不改其行为；事件转发用只读旁路监听。
- **配置隔离**：写 `~/.cc-desk/config.json` 的测试必须用 `withFakeConfigDir()`（指向 `os.tmpdir()` + `vi.resetModules()`），绝不落真机。参见 `tests/claude-config-write.test.ts`。
- **默认中继域名**：`https://ccdesk.mrhua.top`，设置页可改。
- **i18n 对齐**：新增文案 zh-CN / en 两边都加（有 `i18n-completeness.test.ts` 校验）。
- **IPC 是契约**：新增主进程能力要在 `preload/index.ts` 暴露 + `index.ts` 注册 `ipcMain.handle`；渲染端订阅的事件 unmount 时 `removeAllListeners`。
- **Conventional Commits**：`feat:` / `fix:` / `chore:` / `docs:` 等，无 pre-commit hook 靠 CI 隐式强制。
- **依赖**：需新增 `ws`（WebSocket）、`qrcode`（二维码）及其 `@types`。

---

## 阶段划分

本功能跨 3 子系统，但共享同一套协议类型。为避免协议类型在多处重复定义导致漂移，**协议层（Task 1）是所有后续任务的地基**，必须先完成。之后按 中继 → 桌面集成 → PWA 的顺序推进，每个阶段产出可独立测试的交付物。

- **阶段 A（协议地基，Task 1）**：纯类型 + 纯函数，无 IO，最先做。
- **阶段 B（中继，Task 2-5）**：独立 Node 服务，可单独启动测试。
- **阶段 C（桌面集成，Task 6-11）**：remote-bridge 接入现有主进程。
- **阶段 D（PWA，Task 12-15）**：手机端 UI，依赖协议类型与中继。

---

## 文件结构

### 新增

| 文件 | 职责 |
|------|------|
| `src/shared/remote-protocol.ts` | **协议地基**：消息信封类型、消息类型枚举、签名/验签/nonce 纯函数。桌面+中继+PWA 共享。 |
| `src/main/remote-config.ts` | 远程配置读写（`~/.cc-desk/config.json` 的 `remote` 段），深合并，deviceId/deviceKey 持久化。 |
| `src/main/remote-bridge.ts` | 桌面端中继客户端：WSS 连接 + 自动重连 + bind 握手 + 双向桥接（事件转发 / 命令分发 / dialog 补发）。 |
| `relay/server.ts` | 中继 HTTP + WebSocket 服务入口。 |
| `relay/pairing.ts` | 配对码生成/校验、绑定表读写。 |
| `relay/router.ts` | deviceId ↔ ws 路由表 + 消息转发 + 限流 + nonce 去重。 |
| `relay/binding-store.ts` | 绑定关系持久化（轻量 JSON KV）。 |
| `relay/crypto.ts` | 中继侧验签（复用 shared 协议函数）。 |
| `web/` | PWA 源码（React）：App、pages（Pair/SessionList/Chat）、hooks（useRelay/useDialogQueue）、store。 |

### 修改

| 文件 | 改动 |
|------|------|
| `src/preload/index.ts` | 暴露 `remote.*` IPC（get-config/save-config/pair/unpair 等）。 |
| `src/main/index.ts` | 注册 `remote:*` ipcMain.handle；app 启动时初始化 remote-bridge。 |
| `src/main/cc-desk-store.ts` | config.json schema 扩展 `remote` 段（或由 remote-config 独立管理，见 Task 6 决策）。 |
| `src/renderer/.../Settings` | 新增「远程控制」设置区块。 |
| `src/renderer/i18n/*.ts` | 新增远程相关文案（zh + en）。 |
| `package.json` | 加 `ws`、`qrcode`、`@types/ws`、`@types/qrcode` 依赖。 |

---

## 阶段 A：协议地基

### Task 1: 协议类型与签名/验签纯函数

**Files:**
- Create: `src/shared/remote-protocol.ts`
- Test: `tests/remote-protocol.test.ts`

**Interfaces:**
- Produces: `Envelope`（消息信封类型）、`MessageType`（消息类型联合）、`sign(deviceKey, ts, nonce, payload)`、`verifySig(deviceKey, env)`、`genNonce()`、`makeEnvelope(deviceKey, type, deviceId, payload)`、配对相关类型。后续所有任务都 import 这些。

- [ ] **Step 1: 写失败测试 — 信封构造与签名**

```ts
// tests/remote-protocol.test.ts
import { describe, it, expect } from 'vitest'
import { makeEnvelope, verifySig, genNonce, sign, type Envelope } from '../src/shared/remote-protocol'

const KEY = 'dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1rZXktMTIzNDU2' // base64 test key

describe('remote-protocol 信封与签名', () => {
  it('makeEnvelope 生成合法信封并通过验签', () => {
    const env = makeEnvelope(KEY, 'session.delta', 'device-D', { text: 'hi' })
    expect(env.type).toBe('session.delta')
    expect(env.deviceId).toBe('device-D')
    expect(env.v).toBe(1)
    expect(typeof env.sig).toBe('string')
    expect(verifySig(KEY, env)).toBe(true)
  })

  it('篡改 payload 后验签失败', () => {
    const env = makeEnvelope(KEY, 'session.delta', 'device-D', { text: 'hi' })
    const tampered = { ...env, payload: { text: 'hacked' } }
    expect(verifySig(KEY, tampered)).toBe(false)
  })

  it('错误密钥验签失败', () => {
    const env = makeEnvelope(KEY, 'session.delta', 'device-D', { text: 'hi' })
    expect(verifySig('wrong-base64-key', env)).toBe(false)
  })

  it('genNonce 每次不同且足够长', () => {
    const a = genNonce(), b = genNonce()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(16)
  })
})
```

- [ ] **Step 2: 写失败测试 — 时间戳与 nonce 重放检测**

```ts
import { isStale, isReplay, type Envelope } from '../src/shared/remote-protocol'

describe('remote-protocol 防重放', () => {
  it('isStale：超过 60s 容差判过期', () => {
    const now = Date.now()
    expect(isStale({ ts: now } as Envelope, now)).toBe(false)
    expect(isStale({ ts: now - 61_000 } as Envelope, now)).toBe(true)
    expect(isStale({ ts: now + 61_000 } as Envelope, now)).toBe(true)
  })

  it('isReplay：同一 nonce 第二次判为重放', () => {
    const seen = new Set<string>()
    const env = { nonce: 'abc123' } as Envelope
    expect(isReplay(env, seen)).toBe(false)
    expect(isReplay(env, seen)).toBe(true) // 第二次
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/remote-protocol.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现协议模块**

```ts
// src/shared/remote-protocol.ts
// 远程控制协议地基：桌面 / 中继 / PWA 三端共享。
// 纯类型 + 纯函数，无 IO，无副作用，便于测试。

import { createHmac, randomBytes } from 'crypto'

/** 协议版本 */
export const PROTOCOL_VERSION = 1

/** 时间戳容差（毫秒） */
export const TS_TOLERANCE_MS = 60_000

/** 消息类型 —— 桌面→手机 */
export type ServerToClient =
  | 'session.list'        // 当前可远程操作的会话清单
  | 'session.delta'       // 流式增量
  | 'session.blocks'      // tool_use/tool_result/计划卡片
  | 'session.notice'      // 系统提示
  | 'session.result'      // query 结束
  | 'dialog.request'      // 批准请求（对应 claude:dialog-request）
  | 'connection.state'    // 桌面在线状态

/** 消息类型 —— 手机→桌面 */
export type ClientToServer =
  | 'bind'                // /ws 连接后的身份握手
  | 'session.attach'      // 接管会话
  | 'session.create'      // 新建会话
  | 'session.message'     // 发消息
  | 'session.interrupt'   // 中断 query
  | 'dialog.response'     // 批准/拒绝/忽略

/** 控制类消息（配对、错误等） */
export type ControlMessage =
  | 'pair.code'           // 桌面→中继：请求生成配对码
  | 'pair.request'        // 中继→桌面：手机请求配对
  | 'pair.approve'        // 桌面→中继：同意配对
  | 'pair.success'        // 中继→手机：配对完成，下发密钥
  | 'error'               // 错误回报
  | 'peer_offline'        // 对端不在线

export type MessageType = ServerToClient | ClientToServer | ControlMessage

/** 消息信封（所有消息统一外壳） */
export interface Envelope<T = unknown> {
  v: number               // 协议版本
  type: MessageType
  deviceId: string        // 发送方设备
  ts: number              // 毫秒时间戳
  nonce: string           // 单调随机，防重放
  sig: string             // HMAC-SHA256(deviceKey, ts+nonce+payload) base64
  payload: T
}

/** 用 deviceKey 对 ts+nonce+payload 做 HMAC-SHA256，返回 base64 签名。 */
export function sign(deviceKey: string, ts: number, nonce: string, payload: unknown): string {
  const mac = createHmac('sha256', Buffer.from(deviceKey, 'base64'))
  mac.update(String(ts))
  mac.update(nonce)
  mac.update(JSON.stringify(payload))
  return mac.digest('base64')
}

/** 校验信封签名是否合法。 */
export function verifySig(deviceKey: string, env: Envelope): boolean {
  const expected = sign(deviceKey, env.ts, env.nonce, env.payload)
  // 定长比较防时序攻击
  return expected.length === env.sig.length && timingSafeEqual(expected, env.sig)
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 生成随机 nonce。 */
export function genNonce(): string {
  return randomBytes(16).toString('base64')
}

/** 构造一个已签名的信封。 */
export function makeEnvelope<T>(
  deviceKey: string,
  type: MessageType,
  deviceId: string,
  payload: T,
): Envelope<T> {
  const ts = Date.now()
  const nonce = genNonce()
  const sig = sign(deviceKey, ts, nonce, payload)
  return { v: PROTOCOL_VERSION, type, deviceId, ts, nonce, sig, payload }
}

/** 判断时间戳是否过期（±60s 容差）。 */
export function isStale(env: Envelope, now = Date.now()): boolean {
  return Math.abs(now - env.ts) > TS_TOLERANCE_MS
}

/** 判断是否为重放（基于已见 nonce 集合）。重复见到同一 nonce 返回 true。 */
export function isReplay(env: Envelope, seen: Set<string>): boolean {
  if (seen.has(env.nonce)) return true
  seen.add(env.nonce)
  return false
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/remote-protocol.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 6: 提交**

```bash
git add src/shared/remote-protocol.ts tests/remote-protocol.test.ts
git commit -m "feat(remote): 协议地基——信封类型与签名/验签/防重放纯函数"
```

---

## 阶段 B：中继服务

### Task 2: 中继绑定关系存储（binding-store）

**Files:**
- Create: `relay/binding-store.ts`
- Test: `tests/relay/binding-store.test.ts`

**Interfaces:**
- Consumes: 无（独立模块）
- Produces: `loadBindings()`、`saveBindings(map)`、`addBinding(a, b)`、`removeBinding(deviceId)`、`getPeer(deviceId)`。绑定是双向的（A↔B），存一张 `Record<deviceId, peerDeviceId>`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/relay/binding-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'

describe('binding-store', () => {
  let file: string
  beforeEach(() => { file = join(tmpdir(), `bind-${Math.random().toString(36).slice(2)}.json`) })
  afterEach(async () => { await rm(file, { force: true }) })

  it('addBinding 双向绑定，getPeer 能互查', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    await store.addBinding('D', 'M')
    expect(store.getPeer('D')).toBe('M')
    expect(store.getPeer('M')).toBe('D')
  })

  it('removeBinding 删除双向绑定', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    await store.addBinding('D', 'M')
    await store.removeBinding('D')
    expect(store.getPeer('D')).toBeUndefined()
    expect(store.getPeer('M')).toBeUndefined()
  })

  it('持久化：重新打开文件能读到已有绑定', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    await (await import('../../relay/binding-store')).createBindingStore(file).addBinding('D', 'M')
    const store2 = createBindingStore(file)
    expect(store2.getPeer('D')).toBe('M')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/relay/binding-store.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 binding-store**

```ts
// relay/binding-store.ts
// 配对绑定关系持久化。双向绑定（A↔B），存一张 deviceId → peerDeviceId 的映射。
// 轻量 JSON KV；v1 单文件，将来可换 Redis（接口不变）。
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export interface BindingStore {
  addBinding(a: string, b: string): Promise<void>
  removeBinding(deviceId: string): Promise<void>
  getPeer(deviceId: string): string | undefined
  has(deviceId: string): boolean
}

export function createBindingStore(filePath: string): BindingStore {
  let cache: Record<string, string> = {}

  async function load() {
    try {
      const raw = await readFile(filePath, 'utf-8')
      cache = JSON.parse(raw)
    } catch {
      cache = {}
    }
  }

  async function persist() {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(cache), 'utf-8')
  }

  // 模块加载即读盘一次（构造时同步触发）
  const ready = load()

  return {
    async addBinding(a, b) {
      await ready
      cache[a] = b
      cache[b] = a
      await persist()
    },
    async removeBinding(deviceId) {
      await ready
      const peer = cache[deviceId]
      delete cache[deviceId]
      if (peer) delete cache[peer]
      await persist()
    },
    getPeer(deviceId) {
      return cache[deviceId]
    },
    has(deviceId) {
      return deviceId in cache
    },
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/relay/binding-store.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add relay/binding-store.ts tests/relay/binding-store.test.ts
git commit -m "feat(relay): 绑定关系持久化存储（双向 KV）"
```

---

### Task 3: 配对码生成与校验（pairing）

**Files:**
- Create: `relay/pairing.ts`
- Test: `tests/relay/pairing.test.ts`

**Interfaces:**
- Consumes: `BindingStore`（Task 2）
- Produces: `createPairingStore(bindings, opts)` → `{ issueCode(deviceId): {code, expiresAt}, consume(code, mobileId): {desktopId} | null }`。配对码 6 位、TTL 60s、一次性、每 deviceId 限频。

- [ ] **Step 1: 写失败测试**

```ts
// tests/relay/pairing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('pairing 配对码', () => {
  beforeEach(() => vi.useFakeTimers())

  it('issueCode 返回 6 位数字码与 60s 过期时间', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings())
    const r = store.issueCode('D')
    expect(r.code).toMatch(/^\d{6}$/)
    expect(r.expiresAt).toBe(Date.now() + 60_000)
  })

  it('consume 成功返回 desktopId 并落绑定，码一次性', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const bindings = makeFakeBindings()
    const store = createPairingStore(bindings)
    const { code } = store.issueCode('D')
    const r = store.consume(code, 'M')
    expect(r?.desktopId).toBe('D')
    expect(bindings.addBinding).toHaveBeenCalledWith('D', 'M')
    // 第二次用同一码失败
    expect(store.consume(code, 'M2')).toBeNull()
  })

  it('过期码 consume 返回 null', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings())
    const { code } = store.issueCode('D')
    vi.advanceTimersByTime(61_000)
    expect(store.consume(code, 'M')).toBeNull()
  })

  it('限频：同 deviceId 60s 内 issue 超过上限抛错', async () => {
    const { createPairingStore } = await import('../../relay/pairing')
    const store = createPairingStore(makeFakeBindings(), { maxIssuePerWindow: 3 })
    store.issueCode('D'); store.issueCode('D'); store.issueCode('D')
    expect(() => store.issueCode('D')).toThrow()
  })
})

function makeFakeBindings() {
  return { addBinding: vi.fn(), removeBinding: vi.fn(), getPeer: vi.fn(), has: vi.fn(() => true) } as any
}
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/relay/pairing.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 pairing**

```ts
// relay/pairing.ts
// 配对码生成/校验。6 位数字、TTL 60s、一次性、每 deviceId 限频。
import { randomInt } from 'crypto'
import type { BindingStore } from './binding-store'

const CODE_TTL_MS = 60_000
const CODE_LEN = 6
const DEFAULT_MAX_ISSUE = 5 // 每个 deviceId 60s 窗口内最多 issue 次数

export interface PairingStore {
  issueCode(deviceId: string): { code: string; expiresAt: number }
  consume(code: string, mobileId: string): { desktopId: string } | null
}

export function createPairingStore(
  bindings: BindingStore,
  opts: { maxIssuePerWindow?: number; windowMs?: number } = {},
): PairingStore {
  const maxIssue = opts.maxIssuePerWindow ?? DEFAULT_MAX_ISSUE
  const windowMs = opts.windowMs ?? 60_000
  // code → { deviceId, expiresAt }
  const codes = new Map<string, { deviceId: string; expiresAt: number }>()
  // deviceId → issue 时间戳列表（限频窗口）
  const issueLog = new Map<string, number[]>()

  return {
    issueCode(deviceId) {
      const now = Date.now()
      const log = (issueLog.get(deviceId) ?? []).filter(t => now - t < windowMs)
      if (log.length >= maxIssue) throw new Error('pairing rate limit exceeded')
      log.push(now)
      issueLog.set(deviceId, log)

      const code = String(randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0')
      const expiresAt = now + CODE_TTL_MS
      codes.set(code, { deviceId, expiresAt })
      return { code, expiresAt }
    },
    consume(code, mobileId) {
      const entry = codes.get(code)
      if (!entry) return null
      if (Date.now() > entry.expiresAt) {
        codes.delete(code)
        return null
      }
      codes.delete(code) // 一次性
      // 落绑定（异步，consume 同步返回）
      void bindings.addBinding(entry.deviceId, mobileId)
      return { desktopId: entry.deviceId }
    },
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/relay/pairing.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add relay/pairing.ts tests/relay/pairing.test.ts
git commit -m "feat(relay): 配对码生成/校验（6位/60s/一次性/限频）"
```

---

### Task 4: 中继路由表与消息转发（router）

**Files:**
- Create: `relay/router.ts`
- Test: `tests/relay/router.test.ts`

**Interfaces:**
- Consumes: `BindingStore`（Task 2）、`verifySig/isStale/isReplay`（Task 1）
- Produces: `createRouter(bindings)` → `{ register(deviceId, sendFn), unregister(deviceId), route(env): {ok:boolean, reason?:string} }`。验签+绑定+路由，不解析 payload。

- [ ] **Step 1: 写失败测试**

```ts
// tests/relay/router.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeEnvelope } from '../src/shared/remote-protocol'

describe('router 路由转发', () => {
  it('已绑定设备签名合法的消息转发给对端', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M', 'M': 'D' })
    const desktopKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => desktopKey) // 注入查密钥函数
    const sentToMobile: any[] = []
    router.register('D', (env) => {}) // 桌面在线但不接收本条
    router.register('M', (env) => sentToMobile.push(env))
    const env = makeEnvelope(desktopKey, 'session.delta', 'D', { text: 'hi' })
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(sentToMobile).toHaveLength(1)
  })

  it('未绑定设备 route 失败（unbound）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({})
    const router = createRouter(bindings, () => 'k')
    const env = makeEnvelope('k', 'session.delta', 'X', {})
    expect(router.route(env).ok).toBe(false)
  })

  it('签名错误 route 失败（bad_sig）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M' })
    const router = createRouter(bindings, () => 'correct-key')
    const env = makeEnvelope('wrong-key', 'session.delta', 'D', {})
    expect(router.route(env).reason).toBe('bad_sig')
  })

  it('对端不在线返回 peer_offline', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M' })
    const router = createRouter(bindings, () => 'k')
    router.register('D', () => {})
    const env = makeEnvelope('k', 'session.delta', 'D', {})
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(false) // peer M 未注册
  })
})

function makeFakeBindings(map: Record<string, string>) {
  return {
    getPeer: (id: string) => map[id],
    has: (id: string) => id in map,
    addBinding: vi.fn(), removeBinding: vi.fn(),
  } as any
}
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/relay/router.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 router**

```ts
// relay/router.ts
// 中继消息路由：验签 → 查绑定 → 找对端在线连接 → 转发。不解析 payload。
import type { BindingStore } from './binding-store'
import { verifySig, isStale, isReplay, type Envelope } from '../src/shared/remote-protocol'

type SendFn = (env: Envelope) => void

export interface RouteResult {
  ok: boolean
  delivered: boolean
  reason?: 'bad_sig' | 'stale' | 'replay' | 'unbound' | 'peer_offline'
}

export interface Router {
  register(deviceId: string, send: SendFn): void
  unregister(deviceId: string): void
  route(env: Envelope): RouteResult
}

/**
 * @param resolveKey deviceId → deviceKey 的查密钥函数。
 *   中继需知道每端的 deviceKey 才能验签。v1 由 bind 握手时上报（或绑定表附带）。
 *   注意：deviceKey 仅用于验签，不用于转发；中继不长期持有也无妨，但需在 bind 时拿到。
 */
export function createRouter(
  bindings: BindingStore,
  resolveKey: (deviceId: string) => string | undefined,
  opts: { nonceWindow?: number; rateLimit?: number } = {},
): Router {
  const conns = new Map<string, SendFn>()
  const seen = new Set<string>()
  const rateLimit = opts.rateLimit ?? 50 // msg/s per device
  const counters = new Map<string, { count: number; windowStart: number }>()

  return {
    register(deviceId, send) { conns.set(deviceId, send) },
    unregister(deviceId) { conns.delete(deviceId) },
    route(env) {
      // 1. 绑定校验
      if (!bindings.has(env.deviceId)) return { ok: false, delivered: false, reason: 'unbound' }
      // 2. 签名校验
      const key = resolveKey(env.deviceId)
      if (!key || !verifySig(key, env)) return { ok: false, delivered: false, reason: 'bad_sig' }
      // 3. 时间戳
      if (isStale(env)) return { ok: false, delivered: false, reason: 'stale' }
      // 4. 重放
      if (isReplay(env, seen)) return { ok: false, delivered: false, reason: 'replay' }
      // 5. 限流（粗粒度，每秒每设备）
      const now = Date.now()
      const c = counters.get(env.deviceId) ?? { count: 0, windowStart: now }
      if (now - c.windowStart > 1000) { c.count = 0; c.windowStart = now }
      c.count++
      counters.set(env.deviceId, c)
      if (c.count > rateLimit) return { ok: false, delivered: false, reason: 'rate_limited' as any }

      // 6. 找对端并转发
      const peer = bindings.getPeer(env.deviceId)
      const send = peer ? conns.get(peer) : undefined
      if (!send) return { ok: true, delivered: false, reason: 'peer_offline' }
      send(env)
      return { ok: true, delivered: true }
    },
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/relay/router.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add relay/router.ts tests/relay/router.test.ts
git commit -m "feat(relay): 消息路由（验签/绑定/防重放/限流/转发）"
```

---

### Task 5: 中继 HTTP + WebSocket 服务入口（server）

**Files:**
- Create: `relay/server.ts`
- Test: `tests/relay/server.test.ts`（用 ws 客户端起两个假连接，集成测配对 + 转发）

**Interfaces:**
- Consumes: `createBindingStore`、`createPairingStore`、`createRouter`（Task 2-4）、`verifySig`（Task 1）
- Produces: `startRelayServer({ port, dataDir, staticDir? })` → `{ close() }`。暴露 `GET /`（PWA）、`WSS /pair`、`WSS /ws`。

- [ ] **Step 1: 写失败测试（集成：配对 + 双端转发）**

```ts
// tests/relay/server.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { startRelayServer } from '../../relay/server'
import { makeEnvelope } from '../../src/shared/remote-protocol'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'

let servers: Array<{ close(): Promise<void> }> = []
afterEach(async () => { await Promise.all(servers.map(s => s.close())); servers = [] })

async function connect(port: number, path: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    ws.on('open', () => resolve(ws))
  })
}

describe('relay server 集成', () => {
  it('配对码流程：桌面 issue → 手机 consume → 双向绑定建立', async () => {
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const { port } = await startRelayServer({ port: 0, dataDir }).then(s => { servers.push(s); return { port: s.port!, s } }) as any
    const key = 'dGVzdA=='
    // issue code（HTTP 或 ws，这里用 ws /pair）
    const wsD = await connect(port, '/pair')
    wsD.send(JSON.stringify({ type: 'pair.code', deviceId: 'D', deviceKey: key }))
    const codeMsg: any = await new Promise(r => wsD.once('message', d => r(JSON.parse(d.toString()))))
    expect(codeMsg.type).toBe('pair.code')
    const code = codeMsg.payload.code
    // 手机 consume
    const wsM = await connect(port, '/pair')
    wsM.send(JSON.stringify({ type: 'pair.consume', deviceId: 'M', code }))
    const okMsg: any = await new Promise(r => wsM.once('message', d => r(JSON.parse(d.toString()))))
    expect(okMsg.type).toBe('pair.success')
    wsD.close(); wsM.close()
    await rm(dataDir, { recursive: true, force: true })
  })
})
```

> 注：此集成测试覆盖最关键的配对链路。完整的「双端 bind 后转发」可在 Task 9（桌面端连接）后再补一个跨端测试，此处先保证服务能起、配对能通。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/relay/server.test.ts`
Expected: FAIL（server 不存在）

- [ ] **Step 3: 安装依赖**

Run: `pnpm add ws && pnpm add -D @types/ws`
（中继服务用 `ws` 库；package.json 的 dependencies 加 ws，devDependencies 加 @types/ws）

- [ ] **Step 4: 实现 server**

```ts
// relay/server.ts
// 中继服务入口：HTTP（托管 PWA 静态资源）+ WebSocket（/pair 配对、/ws 转发）。
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { createBindingStore } from './binding-store'
import { createPairingStore } from './pairing'
import { createRouter } from './router'
import { verifySig, type Envelope } from '../src/shared/remote-protocol'

export interface RelayHandle { close(): Promise<void>; port?: number }

export async function startRelayServer(opts: {
  port: number
  dataDir: string
  staticDir?: string
}): Promise<RelayHandle> {
  const bindings = createBindingStore(join(opts.dataDir, 'bindings.json'))
  const pairing = createPairingStore(bindings)
  // deviceKey 注册表：bind 握手时上报，供 router 验签。
  const keyRegistry = new Map<string, string>()
  const router = createRouter(bindings, (id) => keyRegistry.get(id))

  const httpServer = createServer(async (req, res) => {
    // 托管 PWA 静态资源（v1：单页，SPA fallback 到 index.html）
    if (!opts.staticDir) { res.writeHead(404); res.end(); return }
    try {
      const file = req.url === '/' ? '/index.html' : req.url
      const data = await readFile(join(opts.staticDir, file!))
      res.writeHead(200)
      res.end(data)
    } catch {
      // SPA fallback
      try {
        const index = await readFile(join(opts.staticDir, 'index.html'))
        res.writeHead(200); res.end(index)
      } catch {
        res.writeHead(404); res.end('not found')
      }
    }
  })

  const pairWss = new WebSocketServer({ server: httpServer, path: '/pair' })
  const wsWss = new WebSocketServer({ server: httpServer, path: '/ws' })

  pairWss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === 'pair.code' && msg.deviceId && msg.deviceKey) {
        const { code, expiresAt } = pairing.issueCode(msg.deviceId)
        keyRegistry.set(msg.deviceId, msg.deviceKey) // 记下桌面密钥
        ws.send(JSON.stringify({ type: 'pair.code', payload: { code, expiresAt } }))
      } else if (msg.type === 'pair.consume' && msg.deviceId && msg.code) {
        const r = pairing.consume(msg.code, msg.deviceId)
        if (r) {
          const desktopKey = keyRegistry.get(r.desktopId)
          ws.send(JSON.stringify({
            type: 'pair.success',
            payload: { desktopId: r.desktopId, deviceKey: desktopKey }, // 下发桌面密钥给手机（全程 TLS）
          }))
        } else {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_pair_code' } }))
        }
      }
    })
  })

  wsWss.on('connection', (ws) => {
    let boundDeviceId: string | null = null
    ws.on('message', (raw) => {
      let env: Envelope
      try { env = JSON.parse(raw.toString()) } catch { return }
      // bind 握手：第一条消息，上报 deviceId + deviceKey
      if (env.type === 'bind' && !boundDeviceId) {
        if (!bindings.has(env.deviceId)) { ws.send(JSON.stringify({ type: 'error', payload: { code: 'unbound' } })); return }
        keyRegistry.set(env.deviceId, env.payload?.deviceKey)
        boundDeviceId = env.deviceId
        router.register(env.deviceId, (e) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(e)))
        ws.send(JSON.stringify({ type: 'bind.ok' }))
        return
      }
      if (!boundDeviceId) return // 未 bind 拒收
      router.route(env) // 转发或拒绝
    })
    ws.on('close', () => { if (boundDeviceId) router.unregister(boundDeviceId) })
  })

  return new Promise((resolve) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolve({
        port,
        close: () => new Promise<void>((res) => {
          pairWss.close(); wsWss.close(); httpServer.close(() => res())
        }),
      })
    })
  })
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/relay/server.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add relay/server.ts tests/relay/server.test.ts package.json pnpm-lock.yaml
git commit -m "feat(relay): HTTP+WebSocket 服务入口（PWA 托管/配对/转发）"
```

---

## 阶段 C：桌面端集成

### Task 6: 远程配置读写（remote-config）

**Files:**
- Create: `src/main/remote-config.ts`
- Test: `tests/remote-config.test.ts`

**Interfaces:**
- Consumes: electron-store 模式（参考 `cc-desk-store.ts`）
- Produces: `getRemoteConfig()`、`saveRemoteConfig(patch)`、`ensureDeviceIdentity()`（首次生成 deviceId/deviceKey）。配置存 `~/.cc-desk/config.json` 的 `remote` 段，深合并保留未知字段。

> **决策**：config.json 当前只存 `config: ModelProvidersConfig`（见 cc-desk-store.ts）。remote 段是独立顶层 key `remote`，不与 model 配置混。用独立的 Store 实例（同 `cwd: CC_DESK_DIR`，`name: 'config'`，读写同一文件的不同 key），保持职责分离。

- [ ] **Step 1: 写失败测试（隔离 CLAUDE_CONFIG_DIR → 实际隔离 CC_DESK_DIR）**

```ts
// tests/remote-config.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'

// 隔离 CC_DESK_DIR 的工厂（remote-config 落 ~/.cc-desk/config.json）
async function withFakeCcDeskDir() {
  const fakeDir = join(tmpdir(), `cc-desk-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CC_DESK_DIR = fakeDir // remote-config 用 CC_DESK_DIR（见 paths.ts）
  vi.resetModules()
  const mod = await import('../src/main/remote-config')
  return { mod, fakeDir }
}

describe('remote-config', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CC_DESK_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CC_DESK_DIR
    else process.env.CC_DESK_DIR = origDir
  })

  it('getRemoteConfig 默认值：disabled，默认域名，无 deviceId', async () => {
    const { mod } = await withFakeCcDeskDir()
    const cfg = mod.getRemoteConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.relayUrl).toBe('https://ccdesk.mrhua.top')
    expect(cfg.deviceId).toBe('')
  })

  it('saveRemoteConfig 浅合并 patch，保留未传字段', async () => {
    const { mod } = await withFakeCcDeskDir()
    mod.saveRemoteConfig({ enabled: true })
    expect(mod.getRemoteConfig().enabled).toBe(true)
    expect(mod.getRemoteConfig().relayUrl).toBe('https://ccdesk.mrhua.top') // 未传保留
  })

  it('ensureDeviceIdentity 首次生成 deviceId+deviceKey，二次返回同一组', async () => {
    const { mod } = await withFakeCcDeskDir()
    const a = mod.ensureDeviceIdentity()
    expect(a.deviceId).toBeTruthy()
    expect(a.deviceKey).toBeTruthy()
    const b = mod.ensureDeviceIdentity()
    expect(b.deviceId).toBe(a.deviceId)
    expect(b.deviceKey).toBe(a.deviceKey)
  })
})
```

> 注：需确认 `paths.ts` 的 `CC_DESK_DIR` 是否读 `process.env.CC_DESK_DIR`。若它硬编码 `~/.cc-desk`，则测试需 mock `os.homedir()`。执行时先 Read `src/main/paths.ts` 确认，调整测试隔离方式。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/remote-config.test.ts`
Expected: FAIL

- [ ] **Step 3: Read paths.ts 确认 CC_DESK_DIR 来源**

Run: Read `src/main/paths.ts`，确认 `CC_DESK_DIR` 如何取值，必要时调整 Step 1 的隔离方式。

- [ ] **Step 4: 实现 remote-config**

```ts
// src/main/remote-config.ts
// 远程控制配置：~/.cc-desk/config.json 的 remote 段。
// 与 model 配置（同文件的 config 段）分开，独立 Store 实例读写同一文件不同 key。
import Store from 'electron-store'
import { randomBytes, randomUUID } from 'crypto'
import { CC_DESK_DIR } from './paths'

export interface RemoteConfig {
  enabled: boolean
  relayUrl: string
  deviceId: string
  deviceKey: string
  pairedDevices: string[]
}

const DEFAULT: RemoteConfig = {
  enabled: false,
  relayUrl: 'https://ccdesk.mrhua.top',
  deviceId: '',
  deviceKey: '',
  pairedDevices: [],
}

const store = new Store<{ remote: RemoteConfig }>({
  name: 'config',
  cwd: CC_DESK_DIR,
  defaults: { remote: DEFAULT },
})

export function getRemoteConfig(): RemoteConfig {
  return { ...DEFAULT, ...store.get('remote', DEFAULT) }
}

export function saveRemoteConfig(patch: Partial<RemoteConfig>): void {
  store.set('remote', { ...getRemoteConfig(), ...patch })
}

/** 首次启用远程时生成设备身份（deviceId + 32字节 deviceKey），持久化。幂等。 */
export function ensureDeviceIdentity(): { deviceId: string; deviceKey: string } {
  const cfg = getRemoteConfig()
  if (cfg.deviceId && cfg.deviceKey) return { deviceId: cfg.deviceId, deviceKey: cfg.deviceKey }
  const identity = { deviceId: randomUUID(), deviceKey: randomBytes(32).toString('base64') }
  saveRemoteConfig(identity)
  return identity
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/remote-config.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/main/remote-config.ts tests/remote-config.test.ts
git commit -m "feat(remote): 桌面端远程配置读写（默认域名/设备身份）"
```

---

### Task 7: remote-bridge 连接与 bind 握手

**Files:**
- Create: `src/main/remote-bridge.ts`
- Test: `tests/remote-bridge.test.ts`

**Interfaces:**
- Consumes: `getRemoteConfig`/`ensureDeviceIdentity`（Task 6）、`makeEnvelope`（Task 1）、`ws`
- Produces: `createRemoteBridge(deps)` → `{ start(), stop(), onInbound(cb), send(env), isConnected() }`。状态机 disconnected→connecting→connected，指数退避重连（1s→30s）。

> deps 注入 `ClaudeService`、`SessionQueryManager`、`webContents`，避免 remote-bridge 直接 import 主进程单例（便于测试）。

- [ ] **Step 1: 写失败测试 — bind 握手与重连**

```ts
// tests/remote-bridge.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { startRelayServer } from '../../relay/server'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'

describe('remote-bridge 连接', () => {
  it('bind 握手成功后 isConnected 为 true', async () => {
    const { createRemoteBridge } = await import('../src/main/remote-bridge')
    const dataDir = join(tmpdir(), `rb-${Math.random().toString(36).slice(2)}`)
    const relay = await startRelayServer({ port: 0, dataDir })
    // 预置绑定 + 密钥（模拟已配对）
    const bindings = (relay as any) // 内部暴露 bindings 以便测试预置；若不暴露则用配对流程
    const deviceId = 'D', deviceKey = 'dGVzdA=='

    const bridge = createRemoteBridge({
      relayUrl: `ws://127.0.0.1:${relay.port}`,
      deviceId, deviceKey,
      onInbound: () => {},
    })
    await bridge.start()
    // 等握手
    await new Promise(r => setTimeout(r, 200))
    expect(bridge.isConnected()).toBe(true)
    await bridge.stop()
    await relay.close()
    await rm(dataDir, { recursive: true, force: true })
  })
})
```

> 注：此测试需 relay 已预置绑定关系（D↔M）。若 server 不暴露内部 bindings，则改为先跑配对流程（issue+consume）建立绑定。执行时据 Task 5 的实际 API 调整。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/remote-bridge.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 remote-bridge 连接核心**

```ts
// src/main/remote-bridge.ts
// 桌面端中继客户端：WSS 连接 + 自动重连 + bind 握手。
// 边界：不直接碰 SDK，通过注入的 deps（ClaudeService/manager/webContents）调用现有 API。
import { WebSocket } from 'ws'
import { makeEnvelope, type Envelope } from '../shared/remote-protocol'

export interface BridgeDeps {
  relayUrl: string
  deviceId: string
  deviceKey: string
  onInbound: (env: Envelope) => void
}

export interface RemoteBridge {
  start(): Promise<void>
  stop(): Promise<void>
  send(env: Envelope): void
  isConnected(): boolean
}

const MIN_BACKOFF = 1000
const MAX_BACKOFF = 30000

export function createRemoteBridge(deps: BridgeDeps): RemoteBridge {
  let ws: WebSocket | null = null
  let connected = false
  let stopped = false
  let backoff = MIN_BACKOFF

  function connect() {
    if (stopped) return
    ws = new WebSocket(deps.relayUrl.endsWith('/ws') ? deps.relayUrl : `${deps.relayUrl}/ws`)
    ws.on('open', () => {
      // bind 握手：上报 deviceId + deviceKey
      const bind = makeEnvelope(deps.deviceKey, 'bind', deps.deviceId, { deviceKey: deps.deviceKey })
      ws!.send(JSON.stringify(bind))
      backoff = MIN_BACKOFF // 重连成功重置退避
    })
    ws.on('message', (raw) => {
      let env: Envelope
      try { env = JSON.parse(raw.toString()) } catch { return }
      if (env.type === 'bind.ok') { connected = true; return }
      if (env.type === 'error') { connected = false; scheduleReconnect(); return }
      deps.onInbound(env)
    })
    ws.on('close', () => { connected = false; scheduleReconnect() })
    ws.on('error', () => { connected = false; /* close 会触发重连 */ })
  }

  function scheduleReconnect() {
    if (stopped) return
    setTimeout(() => connect(), backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF)
  }

  return {
    async start() { stopped = false; connect() },
    async stop() { stopped = true; ws?.close(); connected = false },
    send(env) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env)) },
    isConnected() { return connected },
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/remote-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/remote-bridge.ts tests/remote-bridge.test.ts
git commit -m "feat(remote): remote-bridge 连接与 bind 握手（指数退避重连）"
```

---

### Task 8: 入站命令分发（手机→桌面）

**Files:**
- Modify: `src/main/remote-bridge.ts`
- Test: `tests/remote-bridge-dispatch.test.ts`

**Interfaces:**
- Consumes: 注入的 `ClaudeService.send`、`manager.interrupt`、`resolveDialog`、`webContents`
- Produces: `onInbound` 内的分发逻辑：`session.message`→send、`session.interrupt`→interrupt、`session.attach`→标记、`session.create`→建会话。白名单校验 type。

- [ ] **Step 1: 写失败测试 — 消息分发映射**

```ts
// tests/remote-bridge-dispatch.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('remote-bridge 入站分发', () => {
  it('session.message → 调 send({prompt, localSessionId})', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi' } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'hi', localSessionId: 's1' }))
  })

  it('session.interrupt → 调 interrupt(localSessionId)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const interrupt = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt, resolveDialog: vi.fn() })
    await dispatch({ type: 'session.interrupt', deviceId: 'M', payload: { localSessionId: 's1' } } as any)
    expect(interrupt).toHaveBeenCalledWith('s1')
  })

  it('dialog.response → 调 resolveDialog(reqId, result)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const resolveDialog = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog })
    await dispatch({ type: 'dialog.response', deviceId: 'M', payload: { reqId: 'r1', result: { ok: true } } } as any)
    expect(resolveDialog).toHaveBeenCalledWith('r1', { ok: true })
  })

  it('未知 type 不抛错（静默忽略）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn() })
    await expect(dispatch({ type: 'unknown.type', deviceId: 'M', payload: {} } as any)).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/remote-bridge-dispatch.test.ts`
Expected: FAIL

- [ ] **Step 3: 在 remote-bridge.ts 追加 dispatcher**

在 `src/main/remote-bridge.ts` 末尾追加：

```ts
export interface DispatchDeps {
  send: (opts: { prompt: string; localSessionId?: string; webContents?: any }) => Promise<void>
  interrupt: (localSessionId: string) => void
  resolveDialog: (reqId: string, result: any) => void
}

/** 入站消息分发：手机→桌面的命令白名单。未知 type 静默忽略。 */
export function createDispatcher(deps: DispatchDeps) {
  return async (env: Envelope) => {
    switch (env.type) {
      case 'session.message': {
        const p = env.payload as { localSessionId: string; text: string }
        await deps.send({ prompt: p.text, localSessionId: p.localSessionId })
        break
      }
      case 'session.interrupt': {
        const p = env.payload as { localSessionId: string }
        deps.interrupt(p.localSessionId)
        break
      }
      case 'dialog.response': {
        const p = env.payload as { reqId: string; result: any }
        deps.resolveDialog(p.reqId, p.result)
        break
      }
      case 'session.attach':
      case 'session.create':
        // TODO Task 10: 会话清单/接管/新建
        break
      default:
        // 白名单外，静默忽略（最小特权）
        break
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/remote-bridge-dispatch.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/remote-bridge.ts tests/remote-bridge-dispatch.test.ts
git commit -m "feat(remote): 入站命令分发（message/interrupt/dialog.response 白名单）"
```

---

### Task 9: dialog.request 出站桥 + 断线补发

**Files:**
- Modify: `src/main/remote-bridge.ts`
- Test: `tests/remote-dialog-replay.test.ts`

**Interfaces:**
- Consumes: `makeEnvelope`（Task 1）
- Produces: `createDialogReplayer(send)` → `{ enqueue(reqId, env), replayFor(deviceId), cancel(reqId), cleanupExpired() }`。挂起 dialog 登记，重连补发，24h 兜底清理。

> 这是协议里唯一状态化部分（spec §5.3）。dialog.request 挂在桌面 dialogResolvers 的 Promise 上，remote-bridge 额外登记一份用于断线补发。

- [ ] **Step 1: 写失败测试 — 登记/补发/清理**

```ts
// tests/remote-dialog-replay.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('dialog 断线补发', () => {
  it('enqueue 登记，replayFor 重发所有未取消的', () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const r = createDialogReplayer((env) => sent.push(env))
    r.enqueue('r1', { type: 'dialog.request', payload: { reqId: 'r1' } } as any)
    r.enqueue('r2', { type: 'dialog.request', payload: { reqId: 'r2' } } as any)
    r.replayFor('M')
    expect(sent).toHaveLength(2)
  })

  it('cancel 后 replayFor 不再补发该请求', () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const r = createDialogReplayer((env) => sent.push(env))
    r.enqueue('r1', { type: 'dialog.request', payload: { reqId: 'r1' } } as any)
    r.cancel('r1')
    r.replayFor('M')
    expect(sent).toHaveLength(0)
  })

  it('cleanupExpired 移除超过 24h 的登记', () => {
    const { createDialogReplayer } = await import('../src/main/remote-bridge')
    const r = createDialogReplayer(() => {})
    r.enqueue('r1', { type: 'dialog.request', payload: { reqId: 'r1' } } as any)
    // 模拟过期（实现需支持注入 now 或用 expiresAt）
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 25 * 3600_000)
    r.cleanupExpired()
    const sent: any[] = []
    ;(r as any).send = (e: any) => sent.push(e)
    r.replayFor('M')
    expect(sent).toHaveLength(0)
    vi.useRealTimers()
  })
})
```

> 注：测试用了顶层 await import，需确保 vitest 配置支持（默认支持）。`createDialogReplayer` 内部用 `Date.now()`，测试用 `vi.setSystemTime` 控制。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/remote-dialog-replay.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 dialog replayer，追加到 remote-bridge.ts**

```ts
const DIALOG_TTL_MS = 24 * 3600_000 // 24h 兜底硬上限

export interface DialogReplayer {
  enqueue(reqId: string, env: Envelope): void
  replayFor(deviceId: string): void
  cancel(reqId: string): void
  cleanupExpired(): void
}

/** 登记挂起的 dialog.request，断线重连后补发给手机。24h 兜底清理防泄漏。 */
export function createDialogReplayer(sendFn: (env: Envelope) => void): DialogReplayer {
  const pending = new Map<string, { env: Envelope; expiresAt: number }>()
  return {
    enqueue(reqId, env) { pending.set(reqId, { env, expiresAt: Date.now() + DIALOG_TTL_MS }) },
    replayFor(_deviceId) {
      for (const { env } of pending.values()) sendFn(env)
    },
    cancel(reqId) { pending.delete(reqId) },
    cleanupExpired() {
      const now = Date.now()
      for (const [id, { expiresAt }] of pending) if (now > expiresAt) pending.delete(id)
    },
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/remote-dialog-replay.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/remote-bridge.ts tests/remote-dialog-replay.test.ts
git commit -m "feat(remote): dialog.request 断线补发登记（24h 兜底清理）"
```

---

### Task 10: 出站事件转发（旁路监听 claude:* IPC）

**Files:**
- Modify: `src/main/remote-bridge.ts`
- Test: `tests/remote-event-forward.test.ts`

**Interfaces:**
- Consumes: `makeEnvelope`、`webContents`（注入）
- Produces: `attachEventForwarding(webContents, send)`。监听 `claude:delta`/`claude:blocks`/`claude:notice`/`claude:result`/`claude:dialog-request`，转成协议消息发中继。`dialog-request` 同时 enqueue 到 replayer。

- [ ] **Step 1: 写失败测试 — 事件→协议消息映射**

```ts
// tests/remote-event-forward.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('出站事件转发', () => {
  it('delta 事件 → session.delta 协议消息', () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    fwd.onClaudeDelta({ kind: 'text', delta: 'hi', localSessionId: 's1' })
    expect(sent[0].type).toBe('session.delta')
    expect(sent[0].payload).toMatchObject({ text: 'hi', localSessionId: 's1' })
  })

  it('dialog-request 事件 → dialog.request 协议消息 + 登记 replayer', () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const enqueue = vi.fn()
    const fwd = createEventForwarder((env) => sent.push(env), { enqueueDialog: enqueue })
    fwd.onDialogRequest({ reqId: 'r1', localSessionId: 's1', dialogKind: 'plan', payload: {} })
    expect(sent[0].type).toBe('dialog.request')
    expect(enqueue).toHaveBeenCalledWith('r1', expect.anything())
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/remote-event-forward.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 event forwarder，追加到 remote-bridge.ts**

```ts
export interface EventForwarderOpts {
  enqueueDialog?: (reqId: string, env: Envelope) => void
}

/** 出站事件转发：把桌面 claude:* IPC 事件转成协议消息。dialog.request 同时登记补发。 */
export function createEventForwarder(sendFn: (env: Envelope) => void, opts: EventForwarderOpts = {}) {
  // 注意：env 由调用方（remote-bridge start）用 makeEnvelope 包装带签名；
  // 这里只负责「业务事件 → 协议 payload/type」，签名由外层 send 时统一加。
  // 为简化，此处 sendFn 收到的是「待签名信封」，由 remote-bridge 注入签名后的 send。
  return {
    onClaudeDelta(data: { kind: 'text' | 'thinking'; delta: string; localSessionId: string }) {
      const payload = data.kind === 'thinking'
        ? { localSessionId: data.localSessionId, thinking: data.delta }
        : { localSessionId: data.localSessionId, text: data.delta }
      sendFn({ type: 'session.delta', deviceId: '', ts: 0, nonce: '', sig: '', v: 1, payload } as Envelope)
    },
    onClaudeBlocks(data: any) {
      sendFn({ type: 'session.blocks', deviceId: '', ts: 0, nonce: '', sig: '', v: 1, payload: data } as Envelope)
    },
    onNotice(data: any) {
      sendFn({ type: 'session.notice', deviceId: '', ts: 0, nonce: '', sig: '', v: 1, payload: data } as Envelope)
    },
    onResult(data: any) {
      sendFn({ type: 'session.result', deviceId: '', ts: 0, nonce: '', sig: '', v: 1, payload: data } as Envelope)
    },
    onDialogRequest(data: { reqId: string; localSessionId: string; dialogKind: string; payload: any }) {
      const env = { type: 'dialog.request', deviceId: '', ts: 0, nonce: '', sig: '', v: 1, payload: data } as Envelope
      opts.enqueueDialog?.(data.reqId, env)
      sendFn(env)
    },
  }
}
```

> 注：forwarder 产出「待签名」的信封（sig 为空占位），由 remote-bridge 的 `send` 统一用 `makeEnvelope` 重签后发中继。这样测试只需验证 type/payload 映射，不依赖密钥。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/remote-event-forward.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/remote-bridge.ts tests/remote-event-forward.test.ts
git commit -m "feat(remote): 出站事件旁路转发（delta/blocks/notice/result/dialog）"
```

---

### Task 11: 装配到主进程 + IPC + 设置页

**Files:**
- Modify: `src/main/index.ts`（注册 remote:* IPC、app ready 时初始化 bridge）
- Modify: `src/preload/index.ts`（暴露 remote.* API）
- Modify: `src/main/claude-service.ts`（`askUserViaPanel` 发 dialog-request 后触发 forwarder；或在 index.ts 注入 hook）
- Create: `src/renderer/components/settings/RemoteSettings.tsx`
- Modify: 设置页入口组件（加入远程区块）
- Modify: `src/renderer/i18n/zh-CN.ts` + `en.ts`（远程文案）

**Interfaces:**
- Consumes: Task 6-10 全部
- Produces: 完整可用的桌面端远程功能（设置页开关/配对/解绑，后台 bridge 运行）。

- [ ] **Step 1: preload 暴露 remote API**

修改 `src/preload/index.ts`，在 `contextBridge.exposeInMainWorld('api', {...})` 内加：

```ts
remote: {
  getConfig: () => ipcRenderer.invoke('remote:get-config'),
  saveConfig: (patch: any) => ipcRenderer.invoke('remote:save-config', patch),
  pair: () => ipcRenderer.invoke('remote:pair'),       // 生成配对码 + 二维码
  cancelPair: () => ipcRenderer.invoke('remote:cancel-pair'),
  unpair: (deviceId: string) => ipcRenderer.invoke('remote:unpair', deviceId),
  onPairEvent: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('remote:pair-event', handler)
    return () => ipcRenderer.removeListener('remote:pair-event', handler) // unsubscribe 防泄漏
  },
  onState: (cb: (s: { connected: boolean }) => void) => {
    const handler = (_: any, s: any) => cb(s)
    ipcRenderer.on('remote:state', handler)
    return () => ipcRenderer.removeListener('remote:state', handler)
  },
},
```

- [ ] **Step 2: 主进程注册 IPC + 初始化 bridge**

修改 `src/main/index.ts`，在 app ready 后、现有服务初始化附近加：

```ts
import { getRemoteConfig, saveRemoteConfig, ensureDeviceIdentity } from './remote-config'
import { createRemoteBridge, createDispatcher, createDialogReplayer, createEventForwarder } from './remote-bridge'
import { makeEnvelope } from '../shared/remote-protocol'
import QRCode from 'qrcode' // 需安装

let bridge: ReturnType<typeof createRemoteBridge> | null = null
let replayer: ReturnType<typeof createDialogReplayer> | null = null
let pairingCode: string | null = null

function startBridge(mainWindow: BrowserWindow) {
  const cfg = getRemoteConfig()
  if (!cfg.enabled || !cfg.deviceId) return
  const wc = mainWindow.webContents
  replayer = createDialogReplayer((env) => bridge?.send(env))
  const dispatcher = createDispatcher({
    send: (opts) => claudeService.send({ ...opts, webContents: wc }),
    interrupt: (lsid) => claudeService.manager?.interrupt(lsid),
    resolveDialog: (reqId, result) => claudeService.resolveDialog(reqId, result),
  })
  // 出站事件转发：旁路监听主窗口 IPC
  const fwd = createEventForwarder(
    (env) => bridge?.send(makeEnvelope(cfg.deviceKey, env.type as any, cfg.deviceId, env.payload)),
    { enqueueDialog: (reqId, env) => replayer?.enqueue(reqId, env) },
  )
  wc.on('claude:delta', (_e, data) => fwd.onClaudeDelta(data))
  wc.on('claude:blocks', (_e, data) => fwd.onClaudeBlocks(data))
  wc.on('claude:notice', (_e, data) => fwd.onNotice(data))
  wc.on('claude:result', (_e, data) => fwd.onResult(data))
  wc.on('claude:dialog-request', (_e, data) => fwd.onDialogRequest(data))

  bridge = createRemoteBridge({
    relayUrl: cfg.relayUrl,
    deviceId: cfg.deviceId,
    deviceKey: cfg.deviceKey,
    onInbound: (env) => { dispatcher(env); if (env.type === 'bind.ok' as any) replayer?.replayFor('mobile') },
  })
  bridge.start()
}

ipcMain.handle('remote:get-config', () => getRemoteConfig())
ipcMain.handle('remote:save-config', (_e, patch) => {
  saveRemoteConfig(patch)
  // enabled 切换时启停 bridge
  if (patch.enabled !== undefined) {
    if (patch.enabled) { ensureDeviceIdentity(); startBridge(mainWindow!) }
    else { bridge?.stop(); bridge = null }
  }
})
ipcMain.handle('remote:pair', async () => {
  // 通过中继 issue 配对码（v1：bridge 已连接则经 ws 发 pair.code；否则提示先启用）
  // 此处简化：调用中继 HTTP 或经 bridge 发 pair.code，返回 code + QR dataURL
  // 完整实现据 Task 5 server API 对接
  const code = pairingCode = /* 经中继拿到 */ 'XXXXXX'
  const qr = await QRCode.toDataURL(`${getRemoteConfig().relayUrl}/?pair=${code}`)
  return { code, qr }
})
ipcMain.handle('remote:unpair', (_e, deviceId) => {
  // 通知中继删绑定 + 清本地 pairedDevices + 清理挂起 dialog
  saveRemoteConfig({ pairedDevices: getRemoteConfig().pairedDevices.filter(d => d !== deviceId) })
})
```

> 注：pair 码的真实获取需对接中继 `/pair` 端点（Task 5）。`wc.on('claude:dialog-request')` 是旁路监听 webContents 自身发出的事件——需验证 Electron 是否允许监听自身 send 的事件，若不可行则改为在 `askUserViaPanel` 内直接调用 forwarder（侵入点）。执行时据实测调整，两种方案任一皆可。

- [ ] **Step 3: 安装 qrcode 依赖**

Run: `pnpm add qrcode && pnpm add -D @types/qrcode`

- [ ] **Step 4: 创建设置页组件 RemoteSettings.tsx**

参考现有设置组件风格（如 `src/renderer/components/settings/` 下其他组件的 overlay/input/label 模式）：

```tsx
// src/renderer/components/settings/RemoteSettings.tsx
// 远程控制设置区块：开关、中继地址、配对（码+二维码）、已配对设备列表。
import { useEffect, useState } from 'react'

export function RemoteSettings() {
  const [cfg, setCfg] = useState<any>(null)
  const [pairResult, setPairResult] = useState<{ code: string; qr: string } | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => { window.api.remote.getConfig().then(setCfg) }, [])
  useEffect(() => window.api.remote.onState(s => setConnected(s.connected)), [])

  if (!cfg) return null
  const update = (patch: any) => { window.api.remote.saveConfig(patch); setCfg({ ...cfg, ...patch }) }

  return (
    <div>
      <label><input type="checkbox" checked={cfg.enabled} onChange={e => update({ enabled: e.target.checked })} /> 启用远程控制</label>
      <div>状态：{connected ? '已连接' : '未连接'}</div>
      <input value={cfg.relayUrl} onChange={e => update({ relayUrl: e.target.value })} placeholder="https://ccdesk.mrhua.top" />
      {cfg.enabled && (
        <div>
          <button onClick={async () => setPairResult(await window.api.remote.pair())}>生成配对码</button>
          {pairResult && (
            <div>
              <div>配对码：{pairResult.code}（60秒有效）</div>
              <img src={pairResult.qr} alt="配对二维码" />
              <div>请用手机相机扫码（勿用微信扫）</div>
            </div>
          )}
        </div>
      )}
      {cfg.pairedDevices?.length > 0 && (
        <div>
          已配对设备：{cfg.pairedDevices.map(d => (
            <span key={d}>{d} <button onClick={() => window.api.remote.unpair(d)}>解绑</button></span>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 把 RemoteSettings 挂到设置页**

找到设置页主组件（按现有 section 模式），加入「远程控制」section 渲染 `<RemoteSettings />`。

- [ ] **Step 6: 加 i18n 文案**

在 `src/renderer/i18n/zh-CN.ts` 和 `en.ts` 加对应 key（如 `remote.title`、`remote.enable`、`remote.status.connected` 等），两边对齐（`i18n-completeness.test.ts` 会校验）。

- [ ] **Step 7: 手动验证 + 全量测试**

Run: `npx vitest run`（确保所有新测试通过、无回归）
手动：`pnpm dev` → 设置页开关远程 → 看到配对码/二维码 → 中继（另开终端 `node relay/server.js`，需先 `pnpm build` web）→ 手机扫码。

- [ ] **Step 8: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/components/settings/RemoteSettings.tsx src/renderer/i18n/ package.json pnpm-lock.yaml
# 若改了 claude-service.ts 也一并 add
git commit -m "feat(remote): 装配到主进程 + IPC + 设置页（开关/配对/解绑/状态）"
```

---

## 阶段 D：手机 PWA

> PWA 依赖协议类型（Task 1）和中继（阶段 B）。每个任务较小，骨架如下，执行时按 TDD 细化。

### Task 12: PWA 脚手架 + useRelay hook（连接/bind/重连/签名）

**Files:**
- Create: `web/` 目录、`web/src/hooks/useRelay.ts`、`web/vite.config.ts`、`web/index.html`、`web/src/main.tsx`
- Test: `web/src/hooks/useRelay.test.ts`

- [ ] **Step 1: 初始化 web 项目**

Run: 在 `web/` 下初始化 vite + react + ts（`pnpm create vite` 或手动建 `package.json` + vite 配置）。复用 `src/shared/remote-protocol.ts`（tsconfig path 或复制类型）。

- [ ] **Step 2-5: TDD 实现 useRelay**

`useRelay({ relayUrl, deviceId, deviceKey })` 返回 `{ connected, send(type, payload), attach(sessionId) }`。内部 WebSocket + bind 握手 + 指数退避重连 + makeEnvelope 签名。逻辑与 Task 7 的 remote-bridge 镜像（手机侧）。

测试要点：bind.ok 后 connected=true、断线后重连、send 用密钥签名。

- [ ] **Step 6: 提交**

```bash
git add web/
git commit -m "feat(pwa): 脚手架 + useRelay hook（连接/bind/重连/签名）"
```

---

### Task 13: 配对页 PairPage（输码/扫码 + 本地存密钥）

**Files:**
- Create: `web/src/pages/PairPage.tsx`
- Test: `web/src/pages/PairPage.test.tsx`

- [ ] **Step 1-5: TDD 实现配对页**

读取 URL `?pair=code`（扫码直达）或输入框。走 `/pair` 端点：发 `{type:'pair.consume', deviceId, code}`，收到 `pair.success` 后本地存 `{deviceId, deviceKey}`（localStorage/IndexedDB），跳转会话列表页。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/PairPage.tsx
git commit -m "feat(pwa): 配对页（扫码/输码 + 密钥本地存储）"
```

---

### Task 14: 会话列表页 + 对话页（流式输出 + 输入 + 批准卡片）

**Files:**
- Create: `web/src/pages/SessionListPage.tsx`、`web/src/pages/ChatPage.tsx`、`web/src/hooks/useDialogQueue.ts`
- Test: 对应 `.test.tsx`

- [ ] **Step 1-5: TDD 实现**

- `SessionListPage`：收到 `session.list` 渲染会话列表，点击 → `session.attach`；「新建」→ `session.create`。
- `ChatPage`：渲染 `session.delta`（markdown，复用 remark/shiki 思路）+ `session.blocks`；底部输入框 → `session.message`；中断按钮 → `session.interrupt`。
- `useDialogQueue`：管理 `dialog.request` 队列（断线补发后顺序展示），批准/拒绝/忽略 → `dialog.response`。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/ web/src/hooks/useDialogQueue.ts
git commit -m "feat(pwa): 会话列表 + 对话页（流式/输入/批准卡片）"
```

---

### Task 15: PWA manifest + Service Worker + 构建到 relay/public

**Files:**
- Create: `web/public/manifest.json`、`web/public/sw.js`、图标
- Modify: `web/vite.config.ts`（构建输出到 `relay/public/`）
- Modify: `relay/server.ts`（已支持 staticDir，无需改）

- [ ] **Step 1: 加 manifest + SW**

`manifest.json`：name/icons/theme/display:standalone。`sw.js`：缓存壳（index.html + JS/CSS）。

- [ ] **Step 2: 构建产物指向 relay/public**

`web/vite.config.ts` 的 `build.outDir = '../relay/public'`。

- [ ] **Step 3: 端到端手动验证**

Run: `pnpm --filter web build` → `node relay/server.js`（staticDir 默认 relay/public）→ 手机访问域名 → 配对 → 对话 → 批准。

- [ ] **Step 4: 提交**

```bash
git add web/public/ web/vite.config.ts
git commit -m "feat(pwa): manifest + Service Worker + 构建到 relay/public"
```

---

## 收尾

- [ ] **文档**：更新 `CLAUDE.md` 的架构说明（新增 remote-bridge / relay / web 三块）+ README 提及远程功能与部署（中继需用户自配域名+证书+pm2）。
- [ ] **全量测试**：`pnpm test` 全绿。
- [ ] **真机 e2e（可选）**：参照 `tests/e2e-real-model.test.ts` 模式，起中继 + 手机浏览器，验证完整批准链路。

## Self-Review（计划写完后自查）

1. **Spec 覆盖**：
   - 三组件（中继/桌面/PWA）→ 阶段 B/C/D ✓
   - 配对码 + 二次确认 → Task 3 + Task 11（pair 流程含桌面确认）✓
   - HMAC 签名/防重放 → Task 1 ✓
   - 自动重连 → Task 7（桌面）+ Task 12（手机）✓
   - dialog 断线补发 + 24h 兜底 + 事件驱动取消 → Task 9 ✓
   - 双端批准去重 → 复用 resolveDialog 的 delete（Task 8 验证映射）✓
   - 最小特权（6 种命令白名单）→ Task 8 dispatcher default 静默 ✓
   - 默认域名 → Task 6 ✓
   - 扫码体验 → Task 11 二维码 + Task 13 扫码 ✓
   - 部署（域名+HTTPS 用户处理）→ 文档 ✓

2. **已知需执行时确认的点**（计划里已标注）：
   - Task 6：`paths.ts` 的 `CC_DESK_DIR` 是否读 env（影响测试隔离）
   - Task 11：`webContents.on('claude:dialog-request')` 能否旁路监听自身事件，否则改在 `askUserViaPanel` 注入
   - Task 11：pair 码获取对接中继 `/pair` 端点的具体调用

3. **类型一致性**：`Envelope`、`MessageType`、`createRemoteBridge`、`createDispatcher`、`createDialogReplayer`、`createEventForwarder` 在各 Task 间签名一致 ✓
