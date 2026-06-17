# 还原模型多供应商设置 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 还原模型设置的多供应商管理界面，并让 ClaudeService 发消息时真正按选中的供应商/模型配置调用 SDK。

**Architecture:** 新建 `~/.cc-desk/config.json`（electron-store，cwd=`~/.cc-desk/`）作为模型供应商配置的单一真相源。ModelSettings 还原多供应商 UI（左栏列表 + 右栏详情/模型列表），读写该配置。ClaudeService.send 改为从该配置取 provider 的 apiKey/baseUrl + 模型 sdkModelId 注入 SDK `options.env`，不再读 `~/.claude/settings.json` 的模型部分。首次空白、不迁移、不写 `~/.claude/`。

**Tech Stack:** Electron、React、TypeScript、electron-store、vitest、`@anthropic-ai/claude-agent-sdk`。

参考 spec：`docs/superpowers/specs/2026-06-17-multi-provider-model-settings-design.md`

---

## File Structure

| 文件 | 责任 | 新建/修改 |
|---|---|---|
| `src/main/cc-desk-store.ts` | electron-store 读写 `~/.cc-desk/config.json`；`ModelProvidersConfig` 类型、get/save、解析「当前激活 provider+model」的纯函数 | 新建 |
| `src/main/index.ts` | 注册 `cc-desk:model:get` / `cc-desk:model:save` IPC | 修改 |
| `src/preload/index.ts` | 暴露 `window.api.ccDesk.model.{get,save}` | 修改 |
| `src/renderer/global.d.ts` | `ccDesk` 类型声明 + `ModelProvider`/`ModelItem` 类型 | 修改 |
| `src/renderer/types.ts` | `ModelProvider`（去 apiFormat）/ `ModelItem`（加 sdkModelId）类型 | 修改 |
| `src/renderer/components/settings/ModelSettings.tsx` | 多供应商 UI + 持久化读写 | 重写 |
| `src/main/claude-service.ts` | `send()` 改从 cc-desk-store 取配置注入 env | 修改 |
| `src/renderer/components/InputBar.tsx` | 模型下拉改从 ccDesk.model 取、选中存 activeModelId | 修改 |
| `src/renderer/i18n/index.ts` | 补 `model.*` 翻译 key | 修改 |
| `tests/cc-desk-store.test.ts` | 数据层 + 解析函数单测 | 新建 |
| `tests/claude-service-config.test.ts` | env 构建逻辑单测（抽出纯函数） | 新建 |

**关键复用**：electron-store 用法参照现有 `src/main/settings-store.ts`（`new Store({ cwd, defaults })`）；i18n 模式参照 `src/renderer/i18n/index.ts` 现有 key 结构；多供应商 UI 布局参照 HEAD 版 `git show HEAD:src/renderer/components/settings/ModelSettings.tsx`。

---

## Task 1: 数据层 cc-desk-store + 类型

**Files:**
- Create: `src/main/cc-desk-store.ts`
- Modify: `src/renderer/types.ts`（ModelProvider / ModelItem）
- Test: `tests/cc-desk-store.test.ts`

- [ ] **Step 1: 写失败测试 `tests/cc-desk-store.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

// 用临时 HOME 隔离 electron-store，避免污染真实 ~/.cc-desk
const TMP_HOME = path.join(os.tmpdir(), `cc-desk-test-${Date.now()}`)
const ORIG_HOME = process.env.HOME
beforeEach(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
  fs.mkdirSync(TMP_HOME, { recursive: true })
  process.env.HOME = TMP_HOME
  // 清除模块缓存，让 cc-desk-store 用新 HOME 重新初始化 store
  vi.resetModules()
})
afterAll(() => { process.env.HOME = ORIG_HOME; fs.rmSync(TMP_HOME, { recursive: true, force: true }) })

describe('cc-desk-store', () => {
  it('无文件时返回空初始值', async () => {
    const { getModelProvidersConfig } = await import('../src/main/cc-desk-store')
    expect(getModelProvidersConfig()).toEqual({
      providers: [], models: [], modelRoleMap: {}, activeModelId: '',
    })
  })

  it('saveModelProvidersConfig 浅合并写回，再读能拿到', async () => {
    const { getModelProvidersConfig, saveModelProvidersConfig } = await import('../src/main/cc-desk-store')
    saveModelProvidersConfig({ providers: [{ id: 'p1', name: 'ai', apiKey: 'sk', baseUrl: 'http://x', enabled: true }] })
    expect(getModelProvidersConfig().providers.length).toBe(1)
    // 浅合并：再存 models 不影响 providers
    saveModelProvidersConfig({ models: [{ id: 'm1', name: 'glm', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true }] })
    const cfg = getModelProvidersConfig()
    expect(cfg.providers.length).toBe(1)
    expect(cfg.models.length).toBe(1)
  })

  it('resolveActiveProviderModel: activeModelId 指向 enabled 模型时返回它', async () => {
    const { resolveActiveProviderModel } = await import('../src/main/cc-desk-store')
    const cfg = {
      providers: [{ id: 'p1', name: 'ai', apiKey: 'sk', baseUrl: 'http://x', enabled: true }],
      models: [{ id: 'm1', name: 'glm', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true }],
      modelRoleMap: {}, activeModelId: 'm1',
    }
    const r = resolveActiveProviderModel(cfg)
    expect(r?.provider.id).toBe('p1')
    expect(r?.model.sdkModelId).toBe('glm-5.2')
  })

  it('resolveActiveProviderModel: activeModelId 为空时回退首个 enabled provider 的首个 enabled 模型', async () => {
    const { resolveActiveProviderModel } = await import('../src/main/cc-desk-store')
    const cfg = {
      providers: [{ id: 'p1', name: 'ai', apiKey: 'sk', baseUrl: 'http://x', enabled: true }],
      models: [{ id: 'm1', name: 'glm', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true }],
      modelRoleMap: {}, activeModelId: '',
    }
    expect(resolveActiveProviderModel(cfg)?.model.id).toBe('m1')
  })

  it('resolveActiveProviderModel: 无任何 enabled provider+model 时返回 null', async () => {
    const { resolveActiveProviderModel } = await import('../src/main/cc-desk-store')
    expect(resolveActiveProviderModel({ providers: [], models: [], modelRoleMap: {}, activeModelId: '' })).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/cc-desk-store.test.ts`
Expected: FAIL（模块不存在 / 函数未定义）

- [ ] **Step 3: 实现 `src/renderer/types.ts` 的类型**

把现有 `ModelProvider` 和 `ModelItem` 改为：

```ts
export interface ModelProvider {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  enabled: boolean
}

export interface ModelItem {
  id: string
  name: string
  providerId: string
  sdkModelId: string   // 传给 SDK query() options.model 的真实模型名
  contextLength: string
  enabled: boolean
}
```

（去掉 ModelProvider 的 apiFormat；ModelItem 加 sdkModelId。）

- [ ] **Step 4: 实现 `src/main/cc-desk-store.ts`**

```ts
// src/main/cc-desk-store.ts
// cc-desk 自有的配置存储。模型供应商配置写入 ~/.cc-desk/config.json，
// 不读写 ~/.claude/。ClaudeService 从这里取数注入 SDK。
import Store from 'electron-store'
import { join } from 'path'
import { homedir } from 'os'

export interface ModelProvider {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  enabled: boolean
}
export interface ModelItem {
  id: string
  name: string
  providerId: string
  sdkModelId: string
  contextLength: string
  enabled: boolean
}
export interface ModelProvidersConfig {
  providers: ModelProvider[]
  models: ModelItem[]
  modelRoleMap: Record<string, string>
  activeModelId: string
}

const EMPTY: ModelProvidersConfig = { providers: [], models: [], modelRoleMap: {}, activeModelId: '' }

const CC_DESK_DIR = join(homedir(), '.cc-desk')

function createStore(): Store<{ config: ModelProvidersConfig }> {
  return new Store<{ config: ModelProvidersConfig }>({
    name: 'config',
    cwd: CC_DESK_DIR,
    defaults: { config: EMPTY },
  })
}

let store = createStore()

export function getModelProvidersConfig(): ModelProvidersConfig {
  return store.get('config', EMPTY)
}

export function saveModelProvidersConfig(patch: Partial<ModelProvidersConfig>): void {
  const current = getModelProvidersConfig()
  store.set('config', { ...current, ...patch })
}

// 解析「当前激活的 provider + model」供 ClaudeService 注入 env 用。
// activeModelId 指向 enabled 模型时用它；否则回退首个 enabled provider 的首个 enabled 模型；都没有返回 null。
export interface ResolvedProviderModel {
  provider: ModelProvider
  model: ModelItem
}
export function resolveActiveProviderModel(cfg: ModelProvidersConfig): ResolvedProviderModel | null {
  const enabledProviders = cfg.providers.filter(p => p.enabled)
  if (enabledProviders.length === 0) return null
  // 先尝试 activeModelId
  const activeModel = cfg.models.find(m => m.id === cfg.activeModelId && m.enabled)
  if (activeModel) {
    const prov = enabledProviders.find(p => p.id === activeModel.providerId)
    if (prov) return { provider: prov, model: activeModel }
  }
  // 回退：首个 enabled provider 的首个 enabled 模型
  for (const prov of enabledProviders) {
    const m = cfg.models.find(mm => mm.providerId === prov.id && mm.enabled)
    if (m) return { provider: prov, model: m }
  }
  return null
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/cc-desk-store.test.ts`
Expected: PASS（5 个用例全过）

- [ ] **Step 6: 提交**

```bash
git add src/main/cc-desk-store.ts src/renderer/types.ts tests/cc-desk-store.test.ts
git commit -m "feat(model): 新增 cc-desk-store 数据层（~/.cc-desk/config.json）"
```

---

## Task 2: IPC + Preload + 类型声明

**Files:**
- Modify: `src/main/index.ts`（注册 IPC）
- Modify: `src/preload/index.ts`（暴露 ccDesk）
- Modify: `src/renderer/global.d.ts`（类型声明）

- [ ] **Step 1: 在 `src/main/index.ts` 注册 IPC**

在 settings IPC 注册块（`ipcMain.handle('settings:save', ...)` 之后）加：

```ts
import { getModelProvidersConfig, saveModelProvidersConfig } from './cc-desk-store'
```
（加到文件顶部现有 `import { getSettings, saveSettings }` 之后）

```ts
  // cc-desk 自有配置（模型供应商，存 ~/.cc-desk/config.json）
  ipcMain.handle('cc-desk:model:get', () => getModelProvidersConfig())
  ipcMain.handle('cc-desk:model:save', (_e, patch) => saveModelProvidersConfig(patch))
```
（加到 settings 两个 handle 之后）

- [ ] **Step 2: 在 `src/preload/index.ts` 暴露 ccDesk**

在 `settings: {...}` 块之后加：

```ts
  ccDesk: {
    model: {
      get: () => ipcRenderer.invoke('cc-desk:model:get'),
      save: (patch: any) => ipcRenderer.invoke('cc-desk:model:save', patch),
    },
  },
```

- [ ] **Step 3: 在 `src/renderer/global.d.ts` 补类型声明**

在文件顶部 import 加 `ModelItem`：
```ts
import type { Project, Tab, ModelProvider, ModelItem } from './types'
```

在 `SettingsAPI` 接口附近加：
```ts
interface CcDeskModelAPI {
  get(): Promise<{
    providers: ModelProvider[]
    models: ModelItem[]
    modelRoleMap: Record<string, string>
    activeModelId: string
  }>
  save(patch: { providers?: ModelProvider[]; models?: ModelItem[]; modelRoleMap?: Record<string, string>; activeModelId?: string }): Promise<void>
}
interface CcDeskAPI {
  model: CcDeskModelAPI
}
```

在 `declare global { interface Window { api: { ... } } }` 的 `api` 对象里加一行 `ccDesk: CcDeskAPI`（与 `settings`、`projects` 同级）。

- [ ] **Step 4: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: 无新增错误（renderer 配置）。若 `ModelProvider`/`ModelItem` 在 types.ts 旧字段被其他文件引用报错，记录位置留待后续 task 处理（主要在 ModelSettings/InputBar）。

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(model): 注册 cc-desk:model IPC + preload 桥接 + 类型声明"
```

---

## Task 3: ClaudeService env 构建逻辑（TDD 抽纯函数）

把「provider + model + roleMap → SDK env」抽成纯函数，便于单测。

**Files:**
- Modify: `src/main/cc-desk-store.ts`（加 `buildSdkEnv` 纯函数）
- Test: `tests/cc-desk-store.test.ts`（追加用例）

- [ ] **Step 1: 追加失败测试到 `tests/cc-desk-store.test.ts`**

```ts
  it('buildSdkEnv: 注入 apiKey/baseUrl/选中模型 + roleMap', async () => {
    const { buildSdkEnv } = await import('../src/main/cc-desk-store')
    const resolved = {
      provider: { id: 'p1', name: 'ai', apiKey: 'sk-x', baseUrl: 'http://127.0.0.1:17860', enabled: true },
      model: { id: 'm1', name: 'glm', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true },
    }
    const modelRoleMap = { 'p1:sonnet': 'm1' }
    const env = buildSdkEnv(resolved, modelRoleMap)
    expect(env.ANTHROPIC_API_KEY).toBe('sk-x')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:17860')
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-5.2')
    // 无条目的 role 回退到选中模型 sdkModelId
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('glm-5.2')
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('glm-5.2')
  })

  it('buildSdkEnv: baseUrl 为空时不注入 ANTHROPIC_BASE_URL', async () => {
    const { buildSdkEnv } = await import('../src/main/cc-desk-store')
    const resolved = {
      provider: { id: 'p1', name: 'ai', apiKey: 'sk-x', baseUrl: '', enabled: true },
      model: { id: 'm1', name: 'glm', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200K', enabled: true },
    }
    const env = buildSdkEnv(resolved, {})
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('sk-x')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/cc-desk-store.test.ts`
Expected: FAIL（buildSdkEnv 未定义）

- [ ] **Step 3: 实现 `buildSdkEnv`，加到 `src/main/cc-desk-store.ts`**

```ts
// 给定解析出的 provider+model 和 roleMap，构造注入 SDK options.env 的覆盖项。
// roleMap 无条目的角色回退到选中模型的 sdkModelId。
export function buildSdkEnv(
  resolved: ResolvedProviderModel,
  modelRoleMap: Record<string, string>,
  allModels: ModelItem[] = [],
): Record<string, string> {
  const { provider, model } = resolved
  const env: Record<string, string> = {}
  if (provider.apiKey) env.ANTHROPIC_API_KEY = provider.apiKey
  if (provider.baseUrl) env.ANTHROPIC_BASE_URL = provider.baseUrl
  const roleId = (role: 'opus' | 'sonnet' | 'haiku'): string => {
    const mappedModelId = modelRoleMap[`${provider.id}:${role}`]
    const m = allModels.find(mm => mm.id === mappedModelId)
    return m?.sdkModelId || model.sdkModelId
  }
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = roleId('opus')
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = roleId('sonnet')
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = roleId('haiku')
  return env
}
```

注：测试中 allModels 默认空数组，roleMap 指向 m1 但 allModels 里找不到 → 回退 model.sdkModelId。为让测试 1 的 SONNET 断言通过，第一个测试需传 allModels。修正测试 1 的调用为 `buildSdkEnv(resolved, modelRoleMap, [resolved.model])`。

- [ ] **Step 4: 修正测试 1 的 buildSdkEnv 调用，加第三个参数 `[resolved.model]`**

```ts
    const env = buildSdkEnv(resolved, modelRoleMap, [resolved.model])
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/cc-desk-store.test.ts`
Expected: PASS（含新增 2 例）

- [ ] **Step 6: 提交**

```bash
git add src/main/cc-desk-store.ts tests/cc-desk-store.test.ts
git commit -m "feat(model): 抽出 buildSdkEnv 纯函数（provider/model→SDK env）"
```

---

## Task 4: ClaudeService.send 接通 cc-desk 配置

**Files:**
- Modify: `src/main/claude-service.ts`

- [ ] **Step 1: 改造 `send()` 取数与 env 注入**

在 `src/main/claude-service.ts`：
- 顶部 import 改：去掉 `getModelConfig`（保留 `getGeneralConfig`），加 cc-desk-store：

```ts
import { getModelProvidersConfig, resolveActiveProviderModel, buildSdkEnv } from './cc-desk-store'
import { getGeneralConfig } from './claude-config'
```

- 删除 `buildEnvFromModelConfig` 函数（25-37 行，已被 buildSdkEnv 取代）。
- 在 `send()` 里，把原来的 `const modelCfg = await getModelConfig()` ... `if (!modelCfg.apiKey && !modelCfg.authToken)` 整段（约 54-60 行）替换为：

```ts
    const cfg = getModelProvidersConfig()
    const resolved = resolveActiveProviderModel(cfg)
    if (!resolved) {
      webContents.send('claude:error', { error: '请先在「设置 → 模型设置」中添加并启用供应商与模型' })
      return
    }
    const general = await getGeneralConfig()
```

- 把 `query()` 的 `options.env` 那行（原 `env: { ...process.env, ...proxyEnv, ...buildEnvFromModelConfig(modelCfg) }`）改为：

```ts
          env: { ...process.env, ...proxyEnv, ...buildSdkEnv(resolved, cfg.modelRoleMap, cfg.models) },
```

- 把 `options.model` 那行（原 `model: modelCfg.model || 'sonnet'`）改为：

```ts
          model: resolved.model.sdkModelId,
```

- [ ] **Step 2: 类型检查（node 配置）**

Run: `npx tsc -p tsconfig.node.json --noEmit 2>&1 | grep -E "claude-service|cc-desk-store" || echo "无相关错误"`
Expected: 「无相关错误」（其余 electron-vite/@swc 既有报错忽略）

- [ ] **Step 3: 构建验证**

Run: `npm run build 2>&1 | tail -5`
Expected: main / preload / renderer 三段都 built successfully

- [ ] **Step 4: 提交**

```bash
git add src/main/claude-service.ts
git commit -m "feat(model): ClaudeService 改从 cc-desk 配置取 provider/model 注入 SDK"
```

---

## Task 5: i18n 补 model.* key

**Files:**
- Modify: `src/renderer/i18n/index.ts`

- [ ] **Step 1: 在 `dict` 的 zh-CN 和 en 两个对象里各补一组 model key**

zh-CN（加在 `'settings.hooks'` 行之后）：
```ts
    // 模型设置（多供应商）
    'model.title': '模型设置',
    'model.desc': '管理自定义模型供应商，配置后可在聊天时选择使用。',
    'model.providers': '自定义供应商',
    'model.addProvider': '添加供应商',
    'model.baseUrl': 'Base URL',
    'model.apiKey': 'API Key',
    'model.models': '模型列表',
    'model.addModel': '添加模型',
    'model.sdkModelId': 'SDK 模型 ID',
    'model.contextLength': '上下文',
    'model.enabled': '已启用',
    'model.enable': '启用',
    'model.disable': '禁用',
    'model.emptyProvider': '选择左侧供应商，或点"添加供应商"',
    'model.emptyModels': '暂无模型，点下方添加',
    'model.newProvider': '新供应商',
    'model.newModel': '新模型',
    'model.confirmDelete': '确认删除？',
    'model.noActiveProvider': '未配置可用供应商/模型，请在设置中添加',
```

en（同样位置）：
```ts
    'model.title': 'Model settings',
    'model.desc': 'Manage custom model providers; pick one when chatting.',
    'model.providers': 'Custom providers',
    'model.addProvider': 'Add provider',
    'model.baseUrl': 'Base URL',
    'model.apiKey': 'API Key',
    'model.models': 'Models',
    'model.addModel': 'Add model',
    'model.sdkModelId': 'SDK model ID',
    'model.contextLength': 'Context',
    'model.enabled': 'Enabled',
    'model.enable': 'Enable',
    'model.disable': 'Disable',
    'model.emptyProvider': 'Select a provider on the left, or "Add provider"',
    'model.emptyModels': 'No models yet, add below',
    'model.newProvider': 'New provider',
    'model.newModel': 'New model',
    'model.confirmDelete': 'Confirm delete?',
    'model.noActiveProvider': 'No provider/model configured, add one in settings',
```

- [ ] **Step 2: 提交**

```bash
git add src/renderer/i18n/index.ts
git commit -m "i18n(model): 补充模型多供应商界面翻译 key"
```

---

## Task 6: 重写 ModelSettings.tsx（还原多供应商 UI + 持久化）

**Files:**
- Modify（重写）: `src/renderer/components/settings/ModelSettings.tsx`

参考布局：`git show HEAD:src/renderer/components/settings/ModelSettings.tsx`

- [ ] **Step 1: 重写整个文件**

```tsx
import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

type ModelProvider = {
  id: string; name: string; apiKey: string; baseUrl: string; enabled: boolean
}
type ModelItem = {
  id: string; name: string; providerId: string; sdkModelId: string; contextLength: string; enabled: boolean
}
type Cfg = {
  providers: ModelProvider[]; models: ModelItem[]
  modelRoleMap: Record<string, string>; activeModelId: string
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12 }
const fieldLabelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4, marginTop: 12 }
const iconBtn: React.CSSProperties = { padding: '4px 6px', fontSize: 13, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1 }
const smallBtn: React.CSSProperties = { padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)' }

export function ModelSettings() {
  const { t } = useI18n()
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [activeId, setActiveId] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [confirmingProvider, setConfirmingProvider] = useState<string | null>(null)
  const [editingModel, setEditingModel] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reload = () => {
    setError('')
    window.api?.ccDesk.model.get().then(c => {
      setCfg(c)
      if (!c.providers.some(p => p.id === activeId)) setActiveId(c.providers[0]?.id ?? '')
    }).catch(e => setError(String(e)))
  }
  useEffect(() => { reload() }, [])

  const persist = (patch: Partial<Cfg>) => {
    setCfg(prev => prev ? { ...prev, ...patch } : prev)
    window.api?.ccDesk.model.save(patch)
  }

  if (error) return <div style={{ maxWidth: 760, margin: '40px auto', color: 'var(--danger)', fontSize: 13 }}>读取配置失败：{error}</div>
  if (!cfg) return <div style={{ maxWidth: 760, margin: '40px auto', color: 'var(--text-muted)', fontSize: 13 }}>加载中…</div>

  const provider = cfg.providers.find(p => p.id === activeId)
  const providerModels = cfg.models.filter(m => m.providerId === activeId)

  const addProvider = () => {
    const id = `provider-${Date.now()}`
    const np: ModelProvider = { id, name: t('model.newProvider'), apiKey: '', baseUrl: '', enabled: true }
    persist({ providers: [...cfg.providers, np] })
    setActiveId(id)
  }
  const updateProvider = (patch: Partial<ModelProvider>) =>
    persist({ providers: cfg.providers.map(p => p.id === activeId ? { ...p, ...patch } : p) })
  const removeProvider = (id: string) => {
    persist({
      providers: cfg.providers.filter(p => p.id !== id),
      models: cfg.models.filter(m => m.providerId !== id),
    })
    setConfirmingProvider(null)
    if (activeId === id) {
      const rest = cfg.providers.filter(p => p.id !== id)
      setActiveId(rest[0]?.id ?? '')
    }
  }

  const addModel = () => {
    const name = t('model.newModel')
    const m: ModelItem = { id: `model-${Date.now()}`, name, providerId: activeId, sdkModelId: name, contextLength: '8万', enabled: true }
    persist({ models: [...cfg.models, m] })
  }
  const updateModel = (id: string, patch: Partial<ModelItem>) =>
    persist({ models: cfg.models.map(m => m.id === id ? { ...m, ...patch } : m) })
  const removeModel = (id: string) => {
    persist({ models: cfg.models.filter(m => m.id !== id) })
    setEditingModel(null)
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 0 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>{t('model.title')}</h2>
          <button title="刷新" style={iconBtn} onClick={reload}><RefreshCw size={14} /></button>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>{t('model.desc')}</div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 16, minHeight: 0, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        {/* 左：供应商列表 */}
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, padding: '0 8px' }}>{t('model.providers')}</div>
          {cfg.providers.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
              padding: '8px 10px', marginBottom: 2, borderRadius: 'var(--radius)', cursor: 'pointer', border: 'none',
              background: p.id === activeId ? 'var(--bg-hover)' : 'transparent', color: 'var(--text)', fontSize: 13,
            }}>
              <span style={{ fontSize: 10 }}>{p.id === activeId ? '●' : '○'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </button>
          ))}
          <button onClick={addProvider} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left', padding: '8px 10px', marginTop: 4, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 13 }}><Plus size={13} /> {t('model.addProvider')}</button>
        </div>

        {/* 右：详情 + 模型 */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {provider && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {editingName ? (
                  <input autoFocus defaultValue={provider.name}
                    onBlur={e => { updateProvider({ name: e.target.value }); setEditingName(false) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    style={{ ...inputStyle, width: 'auto', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14 }} />
                ) : (
                  <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{provider.name}</span>
                )}
                <button title="编辑名称" onClick={() => setEditingName(true)} style={iconBtn}><Pencil size={13} /></button>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button onClick={() => updateProvider({ enabled: !provider.enabled })} style={provider.enabled ? { ...smallBtn, background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : smallBtn}>
                    {provider.enabled ? t('model.enabled') : t('model.enable')}
                  </button>
                  {confirmingProvider === provider.id ? (
                    <button onClick={() => removeProvider(provider.id)} style={{ ...smallBtn, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{t('model.confirmDelete')}</button>
                  ) : (
                    <button title="删除" onClick={() => setConfirmingProvider(provider.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
                  )}
                </span>
              </div>

              <div style={fieldLabelStyle}>{t('model.baseUrl')}</div>
              <input value={provider.baseUrl} onChange={e => updateProvider({ baseUrl: e.target.value })} placeholder="http://..." style={inputStyle} />

              <div style={fieldLabelStyle}>{t('model.apiKey')}</div>
              <div style={{ position: 'relative' }}>
                <input type={showKey ? 'text' : 'password'} value={provider.apiKey} onChange={e => updateProvider({ apiKey: e.target.value })} placeholder="sk-..." style={inputStyle} />
                <button onClick={() => setShowKey(s => !s)} title={showKey ? '隐藏' : '显示'} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', background: 'transparent', border: 'none', fontSize: 13, padding: 4, color: 'var(--text-muted)' }}>{showKey ? <EyeOff size={13} /> : <Eye size={13} />}</button>
              </div>

              <div style={fieldLabelStyle}>{t('model.models')}</div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {providerModels.length === 0 && <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>{t('model.emptyModels')}</div>}
                {providerModels.map((m, i) => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 12px', borderBottom: i < providerModels.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)', fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{m.name}</span>
                      <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 11, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{m.contextLength}</span>
                      <button title="编辑" onClick={() => setEditingModel(editingModel === m.id ? null : m.id)} style={iconBtn}><Pencil size={13} /></button>
                      {confirmingProvider === m.id ? null : (
                        <button title="删除" onClick={() => removeModel(m.id)} style={{ ...iconBtn, color: 'var(--danger)' }}><Trash2 size={13} /></button>
                      )}
                    </div>
                    {editingModel === m.id && (
                      <div style={{ display: 'flex', gap: 8, paddingLeft: 0 }}>
                        <input value={m.name} onChange={e => updateModel(m.id, { name: e.target.value })} placeholder="名称" style={{ ...inputStyle, flex: 1 }} />
                        <input value={m.sdkModelId} onChange={e => updateModel(m.id, { sdkModelId: e.target.value })} placeholder={t('model.sdkModelId')} style={{ ...inputStyle, flex: 1 }} />
                        <input value={m.contextLength} onChange={e => updateModel(m.id, { contextLength: e.target.value })} placeholder={t('model.contextLength')} style={{ ...inputStyle, width: 80 }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addModel} style={{ marginTop: 10, ...smallBtn }}>+ {t('model.addModel')}</button>
            </>
          )}
          {!provider && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>{t('model.emptyProvider')}</div>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: ModelSettings.tsx 无新增错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/ModelSettings.tsx
git commit -m "feat(model): 还原多供应商设置 UI，持久化读写 ~/.cc-desk"
```

---

## Task 7: InputBar 模型下拉改从 ccDesk 取

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: 加载模型配置的本地 state**

在 `InputBar` 组件内（`const { t } = useI18n()` 之后）加：

```tsx
import { useEffect, useState } from 'react'  // useEffect 已 import，确认 useState 已 import
```

```tsx
  // 模型列表来自 cc-desk 多供应商配置（仅 enabled 模型）
  const [modelCfg, setModelCfg] = useState<{ models: { id: string; name: string }[]; activeModelId: string } | null>(null)
  useEffect(() => {
    window.api?.ccDesk.model.get().then(c => setModelCfg({
      models: c.models.filter(m => m.enabled).map(m => ({ id: m.id, name: m.name })),
      activeModelId: c.activeModelId,
    }))
  }, [])
```

- [ ] **Step 2: 替换 enabledModels / activeModel / modelName / selectModel**

把原来的：
```tsx
  const enabledModels = state.settings.models.filter(m => m.enabled)
  const activeModel = state.settings.models.find(m => m.id === state.settings.model)
  const modelName = activeModel?.name ?? t('input.model')
  const selectModel = (id: string) => {
    dispatch({ type: 'SET_SETTINGS', settings: { model: id } })
    window.api?.settings.save({ model: id })
    setOpenMenu(null)
  }
```

替换为：
```tsx
  const enabledModels = modelCfg?.models ?? []
  const activeModel = enabledModels.find(m => m.id === (modelCfg?.activeModelId ?? ''))
  const modelName = activeModel?.name ?? t('input.model')
  const selectModel = (id: string) => {
    setModelCfg(prev => prev ? { ...prev, activeModelId: id } : prev)
    window.api?.ccDesk.model.save({ activeModelId: id })
    setOpenMenu(null)
  }
```

- [ ] **Step 3: 修正下拉选中态判断**

模型下拉菜单里（`openMenu === 'model'` 块）的 `m.id === state.settings.model` 改为 `m.id === (modelCfg?.activeModelId ?? '')`（两处：背景高亮和 Check 显示）。

- [ ] **Step 4: 类型检查 + 构建**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build 2>&1 | tail -3`
Expected: 无类型错误，三段 build 成功

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/InputBar.tsx
git commit -m "feat(model): InputBar 模型下拉改从 cc-desk 多供应商配置取"
```

---

## Task 8: 全量测试 + 端到端手测

**Files:** 无（验证任务）

- [ ] **Step 1: 运行全部单测**

Run: `npm test`
Expected: 全部通过（含 cc-desk-store 新增用例，原有 reducer/seq-utils 等 66+ 用例不回归）

- [ ] **Step 2: 类型检查 + 构建全过**

Run: `npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: 无类型错误，三段构建成功

- [ ] **Step 3: 端到端手测（npm run dev）**

启动应用，验证：
1. 打开「设置 → 模型设置」→ 看到空白多供应商界面（左栏空，右栏提示「选择左侧供应商，或点添加供应商」）。
2. 点「+ 添加供应商」→ 出现「新供应商」，编辑名字为 `ai-proxy`，填 Base URL `http://127.0.0.1:17860`、API Key `sk-coding`。
3. 点「+ 添加模型」→ 出现「新模型」，点编辑图标，name=`glm-5.2`、sdkModelId=`glm-5.2`。
4. 关闭设置回到工作区 → InputBar 模型下拉显示 `glm-5.2`，选中它。
5. Cmd+R 刷新 → 重新进设置，供应商和模型仍在（持久化生效）。
6. 检查 `~/.cc-desk/config.json` 存在且含上述配置；检查 `~/.claude/settings.json` 的 mtime 未变（未写 ~/.claude/）。
7. 发送一条消息 → 观察：ClaudeService 用 ai-proxy 的 key/url + glm-5.2 调 SDK（复用上次 verify 的 CDP 追踪方法：监听 claude:system 事件，确认返回 model=glm-5.2、sessionId 正常；若代理层正常则收到回复）。

- [ ] **Step 4: 提交（如有手测中发现的小修）**

```bash
git add -A
git commit -m "test(model): 全量测试通过 + 端到端手测验证"
```

---

## Self-Review

**1. Spec 覆盖**：✅ 数据结构(cc-desk-store, Task1) / IPC+preload+类型(Task2) / buildSdkEnv(Task3) / ClaudeService 接通(Task4) / i18n(Task5) / ModelSettings UI(Task6) / InputBar(Task7) / 验证(Task8)。modelRoleMap 的 UI 编辑入口 spec 未要求（边界内推迟），ClaudeService 用 buildSdkEnv 读 roleMap 已覆盖运行时。首次空白(Task1 EMPTY)、不迁移、不写 ~/.claude（Task4 只读 getGeneralConfig）均覆盖。

**2. Placeholder 扫描**：无 TBD/TODO；每个 code step 都有完整代码；Task3 Step4 主动指出测试需加第三参数并给出修正——已闭环。

**3. 类型一致性**：`ModelProvider`（id/name/apiKey/baseUrl/enabled，无 apiFormat）与 `ModelItem`（含 sdkModelId）在 Task1/2/6/7 全程一致；`resolveActiveProviderModel` / `buildSdkEnv` / `getModelProvidersConfig` / `saveModelProvidersConfig` 签名跨 task 一致；IPC 通道名 `cc-desk:model:get/save` 在 main/preload/global.d.ts/ModelSettings/InputBar 全部一致。
