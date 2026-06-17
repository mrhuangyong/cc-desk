# 还原模型多供应商设置（界面 + 接通真实调用）

## Context（背景）

cc-desk 的「模型设置」页经过多次重写：

- HEAD（已提交）版是**多供应商管理界面**（左栏供应商列表 + 右栏详情/模型列表），但数据来自 `mockData.ts`，**不持久化**，刷新即丢。
- 中间某版把多供应商改成了**真正持久化到 electron-store**，用户真实配置了 `aiproxy` + `local` 两个供应商（数据仍躺在 `~/Library/Application Support/cc-desk/config.json`）。
- 当前工作区（未提交重构）把多供应商 UI **整个删除**（`ModelSettings.tsx` −252 行），替换成读写 `~/.claude/settings.json` 的**单一配置页**（一个 API Key + Base URL + 三模型映射）。

用户诉求：**还原多供应商设置界面，并接通真实调用**——配置的供应商/模型要让 ClaudeService 发消息时真正生效。同时确立架构方向：**应用自成一套配置体系，数据存 `~/.cc-desk/`，不写 `~/.claude/`**。

本 spec **只做模型多供应商这一件事**，不涉及其他设置页（General/MCP/Hooks/Skills 等）的迁移——那些留待后续。

## 已确认决策

1. 还原 HEAD 版多供应商 UI 布局，但改成持久化（读写 `~/.cc-desk/config.json`）。
2. 接通真实调用：ClaudeService 从多供应商配置取数注入 SDK。
3. 数据存 `~/.cc-desk/config.json`，**不写 `~/.claude/`**。
4. **首次启动不迁移**现有数据（electron-store 的 aiproxy+local、`~/.claude/settings.json` 的 sk-coding 都不读入），多供应商列表**完全空白**，用户手动添加。
5. 去掉 HEAD 版的 `apiFormat` 字段（Claude Agent SDK 只走 Anthropic Messages 协议，该字段无实际作用）。
6. 保留磁盘数据里出现过的 `sdkModelId` 字段（传给 SDK 的真实模型名）。

## 数据结构

新建 `src/main/cc-desk-store.ts`，用 electron-store，cwd 固定 `~/.cc-desk/`（生成 `~/.cc-desk/config.json`）。配置结构（本阶段只含模型供应商）：

```ts
interface ModelProvidersConfig {
  providers: ModelProvider[]
  models: ModelItem[]
  modelRoleMap: Record<string, string>  // `${providerId}:opus|sonnet|haiku` → modelId
  activeModelId: string                 // InputBar 下拉选中的模型 id；空表示未选
}

interface ModelProvider {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  enabled: boolean
}

interface ModelItem {
  id: string
  name: string
  providerId: string
  sdkModelId: string   // 传给 SDK query() options.model 的真实模型名
  contextLength: string
  enabled: boolean
}
```

**初始值**：`{ providers: [], models: [], modelRoleMap: {}, activeModelId: '' }`（完全空白）。

**API**：
- `getModelProvidersConfig(): ModelProvidersConfig` — 读 `~/.cc-desk/config.json`，无文件返回初始空值。
- `saveModelProvidersConfig(patch: Partial<ModelProvidersConfig>): void` — 读当前值 → 浅合并 patch → 写回。

## 界面（ModelSettings.tsx 还原 + 持久化）

复刻 HEAD 版布局，关键改动：

- **数据源**：从 `useState(() => mockData)` 改为挂载时 `window.api.ccDesk.model.get()` 加载、每次增删改立即 `window.api.ccDesk.model.save(patch)` 持久化。
- **去掉 apiFormat 下拉**（连同 `API_FORMATS` 常量）。
- **模型项编辑**：HEAD 版「编辑」按钮是空壳，本次做成可编辑 `name` / `sdkModelId` / `contextLength`（行内编辑或弹小表单）。新增模型时 `sdkModelId` 默认等于 `name`。
- 左栏：供应商列表（选中高亮 ● / ○）、「+ 添加供应商」、删除（二次确认）。
- 右栏：供应商 name（点编辑改名）、enabled 切换、Base URL、API Key（眼睛显隐）、模型列表（每行 name / sdkModelId / contextLength / 启用 / 删除）、「+ 添加模型」。

i18n：复用现有 `useI18n` 模式（当前工作区其他设置页已用），补 `model.*` key。

## IPC 与 Preload

`src/main/index.ts` 注册：
- `cc-desk:model:get` → `getModelProvidersConfig()`
- `cc-desk:model:save` → `saveModelProvidersConfig(patch)`

`src/preload/index.ts` 暴露：
```ts
ccDesk: {
  model: {
    get: () => ipcRenderer.invoke('cc-desk:model:get'),
    save: (patch: any) => ipcRenderer.invoke('cc-desk:model:save', patch),
  }
}
```
`src/renderer/global.d.ts` 补对应类型声明。

## ClaudeService 接通（让多供应商真正生效）

`src/main/claude-service.ts` 的 `send()` 改造：

1. 从 `getModelProvidersConfig()` 取配置（**不再调用** `getModelConfig()` 读 `~/.claude/settings.json`）。
2. 若 `providers` 为空或无 enabled provider → `webContents.send('claude:error', { error: '请先在「设置 → 模型设置」中添加并启用供应商' })`，return。
3. 解析 `activeModelId` → 找到所属 provider（若 activeModelId 空，回退第一个 enabled provider 的第一个 enabled 模型）。
4. 注入 SDK `options.env`：
   - `ANTHROPIC_API_KEY` = provider.apiKey
   - `ANTHROPIC_BASE_URL` = provider.baseUrl（若有）
   - `ANTHROPIC_AUTH_TOKEN`（保留兼容，暂从 provider 不取，置空）
   - `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_MODEL` / `_HAIKU_MODEL`：按 `modelRoleMap[`${providerId}:opus|sonnet|haiku`]` 取对应 modelId 的 `sdkModelId`；该 role 无条目时回退到选中模型的 `sdkModelId`。
   - `options.model` = 选中模型（activeModelId）的 `sdkModelId`
5. `proxy` 仍从 `getGeneralConfig()`（`~/.claude/settings.json`，只读）取——本阶段不动常规设置；后续常规设置迁移时再改。

**已验证约束**：SDK `query()` 的 `options.env` 会覆盖子进程默认 env（当前代码已用此机制），baseUrl 只能走 env。多供应商切换 = 切换注入的 env，技术上直接成立。

## InputBar 模型下拉改造

当前 `InputBar.tsx:92-99` 从 `state.settings.models`（已无 UI 维护的幽灵数据）取 enabled 模型，选中存 `state.settings.model` 并 `window.api.settings.save({model:id})`。

改为：
- 模型列表来自多供应商配置里的 enabled 模型（经一个新的 state 字段或直接从 `ccDesk.model.get()` 加载）。
- 选中模型 → `window.api.ccDesk.model.save({ activeModelId: id })`。
- 显示模型名（可附所属供应商名）。

为避免大改 reducer，模型列表可作为 ModelSettings/InputBar 各自的本地 state（挂载时从 IPC 加载），或新增一个轻量 reducer 字段 `modelProvidersConfig`（启动时 HYDRATE 风格注入）。**推荐本地 state 方案**——模型配置低频，不必进全局 reducer；InputBar 与 ModelSettings 各自从 IPC 取最新值即可（InputBar 在选中时直接 save，下次发送前 ClaudeService 读最新磁盘值，不依赖内存一致性）。

## 不做的事（边界）

- ❌ 不迁移现有数据（aiproxy+local / sk-coding 都不读入）。
- ❌ 不动 GeneralSettings / CodePreviewSettings / MCP / Hooks / Plugins / Skills / Commands 设置页。
- ❌ 不删 `~/.claude/settings.json`（ClaudeService 仍只读其 proxy；其他设置页维持现状）。
- ❌ 不清理 electron-store 里残留的 providers/models 幽灵数据（避免误伤，留待整体迁移）。

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/main/cc-desk-store.ts` | **新建**：electron-store cwd=`~/.cc-desk/`，`ModelProvidersConfig` + get/save |
| `src/main/index.ts` | 注册 `cc-desk:model:get` / `cc-desk:model:save` |
| `src/preload/index.ts` | 暴露 `window.api.ccDesk.model.{get,save}` |
| `src/renderer/global.d.ts` | 补 ccDesk 类型声明 + ModelProvider/ModelItem 类型 |
| `src/renderer/types.ts` | 补 ModelProvider（去 apiFormat）/ ModelItem（加 sdkModelId）类型 |
| `src/renderer/components/settings/ModelSettings.tsx` | **重写**：还原多供应商 UI + 持久化读写 ccDesk.model |
| `src/main/claude-service.ts` | `send()` 改从 `getModelProvidersConfig()` 取数注入 env |
| `src/renderer/components/InputBar.tsx` | 模型下拉改从多供应商配置取、选中存 activeModelId |
| `src/renderer/i18n/*` | 补 `model.*` 翻译 key |

## 验证

1. **单元测试**（`tests/cc-desk-store.test.ts` 新建）：
   - `getModelProvidersConfig` 无文件返回空初始值。
   - `saveModelProvidersConfig` 浅合并写回（存 providers → 再 get 能读到）。
   - 现有 `tests/` 全部通过。
2. **端到端手测**（`npm run dev`）：
   - 打开「设置 → 模型设置」→ 看到空白多供应商界面（左栏空 + 提示）。
   - 「+ 添加供应商」→ 填 name=ai-proxy、baseUrl=http://127.0.0.1:17860、apiKey=sk-coding → 「+ 添加模型」name=glm-5.2 sdkModelId=glm-5.2 → 刷新页面，配置仍在。
   - InputBar 模型下拉显示 glm-5.2，选中它。
   - 发送消息 → ClaudeService 用 ai-proxy 供应商的 key/url + glm-5.2 调 SDK（可通过主进程日志或回复是否到来验证 env 注入正确）。
   - 再加一个供应商 local（不同 baseUrl/key），切换 activeModelId → 发消息验证用的是新供应商配置。
3. **不写 ~/.claude/ 验证**：配置过程中检查 `~/.claude/settings.json` 的 mtime 未变。
