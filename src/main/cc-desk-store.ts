// src/main/cc-desk-store.ts
// cc-desk 自有的配置存储。模型供应商配置写入 ~/.cc-desk/config.json，
// 不读写 ~/.claude/。ClaudeService 从这里取数注入 SDK。
import Store from 'electron-store'
import { CC_DESK_DIR } from './paths'

export interface ModelProvider {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  enabled: boolean
}
export interface ModelItem {
  id: string
  providerId: string
  sdkModelId: string   // 模型 ID，传给 SDK query() options.model 的真实模型名，也用作展示名
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

function createStore(): Store<{ config: ModelProvidersConfig }> {
  return new Store<{ config: ModelProvidersConfig }>({
    name: 'config',
    cwd: CC_DESK_DIR,
    defaults: { config: EMPTY },
  })
}

const store = createStore()

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
  const activeModel = cfg.models.find(m => m.id === cfg.activeModelId && m.enabled)
  if (activeModel) {
    const prov = enabledProviders.find(p => p.id === activeModel.providerId)
    if (prov) return { provider: prov, model: activeModel }
  }
  for (const prov of enabledProviders) {
    const m = cfg.models.find(mm => mm.providerId === prov.id && mm.enabled)
    if (m) return { provider: prov, model: m }
  }
  return null
}

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
  // 关闭 Claude Agent SDK 的归因 header 注入（CLAUDE_CODE_ATTRIBUTION_HEADER）。
  // SDK 原生二进制会在每次请求的 system prompt 顶部注入
  //   x-anthropic-billing-header: cc_version=...; cc_entrypoint=...; cch=<每轮变化的哈希>;
  // 直连 Anthropic 时后端会剥离它；但走第三方代理（ANTHROPIC_BASE_URL 指向 new-api 等）时，
  // 代理不认识这段 header，作为普通文本透传给下游模型，cch 每轮变化导致 system prompt 前缀
  // 每轮不同 → KV Cache 完全失效。设为 "0" 让 SDK 跳过注入（见 native 二进制 f16 判定）。
  env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
  return env
}
