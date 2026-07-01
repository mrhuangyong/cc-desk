# 上下文面板【压缩】按钮 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在输入框底部上下文用量圆环的详情面板里加【压缩】按钮，点击通过 `pushMessage("/compact")` 触发 CLI 子进程真实压缩，占比环立即下降。

**Architecture:** 新增轻量 IPC `claude:compact-context`（绕开 `claude:send` 的消息追加），主进程 `manager.pushMessage(lsid, "/compact")` 让 CLI 子进程本地执行 `/compact` local 命令真实压缩历史；复用现有 `compact_boundary`/`compacting` notice 反馈，仅在 `compact_boundary` 后主动推一次 context-usage 让占比环立即刷新。

**Tech Stack:** Electron (main/preload/renderer) + React + TypeScript + i18n 字典。

## Global Constraints

- 提交规范 Conventional Commits（`feat:` 等），无本地 lint/husky。
- i18n 两语言（zh-CN / en）必须对齐，受 `tests/i18n-completeness.test.ts` 校验。
- IPC 新通道必须：preload 暴露 + main `ipcMain.handle` 注册 + `global.d.ts` 类型声明。
- 测试涉及落盘主进程的需隔离 `CLAUDE_CONFIG_DIR`；本计划改动无落盘，但 claude-service 测试需注意 mock。
- 已知 pre-existing 失败（claude-service-autocompact / store-readwrite / input-bar）与本改动无关，回归时忽略。
- 禁止 mock 替代真实功能实现。

**关键事实（已查证 Claude CLI 源码）**：SDK `query()` 底层是 CLI 子进程，CLI 在发往模型前做 slash 分发；`/compact` 是 CLI 的 `type:'local'` 命令（`supportsNonInteractive:true`），`pushMessage("/compact")` 会触发真实压缩（真降 token）。SDK 模式不跳过 slash 解析。

---

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `src/main/claude-service.ts` | 新增 `compactContext` 方法 + `compact_boundary` 分支加占比刷新 | 修改 |
| `src/main/index.ts` | 注册 `claude:compact-context` IPC handler | 修改 |
| `src/preload/index.ts` | 暴露 `claude.compactContext` | 修改 |
| `src/renderer/global.d.ts` | `ClaudeAPI` 加 `compactContext` 类型 | 修改 |
| `src/renderer/components/ContextUsageRing.tsx` | `ContextUsagePanel` 加【压缩】按钮 | 修改 |
| `src/renderer/components/InputBar.tsx` | 给 `ContextUsageRing` 传 onCompact/disabled/label | 修改 |
| `src/renderer/i18n/index.ts` | 加 `contextUsage.compact` zh/en | 修改 |
| `tests/compact-context.test.ts` | `compactContext` 单测（mock manager） | 新建 |

---

### Task 1: 主进程 compactContext 方法 + 压缩后刷新占比

**Files:**
- Modify: `src/main/claude-service.ts`（新增 `compactContext` 方法；改 `forwardEvent` 的 `compact_boundary` 分支约 586-595 行）
- Test: `tests/compact-context.test.ts`

**Interfaces:**
- Produces: `ClaudeService.compactContext(localSessionId: string, webContents: WebContents): Promise<void>` — 调 `manager.pushMessage(lsid, '/compact')`；流式中拒绝并发 notice。
- Produces（修改）: `forwardEvent` 的 `compact_boundary` 分支在发 notice 后主动 `getContextUsage` 并 `webContents.send('claude:context-usage', {localSessionId, usage})`。

**背景**：现有 `getContextUsage` 推送模式见 `claude-service.ts:863-872`（for-await 退出前查 + 推）。`compact_boundary` 在 SDK 压缩完成时由 CLI yield，`forwardEvent` 已捕获（586 行）。

- [ ] **Step 1: 写失败测试**

新建 `tests/compact-context.test.ts`：

```ts
// compactContext：通过 pushMessage("/compact") 触发 CLI 真实压缩；流式中拒绝。
// mock SessionQueryManager（避免起 CLI 子进程），验证调用与 notice。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/main/settings-store', () => ({
  getSettings: () => ({ proxy: '', lang: 'zh-CN', cwd: '', inheritTerminal: true }),
}))
vi.mock('../src/main/cc-desk-store', () => ({
  getModelProvidersConfig: () => ({ providers: [], models: [], modelRoleMap: {}, activeModelId: '' }),
  saveModelProvidersConfig: vi.fn(),
}))

describe('ClaudeService.compactContext', () => {
  let ClaudeService: any, claude: any, manager: any, webContents: any

  beforeEach(async () => {
    vi.resetModules()
    ;({ ClaudeService } = await import('../src/main/claude-service'))
    claude = new ClaudeService()
    manager = {
      sessions: new Map(),
      isIterating: vi.fn(() => false),
      pushMessage: vi.fn(),
      getContextUsage: vi.fn(async () => ({ totalTokens: 100, maxTokens: 1000 })),
    }
    claude.setManager(manager)
    webContents = { send: vi.fn() }
  })

  it('非流式时调用 pushMessage("/compact")', async () => {
    await claude.compactContext('s1', webContents)
    expect(manager.pushMessage).toHaveBeenCalledWith('s1', '/compact')
  })

  it('流式中拒绝并发 compact 警告 notice', async () => {
    manager.isIterating = vi.fn(() => true)
    await claude.compactContext('s1', webContents)
    expect(manager.pushMessage).not.toHaveBeenCalled()
    const sent = webContents.send.mock.calls.find(c => c[0] === 'claude:notice')
    expect(sent).toBeTruthy()
    expect(JSON.stringify(sent[1])).toContain('压缩')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/compact-context.test.ts`
Expected: FAIL — `compactContext is not a function`

- [ ] **Step 3: 实现 compactContext 方法**

在 `claude-service.ts` 找到 `compactSession` 方法（约 1212 行），在其**之前**新增 `compactContext`（注意与手写 `compactSession` 区分注释）：

```ts
  /**
   * 触发 SDK/CLI 真实上下文压缩：通过 pushMessage("/compact") 让 CLI 子进程本地执行
   * /compact local 命令（compactConversation 真实摘要替换内部历史，真降 token）。
   * 区别于手写 compactSession（UI 层整理、不降 SDK token）——本方法走 CLI 原生压缩。
   * 压缩进度/结果由 forwardEvent 的 compact_boundary/compacting 分支发 notice 反馈。
   */
  async compactContext(localSessionId: string, webContents: WebContents): Promise<void> {
    if (!this.manager) return
    if (this.manager.isIterating(localSessionId)) {
      webContents.send('claude:notice', { ...mkNotice('compact', '流式对话进行中，无法压缩', 'warn'), localSessionId })
      return
    }
    this.manager.pushMessage(localSessionId, '/compact')
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/compact-context.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: 修改 compact_boundary 分支加占比刷新**

定位 `forwardEvent` 中 `compact_boundary` 分支（约 586-595 行），在 `webContents.send('claude:notice', ...)` 那行**之后**、分支闭合 `}` **之前**插入占比刷新：

```ts
        } else if (subtype === 'compact_boundary') {
          const meta = sys.compact_metadata || {}
          const pre = typeof meta.pre_tokens === 'number' ? meta.pre_tokens : null
          const post = typeof meta.post_tokens === 'number' ? meta.post_tokens : null
          const trigger = meta.trigger === 'manual' ? '手动' : '自动'
          const tokenPart = (pre != null || post != null) ? `：${pre ?? '?'} → ${post ?? '?'} tokens` : ''
          webContents.send('claude:notice', { ...mkNotice('compact', `已${trigger}压缩上下文${tokenPart}`, 'info'), localSessionId: lsid })
          // 压缩完成后主动推一次 context-usage，让输入框占比环立即反映压缩后 token。
          try {
            const usage = await this.manager?.getContextUsage(lsid)
            if (usage) webContents.send('claude:context-usage', { localSessionId: lsid, usage })
          } catch { /* 压缩后查询失败不阻塞 */ }
        }
```

- [ ] **Step 6: 提交**

```bash
git add src/main/claude-service.ts tests/compact-context.test.ts
git commit -m "feat(compact): add compactContext to trigger real CLI /compact"
```

---

### Task 2: IPC 注册 + preload 桥接 + 类型声明

**Files:**
- Modify: `src/main/index.ts`（约 699 行 `cc:builtin:compact` 附近注册新 handler）
- Modify: `src/preload/index.ts`（约 41 行 `contextUsage` 附近）
- Modify: `src/renderer/global.d.ts`（约 41 行 `contextUsage` 附近）

**Interfaces:**
- Consumes: Task 1 的 `claude.compactContext(localSessionId, webContents)`
- Produces: `window.api.claude.compactContext(localSessionId: string): Promise<void>`

**背景**：`getActiveWin()` 在 index.ts 已有；现有 `ipcMain.handle('cc:builtin:compact', (_e, localSessionId) => claude.compactSession(localSessionId, getActiveWin()!.webContents))` 在约 699 行。

- [ ] **Step 1: 注册 IPC handler**

在 `src/main/index.ts` 找到 `ipcMain.handle('cc:builtin:compact', ...)` 行（约 699），在其**下一行**新增：

```ts
  // 触发真实 CLI /compact（区别于 cc:builtin:compact 的手写 UI 摘要）
  ipcMain.handle('claude:compact-context', (_e, localSessionId: string) => claude.compactContext(localSessionId, getActiveWin()!.webContents))
```

- [ ] **Step 2: preload 暴露**

在 `src/preload/index.ts` 找到 `contextUsage: (localSessionId: string) => ipcRenderer.invoke('claude:context-usage', localSessionId),`（约 41 行），在其**下一行**新增：

```ts
    compactContext: (localSessionId: string) => ipcRenderer.invoke('claude:compact-context', localSessionId),
```

- [ ] **Step 3: 类型声明**

在 `src/renderer/global.d.ts` 找到 `contextUsage(localSessionId: string): Promise<any>`（约 41 行），在其**下一行**新增：

```ts
  compactContext(localSessionId: string): Promise<void>
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无错误（exit 0）

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(compact): wire claude:compact-context IPC + preload + types"
```

---

### Task 3: i18n 文案

**Files:**
- Modify: `src/renderer/i18n/index.ts`（约 42 行 zh 段、约 220 行 en 段）

**Interfaces:** Produces `t('contextUsage.compact')` → '压缩' / 'Compact'

- [ ] **Step 1: 加 zh 文案**

在 `src/renderer/i18n/index.ts` 找到 `    'contextUsage.capacity': '上下文容量',`（约 42 行，zh 段），在其**下一行**新增：

```ts
    'contextUsage.compact': '压缩',
```

- [ ] **Step 2: 加 en 文案**

找到 `    'contextUsage.capacity': 'Context capacity',`（约 220 行，en 段），在其**下一行**新增：

```ts
    'contextUsage.compact': 'Compact',
```

- [ ] **Step 3: 验证 i18n 完整性**

Run: `npx vitest run tests/i18n-completeness.test.ts`
Expected: PASS（两语言 key 对齐）

- [ ] **Step 4: 提交**

```bash
git add src/renderer/i18n/index.ts
git commit -m "feat(compact): add contextUsage.compact i18n copy"
```

---

### Task 4: 面板加【压缩】按钮

**Files:**
- Modify: `src/renderer/components/ContextUsageRing.tsx`（`ContextUsagePanel` 加 props + 按钮）
- Modify: `src/renderer/components/InputBar.tsx`（约 662 行挂载点传 props）

**Interfaces:**
- Consumes: `window.api.claude.compactContext`（Task 2）、`t('contextUsage.compact')`（Task 3）
- Produces: UI 按钮（点击触发压缩）

**背景**：`ContextUsagePanel` 在 `ContextUsageRing.tsx:136`，由 `ContextUsageRing`（line 49）在 `open && triggerRef.current` 时渲染（line 101-115），props 在 line 102-114 传入。`isEmptySession` 在 `InputBar.tsx:374`、`isStreaming` 在 `InputBar.tsx:131-132`、`btnBase` 在 `InputBar.tsx:397-401`。

- [ ] **Step 1: 扩展 PanelProps 并渲染按钮**

在 `src/renderer/components/ContextUsageRing.tsx`：

(1) `PanelProps` 接口（约 122-134 行）末尾（`capacityLabel: string` 之后）加 3 个字段：

```ts
  onCompact: () => void
  compactDisabled: boolean
  compactLabel: string
```

(2) `ContextUsagePanel` 函数签名解构（约 136 行）末尾加 `onCompact, compactDisabled, compactLabel`：

```ts
function ContextUsagePanel({ anchor, hasData, total, max, pct, color, categories, onClose, title, unknownLabel, capacityLabel, onCompact, compactDisabled, compactLabel }: PanelProps) {
```

(3) 在面板的 categories 明细 `</div>` 闭合（约 211 行）之后、面板最外层 `</div>`（约 212 行）之前，加按钮：

```tsx
        {/* 压缩按钮：触发 CLI 真实 /compact（真降 token）。流式中/空会话禁用。 */}
        <div style={{ marginTop: cats.length ? 12 : 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => { onCompact(); onClose() }}
            disabled={compactDisabled}
            style={{
              padding: '5px 12px', borderRadius: 7, fontSize: 12, cursor: compactDisabled ? 'not-allowed' : 'pointer',
              border: '1px solid var(--border)', background: 'transparent',
              color: compactDisabled ? 'var(--text-faint)' : 'var(--text)',
              opacity: compactDisabled ? 0.6 : 1,
            }}
          >
            {compactLabel}
          </button>
        </div>
```

(4) `ContextUsageRing`（约 49 行）props 接口 `Props` 加 3 个字段：

```ts
interface Props {
  usage: ContextUsageInfo | null
  maxContextFallback?: number
  onCompact: () => void
  compactDisabled: boolean
  compactLabel: string
}
```

(5) `ContextUsageRing` 函数签名解构加 `onCompact, compactDisabled, compactLabel`（约 49 行）：

```ts
export function ContextUsageRing({ usage, maxContextFallback, onCompact, compactDisabled, compactLabel }: Props) {
```

(6) `<ContextUsagePanel>` 调用（约 102-114 行）加 3 个 props：

```tsx
      {open && triggerRef.current && (
        <ContextUsagePanel
          anchor={triggerRef.current}
          hasData={hasData}
          total={total}
          max={max}
          pct={pct}
          color={color}
          categories={usage?.categories}
          onClose={() => setOpen(false)}
          title={t('contextUsage.title')}
          unknownLabel={t('contextUsage.unknown')}
          capacityLabel={t('contextUsage.capacity')}
          onCompact={onCompact}
          compactDisabled={compactDisabled}
          compactLabel={compactLabel}
        />
      )}
```

- [ ] **Step 2: InputBar 传 props**

在 `src/renderer/components/InputBar.tsx` 找到 `<ContextUsageRing`（约 662 行），改为：

```tsx
          <ContextUsageRing
            usage={state.contextUsageBySession?.[state.activeSessionId] ?? null}
            maxContextFallback={parseContextLength(activeModel?.contextLength)}
            onCompact={() => window.api?.claude?.compactContext(state.activeSessionId)}
            compactDisabled={isStreaming || isEmptySession}
            compactLabel={t('contextUsage.compact')}
          />
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无错误（exit 0）

- [ ] **Step 4: 提交**

```bash
git add src/renderer/components/ContextUsageRing.tsx src/renderer/components/InputBar.tsx
git commit -m "feat(compact): add compress button to context usage panel"
```

---

### Task 5: 端到端验证

**Files:** 无（仅验证）

- [ ] **Step 1: 全量类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0

- [ ] **Step 2: 跑相关测试**

Run: `npx vitest run tests/compact-context.test.ts tests/i18n-completeness.test.ts`
Expected: 全 PASS

- [ ] **Step 3: 全量测试回归**

Run: `npx vitest run`
Expected: 除 3 个 pre-existing 失败文件（claude-service-autocompact / store-readwrite / input-bar）外无新增失败。

- [ ] **Step 4: 手动端到端（dev）**

Run: `pnpm dev`，操作：
1. 开一个有多轮对话的会话，记下占比环数值（如 60%）。
2. 点圆环 → 详情面板 → 点【压缩】。
3. 应看到 notice「正在压缩上下文…」→「已手动压缩：pre → post tokens」，post 明显小于 pre。
4. **占比环立即下降**到 post 附近。
5. 流式中再开面板，【压缩】按钮应禁用（灰）。
6. 空会话开面板，按钮应禁用。
7. 对话历史中**不出现** `/compact` 用户消息。

- [ ] **Step 5: 最终提交（如有手动验证微调）**

若手动验证发现需要微调，单独提交；否则 Task 1-4 已是完整提交链。

---

## Self-Review

**Spec coverage:** spec 的 5 个改动点（compactContext + boundary 刷新 / IPC+preload+types / 面板按钮 / InputBar 传参 / i18n）分别对应 Task 1/2/4/4/3，全覆盖。占比环刷新闭环（spec「占比环刷新闭环」节）在 Task 1 Step 5。流式/空会话禁用在 Task 4。✓

**Placeholder scan:** 无 TBD/TODO；每个 step 都有完整代码或确切命令。✓

**Type consistency:** `compactContext(localSessionId: string): Promise<void>` 在 Task 1（方法）、Task 2（preload/global.d.ts）、Task 4（调用 `window.api.claude.compactContext`）签名一致。`Props`/`PanelProps` 的 `onCompact/compactDisabled/compactLabel` 在 Task 4 内部定义与使用一致。✓
