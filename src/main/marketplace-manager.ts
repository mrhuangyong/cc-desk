// src/main/marketplace-manager.ts
// 插件仓库（marketplace）管理：添加/删除/刷新/列表/搜索。
// 全部操作 ~/.cc-desk/claude/plugins/（CLAUDE_CONFIG_DIR），不触碰 ~/.claude。
// SDK 通过 CLAUDE_CONFIG_DIR 自动发现 settings.json + installed_plugins.json 加载插件。

import { readFile, writeFile, stat, mkdir, rm, cp } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { CLAUDE_CONFIG_DIR } from './paths'
import { readJson, writeJson } from './json-utils'

const execFileAsync = promisify(execFile)

const CLAUDE_DIR = CLAUDE_CONFIG_DIR
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins')
const MARKETPLACES_DIR = join(PLUGINS_DIR, 'marketplaces')
const KNOWN_MARKETPLACES_PATH = join(PLUGINS_DIR, 'known_marketplaces.json')

const GIT_TIMEOUT_MS = 120000

// ---- 类型定义 ----

export type MarketplaceSource =
  | { source: 'github'; repo: string; ref?: string }
  | { source: 'git'; url: string; ref?: string }
  | { source: 'url'; url: string; headers?: Record<string, string> }
  | { source: 'file'; path: string }
  | { source: 'directory'; path: string }

export interface KnownMarketplace {
  name: string               // marketplace 名（known_marketplaces.json 的 key）
  source: MarketplaceSource
  installLocation: string
  lastUpdated: string
  autoUpdate?: boolean
}

export interface PluginMarketplaceEntry {
  name: string
  description?: string
  version?: string
  source: string | object
  category?: string
  tags?: string[]
}

export interface PluginMarketplace {
  name: string
  owner?: { name: string; email?: string; url?: string }
  plugins: PluginMarketplaceEntry[]
}

export interface SearchResult {
  pluginName: string
  marketplace: string
  version: string
  description: string
  category?: string
  tags?: string[]
  installed: boolean
}

// ---- 工具函数 ----

// readJson/writeJson 见 ./json-utils（与 claude-config 共享）。

// ---- parseSource：智能识别输入字符串的仓库来源类型 ----

export function parseSource(input: string): MarketplaceSource {
  const trimmed = input.trim()

  // git@ SSH：git@github.com:owner/repo → github
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (sshMatch) return { source: 'github', repo: sshMatch[1] }

  // git@ SSH 非 github → git
  if (trimmed.startsWith('git@')) return { source: 'git', url: trimmed }

  // https://github.com/owner/repo → github
  const ghHttpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/)
  if (ghHttpsMatch) return { source: 'github', repo: ghHttpsMatch[1] }

  // 其他 .git 结尾 URL → git
  if (/^https?:\/\//.test(trimmed) && trimmed.endsWith('.git')) {
    return { source: 'git', url: trimmed }
  }

  // http(s):// 非 .git → url（直链 marketplace.json）
  if (/^https?:\/\//.test(trimmed)) return { source: 'url', url: trimmed }

  // 绝对路径（/ 开头 Unix，或盘符开头 Windows，~ 开头）→ 本地路径占位
  // addMarketplace 内会用 stat 校正为 file/directory。
  // .json 结尾的路径先猜 file（绝大多数 marketplace.json 场景）。
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('~')) {
    if (trimmed.endsWith('.json')) return { source: 'file', path: trimmed }
    return { source: 'directory', path: trimmed }
  }

  // owner/repo 简写（含 / 无 :// 无空格，非绝对路径）→ github
  if (trimmed.includes('/') && !trimmed.includes('://') && !/\s/.test(trimmed)) {
    return { source: 'github', repo: trimmed }
  }

  // 其他本地路径（相对路径），返回 directory 占位
  return { source: 'directory', path: trimmed }
}

// ---- addMarketplace + getMarketplaces ----

// 校正本地路径 source（parseSource 返回 directory/file 占位，这里 stat 后精确化）
async function resolveLocalSource(input: string): Promise<MarketplaceSource> {
  const abs = isAbsolute(input) ? input : resolve(input)
  const s = await stat(abs)
  if (s.isFile()) return { source: 'file', path: abs }
  return { source: 'directory', path: abs }
}

// 读 marketplace.json 文件内容并校验基本结构
async function readMarketplaceFile(path: string): Promise<PluginMarketplace> {
  const raw = await readFile(path, 'utf-8')
  const data = JSON.parse(raw)
  if (!data.name || typeof data.name !== 'string') throw new Error('marketplace.json 缺少 name 字段')
  if (!Array.isArray(data.plugins)) throw new Error('marketplace.json 缺少 plugins 数组')
  return data as PluginMarketplace
}

// 从 directory source 读取 marketplace.json（<dir>/.claude-plugin/marketplace.json 或 <dir>/marketplace.json）
async function readMarketplaceFromDir(dir: string): Promise<PluginMarketplace> {
  const nested = join(dir, '.claude-plugin', 'marketplace.json')
  if (existsSync(nested)) return readMarketplaceFile(nested)
  return readMarketplaceFile(join(dir, 'marketplace.json'))
}

export async function getMarketplaces(): Promise<KnownMarketplace[]> {
  const config = await readJson<Record<string, Omit<KnownMarketplace, 'name'>>>(KNOWN_MARKETPLACES_PATH, {})
  return Object.entries(config).map(([name, entry]) => ({ ...entry, name }))
}

// 读 known_marketplaces.json 的单个条目（含 name key）
async function readKnownConfig(): Promise<Record<string, Omit<KnownMarketplace, 'name'>>> {
  return readJson<Record<string, Omit<KnownMarketplace, 'name'>>>(KNOWN_MARKETPLACES_PATH, {})
}

async function saveKnownConfig(config: Record<string, Omit<KnownMarketplace, 'name'>>): Promise<void> {
  await writeJson(KNOWN_MARKETPLACES_PATH, config)
}

export async function addMarketplace(
  input: string,
  options?: { type?: string; ref?: string; autoUpdate?: boolean },
): Promise<{ name: string; alreadyExists: boolean }> {
  // 高级区显式 type 时覆盖自动识别
  let source: MarketplaceSource
  if (options?.type) {
    source = options.type === 'github' ? { source: 'github', repo: input, ref: options.ref }
      : options.type === 'git' ? { source: 'git', url: input, ref: options.ref }
      : options.type === 'url' ? { source: 'url', url: input }
      : options.type === 'file' ? { source: 'file', path: isAbsolute(input) ? input : resolve(input) }
      : { source: 'directory', path: isAbsolute(input) ? input : resolve(input) }
  } else {
    const parsed = parseSource(input)
    // 本地路径占位校正（directory/file 占位 → stat 精确化）
    if (parsed.source === 'directory' || parsed.source === 'file') {
      try { source = await resolveLocalSource(input) }
      catch { source = parsed } // stat 失败仍用原值，后续加载会报错
    } else {
      source = parsed
    }
    if (options?.ref && (source.source === 'github' || source.source === 'git')) {
      (source as any).ref = options.ref
    }
  }

  const config = await readKnownConfig()

  // source 幂等：完全相同的 source 已存在则跳过
  for (const [name, entry] of Object.entries(config)) {
    if (JSON.stringify(entry.source) === JSON.stringify(source)) {
      return { name, alreadyExists: true }
    }
  }

  // 克隆/下载/读取到 marketplaces 缓存
  const { marketplace, cachePath } = await loadAndCacheMarketplace(source)
  const name = marketplace.name

  config[name] = {
    source,
    installLocation: cachePath,
    lastUpdated: new Date().toISOString(),
    autoUpdate: options?.autoUpdate ?? true,
  }
  await saveKnownConfig(config)
  return { name, alreadyExists: false }
}

// 读缓存里的 marketplace.json
async function readCachedMarketplace(installLocation: string, source: MarketplaceSource): Promise<PluginMarketplace> {
  if (source.source === 'file') return readMarketplaceFile(installLocation)
  if (source.source === 'directory') return readMarketplaceFromDir(installLocation)
  // github/git/url 缓存的是目录或 json 文件
  const nested = join(installLocation, '.claude-plugin', 'marketplace.json')
  if (existsSync(nested)) return readMarketplaceFile(nested)
  if (installLocation.endsWith('.json')) return readMarketplaceFile(installLocation)
  return readMarketplaceFromDir(installLocation)
}

// 下载/克隆/拷贝 marketplace 到 marketplaces 缓存目录
async function loadAndCacheMarketplace(source: MarketplaceSource): Promise<{ marketplace: PluginMarketplace; cachePath: string }> {
  await mkdir(MARKETPLACES_DIR, { recursive: true })

  if (source.source === 'file') {
    const dest = join(MARKETPLACES_DIR, source.path.split('/').pop() || 'marketplace.json')
    await cp(source.path, dest)
    const marketplace = await readMarketplaceFile(dest)
    const finalDest = join(MARKETPLACES_DIR, `${marketplace.name}.json`)
    if (dest !== finalDest) {
      await cp(dest, finalDest, { force: true })
      await rm(dest, { force: true }).catch(() => {})
    }
    return { marketplace, cachePath: finalDest }
  }

  if (source.source === 'directory') {
    // 直接从原目录读，installLocation 指向原路径（保持实时性）
    const marketplace = await readMarketplaceFromDir(source.path)
    return { marketplace, cachePath: source.path }
  }

  if (source.source === 'url') {
    const response = await fetch(source.url, { headers: source.headers })
    if (!response.ok) throw new Error(`下载失败: ${response.status} ${response.statusText}`)
    const text = await response.text()
    const data = JSON.parse(text)
    if (!data.name) throw new Error('marketplace.json 缺少 name 字段')
    const dest = join(MARKETPLACES_DIR, `${data.name}.json`)
    await writeJson(dest, data)
    return { marketplace: data, cachePath: dest }
  }

  if (source.source === 'github' || source.source === 'git') {
    const repoName = source.source === 'github'
      ? source.repo.split('/').pop()!.replace(/\.git$/, '')
      : source.url.split('/').pop()!.replace(/\.git$/, '')
    const cloneUrl = source.source === 'github'
      ? `https://github.com/${source.repo}.git`
      : source.url
    const dest = join(MARKETPLACES_DIR, repoName)
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    await gitClone(cloneUrl, dest, source.ref)
    const marketplace = await readMarketplaceFromDir(dest)
    return { marketplace, cachePath: dest }
  }

  throw new Error('不支持的 source 类型')
}

async function gitClone(url: string, dest: string, ref?: string): Promise<void> {
  const args = ref
    ? ['clone', '--depth', '1', '--branch', ref, url, dest]
    : ['clone', '--depth', '1', url, dest]
  await execFileAsync('git', args, { timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

// settings.json 路径（级联清理 enabledPlugins 用）
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')

export async function removeMarketplace(name: string): Promise<{ cascadedPlugins: string[] }> {
  const config = await readKnownConfig()
  if (!config[name]) throw new Error(`仓库「${name}」不存在`)

  delete config[name]
  await saveKnownConfig(config)

  // 清理 marketplaces 缓存（目录和 .json 文件都删）
  await rm(join(MARKETPLACES_DIR, name), { recursive: true, force: true }).catch(() => {})
  await rm(join(MARKETPLACES_DIR, `${name}.json`), { force: true }).catch(() => {})

  // 级联：移除 settings.json enabledPlugins 里 @name 后缀的条目
  const cascadedPlugins: string[] = []
  const settings = await readJson<Record<string, any>>(SETTINGS_PATH, {})
  if (settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
    const ep = { ...settings.enabledPlugins }
    const suffix = `@${name}`
    for (const key of Object.keys(ep)) {
      if (key.endsWith(suffix)) {
        cascadedPlugins.push(key.split('@')[0])
        delete ep[key]
      }
    }
    settings.enabledPlugins = ep
    await writeJson(SETTINGS_PATH, settings)
  }

  // 级联：移除 installed_plugins.json 里 @name 后缀的条目
  const { readInstalledPlugins, writeInstalledPlugins } = await import('./claude-config')
  const installed = await readInstalledPlugins()
  const suffix = `@${name}`
  let installedChanged = false
  for (const key of Object.keys(installed.plugins)) {
    if (key.endsWith(suffix)) {
      delete installed.plugins[key]
      installedChanged = true
    }
  }
  if (installedChanged) await writeInstalledPlugins(installed)

  return { cascadedPlugins }
}

export async function refreshMarketplace(name: string): Promise<void> {
  const config = await readKnownConfig()
  const entry = config[name]
  if (!entry) throw new Error(`仓库「${name}」不存在`)

  const source = entry.source

  if (source.source === 'url') {
    const response = await fetch(source.url, { headers: source.headers })
    if (!response.ok) throw new Error(`下载失败: ${response.status}`)
    const data = JSON.parse(await response.text())
    await writeJson(entry.installLocation, data)
  } else if (source.source === 'github' || source.source === 'git') {
    // 目录不存在或 .git 丢失时回退为重新 clone
    try {
      await gitPull(entry.installLocation, source.ref)
    } catch {
      const repoName = source.source === 'github'
        ? source.repo.split('/').pop()!.replace(/\.git$/, '')
        : source.url.split('/').pop()!.replace(/\.git$/, '')
      const cloneUrl = source.source === 'github'
        ? `https://github.com/${source.repo}.git`
        : source.url
      await rm(entry.installLocation, { recursive: true, force: true }).catch(() => {})
      await gitClone(cloneUrl, entry.installLocation, source.ref)
    }
  } else if (source.source === 'file') {
    const data = JSON.parse(await readFile(source.path, 'utf-8'))
    await writeJson(entry.installLocation, data)
  } else if (source.source === 'directory') {
    await readMarketplaceFromDir(source.path)
  }

  config[name].lastUpdated = new Date().toISOString()
  await saveKnownConfig(config)
}

async function gitPull(cwd: string, ref?: string): Promise<void> {
  const args = ref ? ['fetch', 'origin', ref] : ['pull', '--ff-only']
  await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (ref) {
    await execFileAsync('git', ['checkout', ref], { cwd, timeout: GIT_TIMEOUT_MS })
  }
}

export async function refreshAllMarketplaces(): Promise<void> {
  const config = await readKnownConfig()
  for (const name of Object.keys(config)) {
    try { await refreshMarketplace(name) }
    catch (e) { console.error(`刷新仓库 ${name} 失败:`, e) }
  }
}

export async function setMarketplaceAutoUpdate(name: string, enabled: boolean): Promise<void> {
  const config = await readKnownConfig()
  if (!config[name]) throw new Error(`仓库「${name}」不存在`)
  config[name].autoUpdate = enabled
  await saveKnownConfig(config)
}

// 启动时自动刷新标记了 autoUpdate 的仓库（异步，不阻塞应用启动）
export async function refreshAutoUpdateMarketplaces(): Promise<void> {
  const config = await readKnownConfig()
  for (const name of Object.keys(config)) {
    if (config[name].autoUpdate) {
      refreshMarketplace(name).catch(e => console.error(`自动刷新 ${name} 失败:`, e))
    }
  }
}

// ---- getMarketplacePlugins + searchMarketplacePlugins ----

export async function getMarketplacePlugins(name: string): Promise<PluginMarketplaceEntry[]> {
  const config = await readKnownConfig()
  const entry = config[name]
  if (!entry) throw new Error(`仓库「${name}」不存在`)
  const marketplace = await readCachedMarketplace(entry.installLocation, entry.source)
  return marketplace.plugins || []
}

export async function searchMarketplacePlugins(query: string): Promise<SearchResult[]> {
  const q = query.toLowerCase().trim()
  if (!q) return []
  const config = await readKnownConfig()
  const results: SearchResult[] = []

  // 查已安装状态
  const { readInstalledPlugins } = await import('./claude-config')
  const installed = await readInstalledPlugins()
  const installedIds = new Set(Object.keys(installed.plugins))

  for (const [mktName, entry] of Object.entries(config)) {
    let marketplace: PluginMarketplace
    try { marketplace = await readCachedMarketplace(entry.installLocation, entry.source) }
    catch { continue }

    for (const plugin of marketplace.plugins || []) {
      const nameMatch = plugin.name.toLowerCase().includes(q)
      const descMatch = (plugin.description || '').toLowerCase().includes(q)
      const catMatch = (plugin.category || '').toLowerCase().includes(q)
      const tagMatch = (plugin.tags || []).some(t => t.toLowerCase().includes(q))
      if (nameMatch || descMatch || catMatch || tagMatch) {
        const pluginId = `${plugin.name}@${mktName}`
        results.push({
          pluginName: plugin.name,
          marketplace: mktName,
          version: plugin.version || 'unknown',
          description: plugin.description || '',
          category: plugin.category,
          tags: plugin.tags,
          installed: installedIds.has(pluginId),
        })
      }
    }
  }
  return results
}
