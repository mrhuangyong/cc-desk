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
