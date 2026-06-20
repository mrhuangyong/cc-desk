# 插件管理功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整还原 Claude 的插件管理——仓库(marketplace)管理（添加/删除/刷新/搜索）+ 通过仓库安装/卸载插件 + 双 Tab UI。

**Architecture:** cc-desk 维护 `~/.cc-desk/claude/plugins/` 下的三个磁盘文件（known_marketplaces.json / installed_plugins.json / settings.json），SDK 通过 `CLAUDE_CONFIG_DIR` 自动发现并加载。后端新建 `marketplace-manager.ts`（仓库管理）+ 扩展 `claude-config.ts`（安装/卸载）；前端重构 `PluginSettings.tsx` 为双 Tab + 新增两个弹窗组件。

**Tech Stack:** TypeScript, Electron (IPC/preload), React + 内联样式, vitest (隔离 CLAUDE_CONFIG_DIR)

---

## 文件结构

**新建：**
- `src/main/marketplace-manager.ts` — 仓库管理核心逻辑（parseSource / add / remove / refresh / list / search / setAutoUpdate）
- `src/renderer/components/settings/AddMarketplaceDialog.tsx` — 添加仓库弹窗（智能输入框 + 高级选项）
- `src/renderer/components/settings/PluginDetailDialog.tsx` — 插件详情弹窗（结构化展示 + 安装按钮）
- `tests/marketplace-manager.test.ts` — 仓库管理测试（隔离目录）
- `tests/plugin-install.test.ts` — 插件安装/卸载测试（隔离目录）

**修改：**
- `src/main/claude-config.ts` — 新增 `installPlugin` / `uninstallPlugin`；导出路径常量
- `src/main/index.ts` — 注册新 IPC handler（marketplace + plugin install/uninstall）
- `src/preload/index.ts` — 新增 `cc.marketplaces.*` + `cc.plugins.install/uninstall`
- `src/renderer/global.d.ts` — 新增类型声明
- `src/renderer/components/settings/PluginSettings.tsx` — 重构为双 Tab + 仓库管理 UI

---

## Task 1: marketplace-manager 类型定义 + parseSource

**Files:**
- Create: `src/main/marketplace-manager.ts`
- Test: `tests/marketplace-manager.test.ts`

- [ ] **Step 1: 写 parseSource 失败测试**

```typescript
// tests/marketplace-manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'

const TMP_DIR = join(tmpdir(), `mkt-${Math.random().toString(36).slice(2)}-${Date.now()}`)
let origDir: string | undefined

beforeEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true })
  await mkdir(TMP_DIR, { recursive: true })
  origDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = TMP_DIR
  vi.resetModules()
})
afterEach(async () => {
  if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = origDir
  vi.resetModules()
  await rm(TMP_DIR, { recursive: true, force: true })
})

describe('parseSource 智能识别', () => {
  it('github owner/repo 简写', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('anthropics/claude-plugins')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('github 完整 HTTPS URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://github.com/anthropics/claude-plugins')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('github SSH URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('git@github.com:anthropics/claude-plugins.git')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('git 非 github URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://gitlab.com/team/plugins.git')
    expect(s.source).toBe('git')
    expect((s as any).url).toBe('https://gitlab.com/team/plugins.git')
  })
  it('url 直链 json', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://example.com/marketplace.json')
    expect(s.source).toBe('url')
    expect((s as any).url).toBe('https://example.com/marketplace.json')
  })
  it('file 本地 json 路径', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    await writeFile(join(TMP_DIR, 'm.json'), '{}')
    const s = parseSource(join(TMP_DIR, 'm.json'))
    expect(s.source).toBe('file')
  })
  it('directory 本地目录路径', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    await mkdir(join(TMP_DIR, 'mydir'), { recursive: true })
    const s = parseSource(join(TMP_DIR, 'mydir'))
    expect(s.source).toBe('directory')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: FAIL — 模块不存在 / parseSource 未定义

- [ ] **Step 3: 实现类型 + parseSource**

```typescript
// src/main/marketplace-manager.ts
// 插件仓库（marketplace）管理：添加/删除/刷新/列表/搜索。
// 全部操作 ~/.cc-desk/claude/plugins/（CLAUDE_CONFIG_DIR），不触碰 ~/.claude。
// SDK 通过 CLAUDE_CONFIG_DIR 自动发现 settings.json + installed_plugins.json 加载插件。

import { readFile, writeFile, readdir, stat, mkdir, rm, cp } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { CLAUDE_CONFIG_DIR } from './paths'

const execFileAsync = promisify(execFile)

const CLAUDE_DIR = CLAUDE_CONFIG_DIR
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins')
const MARKETPLACES_DIR = join(PLUGINS_DIR, 'marketplaces')
const KNOWN_MARKETPLACES_PATH = join(PLUGINS_DIR, 'known_marketplaces.json')

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

async function readJson<T = any>(path: string, fallback: T): Promise<T> {
  try {
    if (!existsSync(path)) return fallback
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch { return fallback }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

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

  // owner/repo 简写（含 / 无 :// 无空格）→ github
  if (trimmed.includes('/') && !trimmed.includes('://') && !/\s/.test(trimmed)) {
    return { source: 'github', repo: trimmed }
  }

  // 本地路径：交给调用方判断 file vs directory（需 stat）
  // parseSource 是同步函数，无法 await stat，故返回未决类型由 addMarketplace 二次判断。
  // 这里先返回 directory 作为占位，addMarketplace 内会用 stat 校正。
  return { source: 'directory', path: trimmed }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: PASS — 7 个 parseSource 测试全通过

- [ ] **Step 5: 提交**

```bash
git add src/main/marketplace-manager.ts tests/marketplace-manager.test.ts
git commit -m "feat(marketplace): parseSource 智能识别五种仓库来源类型"
```


---

## Task 2: addMarketplace + getMarketplaces

**Files:**
- Modify: `src/main/marketplace-manager.ts`
- Test: `tests/marketplace-manager.test.ts`

- [ ] **Step 1: 写 addMarketplace 失败测试**

追加到 `tests/marketplace-manager.test.ts` 末尾（`afterEach` 之前）：

```typescript
// 构造一个合法的 marketplace.json 用于 url/file 测试
async function makeTmpMarketplace(): Promise<string> {
  const mp = join(TMP_DIR, 'fake-marketplace.json')
  await writeFile(mp, JSON.stringify({
    name: 'test-market',
    owner: { name: 'tester' },
    plugins: [
      { name: 'plugin-a', description: 'A plugin', source: './plugin-a', version: '1.0.0' },
    ],
  }))
  return mp
}

describe('addMarketplace + getMarketplaces', () => {
  it('url 类型添加成功并写入 known_marketplaces.json', async () => {
    const { addMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    // 用 file:// 协议模拟 url 下载（可离线测试）
    const mpPath = await makeTmpMarketplace()
    const fileUrl = `file://${mpPath}`
    const result = await addMarketplace(fileUrl)
    expect(result.name).toBe('test-market')
    const list = await getMarketplaces()
    expect(list.length).toBe(1)
    expect(list[0].source).toMatchObject({ source: 'url' })
  })
  it('file 类型添加成功', async () => {
    const { addMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    const result = await addMarketplace(mpPath)
    expect(result.name).toBe('test-market')
    const list = await getMarketplaces()
    expect(list[0].source).toMatchObject({ source: 'file' })
  })
  it('source 幂等：相同 source 不重复添加', async () => {
    const { addMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)
    const r2 = await addMarketplace(mpPath)
    expect(r2.alreadyExists).toBe(true)
    const list = await getMarketplaces()
    expect(list.length).toBe(1)
  })
  it('marketplace.json 校验失败时报错', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const badPath = join(TMP_DIR, 'bad.json')
    await writeFile(badPath, '{ not json')
    await expect(addMarketplace(badPath)).rejects.toThrow()
  })
  it('空目录 getMarketplaces 返回空数组', async () => {
    const { getMarketplaces } = await import('../src/main/marketplace-manager')
    const list = await getMarketplaces()
    expect(list).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: FAIL — addMarketplace / getMarketplaces 未定义

- [ ] **Step 3: 实现 addMarketplace + getMarketplaces**

在 `src/main/marketplace-manager.ts` 的 parseSource 函数之后追加：

```typescript
// 校正本地路径 source（parseSource 返回 directory 占位，这里 stat 后校正为 file/directory）
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

// 从 directory source 读取 marketplace.json（在 <dir>/.claude-plugin/marketplace.json）
async function readMarketplaceFromDir(dir: string): Promise<PluginMarketplace> {
  const nested = join(dir, '.claude-plugin', 'marketplace.json')
  if (existsSync(nested)) return readMarketplaceFile(nested)
  return readMarketplaceFile(join(dir, 'marketplace.json'))
}

export async function getMarketplaces(): Promise<KnownMarketplace[]> {
  const config = await readJson<Record<string, KnownMarketplace>>(KNOWN_MARKETPLACES_PATH, {})
  return Object.entries(config).map(([name, entry]) => ({ ...entry, name }))
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
    // 本地路径占位校正
    if (parsed.source === 'directory' && !parsed.url) {
      try { source = await resolveLocalSource(input) }
      catch { source = parsed } // stat 失败仍用原值，后续加载会报错
    } else {
      source = parsed
    }
    if (options?.ref && (source.source === 'github' || source.source === 'git')) {
      (source as any).ref = options.ref
    }
  }

  const config = await readJson<Record<string, KnownMarketplace>>(KNOWN_MARKETPLACES_PATH, {})

  // source 幂等：完全相同的 source 已存在则跳过
  for (const [, entry] of Object.entries(config)) {
    if (JSON.stringify(entry.source) === JSON.stringify(source)) {
      // 找到 marketplaces 缓存里的 name
      const cachedName = await tryGetCachedName(entry)
      return { name: cachedName, alreadyExists: true }
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
  await writeJson(KNOWN_MARKETPLACES_PATH, config)
  return { name, alreadyExists: false }
}

// 从已缓存条目读取 marketplace name（幂等命中时用）
async function tryGetCachedName(entry: KnownMarketplace): Promise<string> {
  try {
    const mp = await readCachedMarketplace(entry.installLocation, entry.source)
    return mp.name
  } catch { return 'unknown' }
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
    // 拷贝到 marketplaces/<basename>.json
    const dest = join(MARKETPLACES_DIR, source.path.split('/').pop() || 'marketplace.json')
    await cp(source.path, dest)
    const marketplace = await readMarketplaceFile(dest)
    const finalDest = join(MARKETPLACES_DIR, `${marketplace.name}.json`)
    if (dest !== finalDest) await cp(dest, finalDest, { force: true })
    await rm(dest, { force: true }).catch(() => {})
    return { marketplace, cachePath: finalDest }
  }

  if (source.source === 'directory') {
    // 直接从原目录读，installLocation 指向原路径（不拷贝，保持实时性）
    const marketplace = await readMarketplaceFromDir(source.path)
    return { marketplace, cachePath: source.path }
  }

  if (source.source === 'url') {
    // 下载到 marketplaces/<name>.json
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
    // git clone 到 marketplaces/<repo-name 或 marketplace name>
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

  throw new Error(`不支持的 source 类型`)
}

const GIT_TIMEOUT_MS = 120000

async function gitClone(url: string, dest: string, ref?: string): Promise<void> {
  const args = ref
    ? ['clone', '--depth', '1', '--branch', ref, url, dest]
    : ['clone', '--depth', '1', url, dest]
  await execFileAsync('git', args, { timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: PASS — addMarketplace 5 个测试 + parseSource 7 个测试全通过

- [ ] **Step 5: 提交**

```bash
git add src/main/marketplace-manager.ts tests/marketplace-manager.test.ts
git commit -m "feat(marketplace): addMarketplace + getMarketplaces 实现"
```


---

## Task 3: removeMarketplace + refreshMarketplace + setAutoUpdate

**Files:**
- Modify: `src/main/marketplace-manager.ts`
- Modify: `src/main/claude-config.ts` (导出 `readInstalledPlugins` 供级联清理)
- Test: `tests/marketplace-manager.test.ts`

- [ ] **Step 1: 在 claude-config.ts 导出 readInstalledPlugins**

在 `src/main/claude-config.ts` 的 `getPlugins` 函数之前，把 `InstalledPlugin` 接口和读取逻辑导出：

```typescript
// 在文件顶部已有的 InstalledPlugin interface 改为 export
export interface InstalledPlugin { scope: string; installPath: string; version: string }

// 新增导出函数：读取 installed_plugins.json 原始结构（供 marketplace-manager 级联清理用）
export async function readInstalledPlugins(): Promise<{ version?: number; plugins: Record<string, InstalledPlugin[]> }> {
  return readJson(INSTALLED_PLUGINS_PATH, { plugins: {} })
}

// 新增导出：写回 installed_plugins.json
export async function writeInstalledPlugins(data: { version?: number; plugins: Record<string, InstalledPlugin[]> }): Promise<void> {
  await writeJson(INSTALLED_PLUGINS_PATH, data)
}
```

注意：现有 `interface InstalledPlugin` 前面加 `export`，`INSTALLED_PLUGINS_PATH` 也需确认是模块级 const（已是）。

- [ ] **Step 2: 写 removeMarketplace 测试**

追加到 `tests/marketplace-manager.test.ts`：

```typescript
import { writeFile as wf, mkdir as mk } from 'fs/promises'

describe('removeMarketplace', () => {
  it('删除条目 + 清理缓存 + 级联移除 enabledPlugins', async () => {
    const { addMarketplace, removeMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const { readInstalledPlugins, writeInstalledPlugins } = await import('../src/main/claude-config')

    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)

    // 模拟已安装的插件：写 installed_plugins.json + settings.json
    await writeInstalledPlugins({
      plugins: {
        'plugin-a@test-market': [{ scope: 'user', installPath: join(TMP_DIR, 'fake-cache'), version: '1.0.0' }],
      },
    })
    await wf(join(TMP_DIR, 'settings.json'), JSON.stringify({
      enabledPlugins: { 'plugin-a@test-market': true, 'other@other-market': true },
    }))

    const result = await removeMarketplace('test-market')
    expect(result.cascadedPlugins).toContain('plugin-a')

    // known_marketplaces.json 已移除
    const list = await getMarketplaces()
    expect(list.find(m => (m as any).name === 'test-market')).toBeUndefined()

    // settings.json 的 enabledPlugins 里 @test-market 后缀的已移除，保留 other
    const settings = JSON.parse(await readFile(join(TMP_DIR, 'settings.json'), 'utf-8'))
    expect(settings.enabledPlugins['plugin-a@test-market']).toBeUndefined()
    expect(settings.enabledPlugins['other@other-market']).toBe(true)
  })
  it('删除不存在的仓库报错', async () => {
    const { removeMarketplace } = await import('../src/main/marketplace-manager')
    await expect(removeMarketplace('nonexistent')).rejects.toThrow()
  })
})

describe('refreshMarketplace', () => {
  it('file 类型刷新成功并更新 lastUpdated', async () => {
    const { addMarketplace, refreshMarketplace, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)
    // 记录旧 lastUpdated
    const before = (await getMarketplaces())[0]
    await new Promise(r => setTimeout(r, 50))
    await refreshMarketplace('test-market')
    const after = (await getMarketplaces())[0]
    expect(new Date(after.lastUpdated).getTime()).toBeGreaterThan(new Date(before.lastUpdated).getTime())
  })
})

describe('setAutoUpdate', () => {
  it('切换 autoUpdate 标记', async () => {
    const { addMarketplace, setMarketplaceAutoUpdate, getMarketplaces } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath, { autoUpdate: true })
    await setMarketplaceAutoUpdate('test-market', false)
    const m = (await getMarketplaces())[0]
    expect(m.autoUpdate).toBe(false)
  })
})
```


- [ ] **Step 3: 运行测试验证失败**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: FAIL — removeMarketplace / refreshMarketplace / setMarketplaceAutoUpdate 未定义

- [ ] **Step 4: 实现 removeMarketplace + refreshMarketplace + setAutoUpdate**

在 `src/main/marketplace-manager.ts` 的 `getMarketplaces` 之后追加：

```typescript
// 读 known_marketplaces.json 的单个条目（含 name key）
async function readKnownConfig(): Promise<Record<string, KnownMarketplace>> {
  return readJson<Record<string, KnownMarketplace>>(KNOWN_MARKETPLACES_PATH, {})
}

async function saveKnownConfig(config: Record<string, KnownMarketplace>): Promise<void> {
  await writeJson(KNOWN_MARKETPLACES_PATH, config)
}

// settings.json 的 enabledPlugins 级联清理需要读写 claude-config 的路径
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
    // 重新下载
    const response = await fetch(source.url, { headers: source.headers })
    if (!response.ok) throw new Error(`下载失败: ${response.status}`)
    const data = JSON.parse(await response.text())
    await writeJson(entry.installLocation, data)
  } else if (source.source === 'github' || source.source === 'git') {
    // git pull（缓存目录是 clone 出来的 git 仓库）
    const ref = source.source === 'github' ? source.ref : source.ref
    await gitPull(entry.installLocation, ref)
  } else if (source.source === 'file') {
    // file 类型：重新拷贝
    const data = JSON.parse(await readFile(source.path, 'utf-8'))
    await writeJson(entry.installLocation, data)
  } else if (source.source === 'directory') {
    // directory 类型：重新校验 marketplace.json 存在
    await readMarketplaceFromDir(source.path)
  }

  config[name].lastUpdated = new Date().toISOString()
  await saveKnownConfig(config)
}

async function gitPull(cwd: string, ref?: string): Promise<void> {
  const args = ref
    ? ['fetch', 'origin', ref]
    : ['pull', '--ff-only']
  await execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (ref) {
    await execFileAsync('git', ['checkout', ref], { cwd, timeout: GIT_TIMEOUT_MS })
  }
}

export async function refreshAllMarketplaces(): Promise<void> {
  const config = await readKnownConfig()
  for (const name of Object.keys(config)) {
    try {
      await refreshMarketplace(name)
    } catch (e) {
      console.error(`刷新仓库 ${name} 失败:`, e)
    }
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
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: PASS — 全部测试通过

- [ ] **Step 6: 提交**

```bash
git add src/main/marketplace-manager.ts src/main/claude-config.ts tests/marketplace-manager.test.ts
git commit -m "feat(marketplace): remove/refresh/setAutoUpdate + 启动自动刷新"
```


---

## Task 4: getMarketplacePlugins + searchMarketplacePlugins

**Files:**
- Modify: `src/main/marketplace-manager.ts`
- Test: `tests/marketplace-manager.test.ts`

- [ ] **Step 1: 写测试**

追加到 `tests/marketplace-manager.test.ts`：

```typescript
describe('getMarketplacePlugins + searchMarketplacePlugins', () => {
  it('读取仓库内插件列表', async () => {
    const { addMarketplace, getMarketplacePlugins } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)
    const plugins = await getMarketplacePlugins('test-market')
    expect(plugins.length).toBe(1)
    expect(plugins[0].name).toBe('plugin-a')
  })
  it('搜索跨仓库匹配插件', async () => {
    const { addMarketplace, searchMarketplacePlugins } = await import('../src/main/marketplace-manager')
    const mpPath = await makeTmpMarketplace()
    await addMarketplace(mpPath)
    const results = await searchMarketplacePlugins('plugin')
    expect(results.length).toBe(1)
    expect(results[0].pluginName).toBe('plugin-a')
    expect(results[0].marketplace).toBe('test-market')
    expect(results[0].installed).toBe(false)
  })
  it('搜索无匹配返回空', async () => {
    const { searchMarketplacePlugins } = await import('../src/main/marketplace-manager')
    const results = await searchMarketplacePlugins('xyz-nothing')
    expect(results).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: FAIL — getMarketplacePlugins / searchMarketplacePlugins 未定义

- [ ] **Step 3: 实现 getMarketplacePlugins + searchMarketplacePlugins**

在 `src/main/marketplace-manager.ts` 追加：

```typescript
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
    try {
      marketplace = await readCachedMarketplace(entry.installLocation, entry.source)
    } catch { continue } // 跳过无法读取的仓库

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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/marketplace-manager.test.ts`
Expected: PASS — 全部测试通过

- [ ] **Step 5: 提交**

```bash
git add src/main/marketplace-manager.ts tests/marketplace-manager.test.ts
git commit -m "feat(marketplace): getMarketplacePlugins + 跨仓库搜索"
```

---

## Task 5: installPlugin + uninstallPlugin（claude-config.ts）

**Files:**
- Modify: `src/main/claude-config.ts`
- Create: `tests/plugin-install.test.ts`

- [ ] **Step 1: 写 installPlugin 失败测试**

```typescript
// tests/plugin-install.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'

const TMP_DIR = join(tmpdir(), `pi-${Math.random().toString(36).slice(2)}-${Date.now()}`)
let origDir: string | undefined

beforeEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true })
  await mkdir(TMP_DIR, { recursive: true })
  origDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = TMP_DIR
  vi.resetModules()
})
afterEach(async () => {
  if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = origDir
  vi.resetModules()
  await rm(TMP_DIR, { recursive: true, force: true })
})

// 构造一个完整的本地 marketplace（仓库目录结构），供安装测试用
async function makeLocalMarketplace(): Promise<string> {
  // marketplace 仓库目录
  const mktDir = join(TMP_DIR, 'source-marketplace')
  const mktJsonDir = join(mktDir, '.claude-plugin')
  await mkdir(mktJsonDir, { recursive: true })
  await writeFile(join(mktJsonDir, 'marketplace.json'), JSON.stringify({
    name: 'install-test-market',
    owner: { name: 'tester' },
    plugins: [{ name: 'demo-plugin', description: 'A demo', source: './demo-plugin', version: '1.0.0' }],
  }))
  // 插件目录
  const pluginDir = join(mktDir, 'demo-plugin')
  const pluginManifestDir = join(pluginDir, '.claude-plugin')
  await mkdir(pluginManifestDir, { recursive: true })
  await writeFile(join(pluginManifestDir, 'plugin.json'), JSON.stringify({
    name: 'demo-plugin', version: '1.0.0', description: 'A demo',
  }))
  await mkdir(join(pluginDir, 'skills'), { recursive: true })
  await writeFile(join(pluginDir, 'skills', 'greet', 'SKILL.md'), '---\nname: greet\ndescription: greet skill\n---\nHello')
  return mktDir
}

describe('installPlugin', () => {
  it('本地相对路径 source 安装成功', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const { installPlugin, getPlugins } = await import('../src/main/claude-config')

    const mktDir = await makeLocalMarketplace()
    await addMarketplace(mktDir)

    const result = await installPlugin('demo-plugin@install-test-market')
    expect(result.success).toBe(true)

    // installed_plugins.json 有记录
    const plugins = await getPlugins()
    expect(plugins.find(p => p.id === 'demo-plugin@install-test-market')).toBeTruthy()

    // settings.json enabledPlugins 有该 key
    const settings = JSON.parse(await readFile(join(TMP_DIR, 'settings.json'), 'utf-8'))
    expect(settings.enabledPlugins['demo-plugin@install-test-market']).toBe(true)
  })
  it('重复安装幂等（version 相同不报错）', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const { installPlugin } = await import('../src/main/claude-config')

    const mktDir = await makeLocalMarketplace()
    await addMarketplace(mktDir)
    await installPlugin('demo-plugin@install-test-market')
    const r2 = await installPlugin('demo-plugin@install-test-market')
    expect(r2.success).toBe(true)
  })
})

describe('uninstallPlugin', () => {
  it('删除 cache + 移除 installed_plugins + 移除 enabledPlugins', async () => {
    const { addMarketplace } = await import('../src/main/marketplace-manager')
    const { installPlugin, uninstallPlugin, getPlugins } = await import('../src/main/claude-config')

    const mktDir = await makeLocalMarketplace()
    await addMarketplace(mktDir)
    await installPlugin('demo-plugin@install-test-market')

    const result = await uninstallPlugin('demo-plugin@install-test-market')
    expect(result.success).toBe(true)

    // installed_plugins.json 无记录
    const plugins = await getPlugins()
    expect(plugins.find(p => p.id === 'demo-plugin@install-test-market')).toBeFalsy()

    // settings.json enabledPlugins 无该 key
    const settings = JSON.parse(await readFile(join(TMP_DIR, 'settings.json'), 'utf-8'))
    expect(settings.enabledPlugins['demo-plugin@install-test-market']).toBeUndefined()
  })
  it('卸载未安装插件报错', async () => {
    const { uninstallPlugin } = await import('../src/main/claude-config')
    await expect(uninstallPlugin('not-installed@no-market')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/plugin-install.test.ts`
Expected: FAIL — installPlugin / uninstallPlugin 未定义

- [ ] **Step 3: 实现 installPlugin + uninstallPlugin**

在 `src/main/claude-config.ts` 文件末尾追加（PLUGINS_CACHE_DIR 已导出）：

```typescript
import { cp, rm } from 'fs/promises'

// ---- 插件安装 / 卸载 ----

// 安装插件：从 marketplace 目录拷贝到 versioned cache + 写 installed_plugins.json + 写 settings.json。
// pluginId 格式：plugin@marketplace。当前仅支持本地相对路径 source（'./xxx'）。
export async function installPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
  const [pluginName, marketplaceName] = pluginId.split('@')
  if (!pluginName || !marketplaceName) {
    return { success: false, message: `无效的插件 ID: ${pluginId}（格式：plugin@marketplace）` }
  }

  // 从 known_marketplaces.json 找仓库条目（含 installLocation + source）
  const knownConfig = await readJson<Record<string, any>>(join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json'), {})
  const mktEntry = knownConfig[marketplaceName]
  if (!mktEntry) {
    return { success: false, message: `仓库「${marketplaceName}」未注册` }
  }

  // 读 marketplace.json 找插件 entry
  const { getMarketplacePlugins } = await import('./marketplace-manager')
  let entry: any
  try {
    const plugins = await getMarketplacePlugins(marketplaceName)
    entry = plugins.find((p: any) => p.name === pluginName)
  } catch {
    return { success: false, message: `仓库「${marketplaceName}」不存在或无法读取` }
  }
  if (!entry) {
    return { success: false, message: `插件「${pluginName}」在仓库「${marketplaceName}」中未找到` }
  }

  // 判断 source 类型：仅支持本地相对路径（'./xxx'）
  if (typeof entry.source !== 'string' || !entry.source.startsWith('./')) {
    return { success: false, message: `插件「${pluginName}」使用远程 source，当前版本暂不支持远程插件安装` }
  }

  // marketplaceDir：directory/file 取 installLocation（原路径），github/git 取 clone 出来的目录
  if (!mktEntry) {
    return { success: false, message: `仓库「${marketplaceName}」未注册` }
  }
  const marketplaceDir = mktEntry.source.source === 'directory' ? mktEntry.installLocation
    : mktEntry.source.source === 'file' ? dirname(mktEntry.installLocation)
    : mktEntry.installLocation // github/git clone 出来的目录

  const sourcePath = join(marketplaceDir, entry.source)

  // 读 manifest 获取 version
  const manifestPath = join(sourcePath, '.claude-plugin', 'plugin.json')
  const manifest = await readJson<any>(manifestPath, null)
  if (!manifest) {
    return { success: false, message: `插件 manifest 未找到: ${manifestPath}` }
  }
  const version = manifest.version || entry.version || 'unknown'

  // versioned cache 路径
  const versionedPath = join(PLUGINS_CACHE_DIR, marketplaceName, pluginName, version)

  // 幂等：已安装同版本则跳过
  const installed = await readInstalledPlugins()
  const existing = installed.plugins[pluginId]
  if (existing && existing.some((i: InstalledPlugin) => i.version === version)) {
    return { success: true, message: `插件「${pluginName}」已是最新版本（${version}）` }
  }

  // 拷贝
  await mkdir(versionedPath, { recursive: true })
  await cp(sourcePath, versionedPath, { recursive: true })

  // 写 installed_plugins.json
  if (!installed.plugins[pluginId]) installed.plugins[pluginId] = []
  installed.plugins[pluginId].push({ scope: 'user', installPath: versionedPath, version })
  await writeInstalledPlugins(installed)

  // 写 settings.json enabledPlugins（用整对象替换确保生效，复用 setPluginEnabled 逻辑）
  await setPluginEnabled(pluginId, true)

  return { success: true, message: `插件「${pluginName}」安装成功（v${version}）` }
}

// 卸载插件：删 cache + 移除 installed_plugins.json + 移除 settings.json enabledPlugins。
export async function uninstallPlugin(pluginId: string): Promise<{ success: boolean; message: string }> {
  const installed = await readInstalledPlugins()
  const installations = installed.plugins[pluginId]
  if (!installations || installations.length === 0) {
    throw new Error(`插件「${pluginId}」未安装`)
  }

  // 删除 versioned cache（仅当无其他安装引用该路径）
  for (const inst of installations) {
    const stillUsed = Object.entries(installed.plugins)
      .filter(([id]) => id !== pluginId)
      .some(([, arr]) => arr.some((i: InstalledPlugin) => i.installPath === inst.installPath))
    if (!stillUsed) {
      await rm(inst.installPath, { recursive: true, force: true }).catch(() => {})
    }
  }

  // 从 installed_plugins.json 移除
  delete installed.plugins[pluginId]
  await writeInstalledPlugins(installed)

  // 从 settings.json enabledPlugins 移除（整对象替换）
  const settings = await getSettingsJson()
  const map: Record<string, boolean> = { ...(settings.enabledPlugins ?? {}) }
  delete map[pluginId]
  settings.enabledPlugins = map
  await writeJson(SETTINGS_PATH, settings)

  const [pluginName] = pluginId.split('@')
  return { success: true, message: `插件「${pluginName}」已卸载` }
}
```

注意：`readJson` / `writeJson` 是 claude-config.ts 内的私有函数（已存在），`mkdir` 已在文件顶部 import。需确认 `import { cp, rm } from 'fs/promises'` 补齐（cp/rm 未在现有 import 中）。现有顶部 import 是 `import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'`，需追加 `cp, rm`。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/plugin-install.test.ts`
Expected: PASS — install 2 个 + uninstall 2 个测试全通过

- [ ] **Step 5: 提交**

```bash
git add src/main/claude-config.ts tests/plugin-install.test.ts
git commit -m "feat(plugins): installPlugin + uninstallPlugin 实现"
```


---

## Task 6: IPC handler + preload + global.d.ts

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: 注册 IPC handler**

在 `src/main/index.ts` 中找到现有 `cc:plugins:get` handler（约 104 行附近），在其下方追加：

```typescript
// ---- 插件仓库管理 + 安装/卸载 ----
import * as mkt from './marketplace-manager'
ipcMain.handle('cc:marketplace:get', () => mkt.getMarketplaces())
ipcMain.handle('cc:marketplace:get-plugins', (_e, name: string) => mkt.getMarketplacePlugins(name))
ipcMain.handle('cc:marketplace:search', (_e, query: string) => mkt.searchMarketplacePlugins(query))
ipcMain.handle('cc:marketplace:add', (_e, source: string, options?: any) => mkt.addMarketplace(source, options))
ipcMain.handle('cc:marketplace:remove', (_e, name: string) => mkt.removeMarketplace(name))
ipcMain.handle('cc:marketplace:refresh', (_e, name: string) => mkt.refreshMarketplace(name))
ipcMain.handle('cc:marketplace:refresh-all', () => mkt.refreshAllMarketplaces())
ipcMain.handle('cc:marketplace:set-auto-update', (_e, name: string, enabled: boolean) => mkt.setMarketplaceAutoUpdate(name, enabled))
ipcMain.handle('cc:plugin:install', (_e, pluginId: string) => cc.installPlugin(pluginId))
ipcMain.handle('cc:plugin:uninstall', (_e, pluginId: string) => cc.uninstallPlugin(pluginId))
```

注意：`import * as mkt from './marketplace-manager'` 放在文件顶部的 import 区。`cc` 变量是已有的 `claude-config` 模块引用（确认文件顶部是否已 `import * as cc from './claude-config'` 或类似——需要根据现有写法调整，可能直接用具名导入）。

- [ ] **Step 2: preload 暴露 API**

在 `src/preload/index.ts` 的 `cc:` 对象里，在现有 `plugins:` 之后追加 `marketplaces:`，并在 `plugins:` 内追加 install/uninstall：

```typescript
    plugins: {
      get: () => ipcRenderer.invoke('cc:plugins:get'),
      setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('cc:plugin:set-enabled', id, enabled),
      install: (pluginId: string) => ipcRenderer.invoke('cc:plugin:install', pluginId),
      uninstall: (pluginId: string) => ipcRenderer.invoke('cc:plugin:uninstall', pluginId),
    },
    marketplaces: {
      get: () => ipcRenderer.invoke('cc:marketplace:get'),
      getPlugins: (name: string) => ipcRenderer.invoke('cc:marketplace:get-plugins', name),
      search: (query: string) => ipcRenderer.invoke('cc:marketplace:search', query),
      add: (source: string, options?: any) => ipcRenderer.invoke('cc:marketplace:add', source, options),
      remove: (name: string) => ipcRenderer.invoke('cc:marketplace:remove', name),
      refresh: (name: string) => ipcRenderer.invoke('cc:marketplace:refresh', name),
      refreshAll: () => ipcRenderer.invoke('cc:marketplace:refresh-all'),
      setAutoUpdate: (name: string, enabled: boolean) => ipcRenderer.invoke('cc:marketplace:set-auto-update', name, enabled),
    },
```

- [ ] **Step 3: global.d.ts 类型声明**

在 `src/renderer/global.d.ts` 中：

a) 顶部 import 补充 marketplace-manager 类型：
```typescript
import type {
  KnownMarketplace, PluginMarketplaceEntry, SearchResult,
} from '../main/marketplace-manager'
```

b) 在 `plugins:` 接口里补 install/uninstall：
```typescript
  plugins: {
    get(): Promise<ClaudePlugin[]>
    setEnabled(id: string, enabled: boolean): Promise<void>
    install(pluginId: string): Promise<{ success: boolean; message: string }>
    uninstall(pluginId: string): Promise<{ success: boolean; message: string }>
  }
```

c) 在 `ClaudeConfigAPI` 接口里 `plugins:` 之后加 `marketplaces:`：
```typescript
  marketplaces: {
    get(): Promise<KnownMarketplace[]>
    getPlugins(name: string): Promise<PluginMarketplaceEntry[]>
    search(query: string): Promise<SearchResult[]>
    add(source: string, options?: { type?: string; ref?: string; autoUpdate?: boolean }): Promise<{ name: string; alreadyExists: boolean }>
    remove(name: string): Promise<{ cascadedPlugins: string[] }>
    refresh(name: string): Promise<void>
    refreshAll(): Promise<void>
    setAutoUpdate(name: string, enabled: boolean): Promise<void>
  }
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/global.d.ts
git commit -m "feat(ipc): marketplace + plugin install/uninstall IPC 通道"
```

---

## Task 7: 启动自动刷新

**Files:**
- Modify: `src/main/index.ts`（或应用入口文件，找到 ensureClaudeConfigDir 调用处）

- [ ] **Step 1: 在应用启动后调用 refreshAutoUpdateMarketplaces**

找到 `index.ts` 中 app ready 后调用 `ensureClaudeConfigDir()` 的位置，在其之后追加（异步不 await）：

```typescript
// 应用启动后异步刷新标记了 autoUpdate 的仓库（不阻塞窗口加载）
import { refreshAutoUpdateMarketplaces } from './marketplace-manager'
// ... 在 ensureClaudeConfigDir() 之后
refreshAutoUpdateMarketplaces().catch(() => {})
```

- [ ] **Step 2: 验证编译 + 运行应用确认不崩溃**

Run: `npx tsc --noEmit && npm run dev`（手动确认应用正常启动）
Expected: 应用正常启动，控制台无崩溃错误

- [ ] **Step 3: 提交**

```bash
git add src/main/index.ts
git commit -m "feat(marketplace): 启动时自动刷新 autoUpdate 仓库"
```


---

## Task 8: AddMarketplaceDialog 组件

**Files:**
- Create: `src/renderer/components/settings/AddMarketplaceDialog.tsx`

- [ ] **Step 1: 实现添加仓库弹窗**

```tsx
// src/renderer/components/settings/AddMarketplaceDialog.tsx
// 添加插件仓库弹窗：智能输入框自动识别来源类型 + 高级折叠区（手动覆盖 + ref + autoUpdate）。
import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { Tooltip } from '../Tooltip'

interface Props {
  onAdded: () => void
  onClose: () => void
}

const labelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
}
const primaryBtn: React.CSSProperties = {
  padding: '7px 18px', fontSize: 12, cursor: 'pointer',
  border: 'none', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, cursor: 'pointer',
  border: 'none', background: 'transparent', color: 'var(--text-muted)',
}

// 客户端预判来源类型（仅用于显示 badge，实际识别在后端）
function guessType(input: string): string {
  const t = input.trim()
  if (/^git@github\.com:/.test(t) || /^https?:\/\/github\.com\//.test(t)) return 'GitHub'
  if (/^git@/.test(t) || (/^https?:\/\//.test(t) && t.endsWith('.git'))) return 'Git'
  if (/^https?:\/\//.test(t)) return 'URL'
  if (t.endsWith('.json')) return '本地文件'
  if (t.includes('/')) return '本地目录'
  return ''
}

export function AddMarketplaceDialog({ onAdded, onClose }: Props) {
  const [input, setInput] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [typeOverride, setTypeOverride] = useState('')
  const [ref, setRef] = useState('')
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guessed = input.trim() ? guessType(input) : ''

  const handleAdd = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    try {
      const options: any = { autoUpdate }
      if (typeOverride) options.type = typeOverride
      if (ref.trim()) options.ref = ref.trim()
      await window.api?.cc.marketplaces.add(input.trim(), options)
      onAdded()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 480, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-float)',
        padding: 20,
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text)', fontSize: 15, margin: '0 0 16px 0' }}>添加插件仓库</h3>

        <div style={{ labelStyle }}>
          <div style={labelStyle}>来源（GitHub / Git URL / HTTP URL / 本地路径）</div>
          <input
            placeholder="anthropics/claude-plugins 或 https://... 或 /path/to/dir"
            value={input} onChange={e => setInput(e.target.value)}
            style={inputStyle} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && !loading) handleAdd() }}
          />
          {guessed && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--accent)' }}>
              识别为：{guessed}
            </div>
          )}
        </div>

        {/* 高级选项 */}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            高级选项
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 8, paddingLeft: 16 }}>
              <div style={labelStyle}>来源类型（手动覆盖自动识别）</div>
              <select
                value={typeOverride} onChange={e => setTypeOverride(e.target.value)}
                style={{ ...inputStyle, width: 'auto', marginBottom: 10 }}
              >
                <option value="">自动识别</option>
                <option value="github">GitHub</option>
                <option value="git">Git</option>
                <option value="url">URL</option>
                <option value="file">本地文件</option>
                <option value="directory">本地目录</option>
              </select>
              <div style={labelStyle}>分支 / Tag（GitHub / Git 用）</div>
              <input
                placeholder="main"
                value={ref} onChange={e => setRef(e.target.value)}
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={autoUpdate} onChange={e => setAutoUpdate(e.target.checked)} />
                启动时自动刷新
              </label>
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 10, color: 'var(--danger, #e57373)', fontSize: 12, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        {/* 操作栏 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={ghostBtn}>取消</button>
          <button onClick={handleAdd} disabled={loading || !input.trim()} style={{ ...primaryBtn, opacity: (loading || !input.trim()) ? 0.5 : 1 }}>
            {loading ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/AddMarketplaceDialog.tsx
git commit -m "feat(ui): AddMarketplaceDialog 智能输入框 + 高级选项"
```

---

## Task 9: PluginDetailDialog 组件

**Files:**
- Create: `src/renderer/components/settings/PluginDetailDialog.tsx`

- [ ] **Step 1: 实现插件详情弹窗**

```tsx
// src/renderer/components/settings/PluginDetailDialog.tsx
// 插件详情弹窗：结构化展示 marketplace entry 的 manifest 信息 + 安装按钮。
import { useState } from 'react'
import type { PluginMarketplaceEntry } from '../../../../main/marketplace-manager'

interface Props {
  entry: PluginMarketplaceEntry
  marketplaceName: string
  installed: boolean
  onInstalled: () => void
  onClose: () => void
}

const primaryBtn: React.CSSProperties = {
  padding: '7px 18px', fontSize: 12, cursor: 'pointer',
  border: 'none', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12, cursor: 'pointer',
  border: 'none', background: 'transparent', color: 'var(--text-muted)',
}

export function PluginDetailDialog({ entry, marketplaceName, installed, onInstalled, onClose }: Props) {
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nowInstalled, setNowInstalled] = useState(installed)

  const handleInstall = async () => {
    setInstalling(true)
    setError(null)
    try {
      const result = await window.api?.cc.plugins.install(`${entry.name}@${marketplaceName}`)
      if (result.success) {
        setNowInstalled(true)
        onInstalled()
      } else {
        setError(result.message)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 520, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto',
        background: 'var(--bg)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-float)',
        padding: 20,
      }} onClick={e => e.stopPropagation()}>
        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h3 style={{ color: 'var(--text)', fontSize: 15, margin: 0, fontFamily: 'var(--font-mono)' }}>{entry.name}</h3>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>v{entry.version || 'unknown'}</span>
        </div>

        {/* 描述 */}
        {entry.description && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
            {entry.description}
          </div>
        )}

        {/* 来源 + 分类 */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>仓库：<span style={{ color: 'var(--text)' }}>{marketplaceName}</span></span>
          {entry.category && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>分类：<span style={{ color: 'var(--text)' }}>{entry.category}</span></span>}
        </div>

        {/* source 类型提示 */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          {typeof entry.source === 'string'
            ? `本地路径: ${entry.source}`
            : '远程 source'}
        </div>

        {/* tags */}
        {entry.tags && entry.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {entry.tags.map(tag => (
              <span key={tag} style={{
                padding: '1px 7px', borderRadius: 999, fontSize: 10,
                border: '1px solid var(--border)', color: 'var(--text-muted)',
              }}>{tag}</span>
            ))}
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger, #e57373)', fontSize: 12, marginBottom: 10, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}

        {/* 操作栏 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={ghostBtn}>关闭</button>
          {!nowInstalled && (
            <button onClick={handleInstall} disabled={installing} style={{ ...primaryBtn, opacity: installing ? 0.5 : 1 }}>
              {installing ? '安装中...' : '安装'}
            </button>
          )}
          {nowInstalled && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>已安装</span>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/PluginDetailDialog.tsx
git commit -m "feat(ui): PluginDetailDialog 结构化展示 + 安装按钮"
```


---

## Task 10: PluginSettings.tsx 重构为双 Tab

**Files:**
- Modify: `src/renderer/components/settings/PluginSettings.tsx`

这是最大的前端改动。将现有单列表重构为双 Tab（已安装 / 仓库），仓库 Tab 含搜索双重上下文、仓库折叠卡片、跨仓库搜索结果。

- [ ] **Step 1: 完整重写 PluginSettings.tsx**

```tsx
// src/renderer/components/settings/PluginSettings.tsx
// 插件管理设置页：双 Tab（已安装 / 仓库）。
// 已安装 Tab：插件列表 + 启停 + 卸载。
// 仓库 Tab：仓库折叠卡片（浏览/安装插件）+ 搜索框双重上下文（空=仓库列表，有关键词=跨仓库搜索）。
import { useEffect, useState, useCallback } from 'react'
import type { ClaudePlugin } from '../../../main/claude-config'
import type { KnownMarketplace, PluginMarketplaceEntry, SearchResult } from '../../../main/marketplace-manager'
import { Toggle } from './Toggle'
import { AddMarketplaceDialog } from './AddMarketplaceDialog'
import { PluginDetailDialog } from './PluginDetailDialog'
import { RefreshCw, Plug, Trash2, Plus, FileText, Download, ChevronRight, ChevronDown } from 'lucide-react'
import { Tooltip } from '../Tooltip'

// ---- 样式常量 ----
const iconBtn: React.CSSProperties = {
  padding: '4px 6px', fontSize: 13, cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'var(--text-muted)', lineHeight: 1,
}
const topIconBtn: React.CSSProperties = { ...iconBtn, fontSize: 14, padding: '4px 8px' }
const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
  marginRight: 4,
})
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'transparent', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', outline: 'none', marginBottom: 14,
}

// 来源类型 badge 文本
function sourceBadge(m: KnownMarketplace): string {
  return m.source.source
}

export function PluginSettings() {
  const [tab, setTab] = useState<'installed' | 'marketplaces'>('installed')

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ color: 'var(--text)', fontSize: 18, margin: 0 }}>插件管理</h2>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 14 }}>
        仓库与插件均存储在 ~/.cc-desk/claude/plugins/，SDK 运行时自动加载。
      </div>

      {/* Tab 栏 */}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <button style={segBtn(tab === 'installed')} onClick={() => setTab('installed')}>已安装</button>
        <button style={segBtn(tab === 'marketplaces')} onClick={() => setTab('marketplaces')}>仓库</button>
      </div>

      {tab === 'installed' && <InstalledTab />}
      {tab === 'marketplaces' && <MarketplacesTab />}
    </div>
  )
}

// ---- 已安装 Tab ----

function InstalledTab() {
  const [plugins, setPlugins] = useState<ClaudePlugin[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    window.api?.cc?.plugins.get().then(list => { setPlugins(list); setLoading(false) })
  }, [])
  useEffect(() => { reload() }, [reload])

  const filtered = plugins.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) || p.desc.toLowerCase().includes(q.toLowerCase())
  )

  const toggle = async (id: string) => {
    const p = plugins.find(x => x.id === id)
    if (!p) return
    await window.api?.cc?.plugins.setEnabled(id, !p.enabled)
    reload()
  }

  const handleUninstall = async () => {
    if (!confirmUninstall) return
    await window.api?.cc?.plugins.uninstall(confirmUninstall)
    setConfirmUninstall(null)
    reload()
  }

  return (
    <div>
      <input placeholder="搜索已安装插件..." value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>}
        {!loading && filtered.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配插件</div>}
        {filtered.map(p => (
          <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', boxShadow: 'var(--shadow-float)', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: 'var(--accent)', fontSize: 16, flexShrink: 0, display: 'inline-flex' }}><Plug size={16} /></span>
              <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{p.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{p.version}</span>
              <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{p.source}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Toggle on={p.enabled} onChange={() => toggle(p.id)} aria-label={`${p.enabled ? '停用' : '启用'} ${p.name}`} />
                <Tooltip label="卸载">
                  <button onClick={() => setConfirmUninstall(p.id)} style={iconBtn}><Trash2 size={14} /></button>
                </Tooltip>
              </span>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6, marginBottom: 8, paddingLeft: 26 }}>{p.desc}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, paddingLeft: 26 }}>{p.skills} 技能 · {p.commands} 命令 · {p.mcps} MCP</div>
          </div>
        ))}
      </div>

      {/* 卸载确认框 */}
      {confirmUninstall && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmUninstall(null)}>
          <div style={{ width: 400, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 16 }}>
              确定卸载「{confirmUninstall.split('@')[0]}」？将删除插件文件并移除配置。
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmUninstall(null)} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}>取消</button>
              <button onClick={handleUninstall} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--danger, #e57373)', color: '#fff' }}>卸载</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 仓库 Tab ----

function MarketplacesTab() {
  const [q, setQ] = useState('')
  const [marketplaces, setMarketplaces] = useState<KnownMarketplace[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [detailEntry, setDetailEntry] = useState<{ entry: PluginMarketplaceEntry; marketplace: string; installed: boolean } | null>(null)
  const [refreshingName, setRefreshingName] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ name: string; cascaded: string[] } | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    window.api?.cc?.marketplaces.get().then(list => { setMarketplaces(list); setLoading(false) })
  }, [])
  useEffect(() => { reload() }, [reload])

  // 搜索：空输入时清空搜索结果，有关键词时跨仓库搜索
  useEffect(() => {
    if (!q.trim()) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    const timer = setTimeout(async () => {
      const results = await window.api?.cc?.marketplaces.search(q.trim())
      setSearchResults(results || [])
      setSearching(false)
    }, 300) // 防抖
    return () => clearTimeout(timer)
  }, [q])

  const handleRefresh = async (name: string) => {
    setRefreshingName(name)
    try { await window.api?.cc?.marketplaces.refresh(name) } catch {}
    setRefreshingName(null)
    reload()
  }
  const handleRefreshAll = async () => {
    for (const m of marketplaces) {
      setRefreshingName(m.source.source) // 用 source 作临时标记
      try { await window.api?.cc?.marketplaces.refresh((m as any).name) } catch {}
    }
    setRefreshingName(null)
    reload()
  }
  const handleRemove = async () => {
    if (!confirmRemove) return
    await window.api?.cc?.marketplaces.remove(confirmRemove.name)
    setConfirmRemove(null)
    reload()
  }
  const handleSetAutoUpdate = async (name: string, enabled: boolean) => {
    await window.api?.cc?.marketplaces.setAutoUpdate(name, enabled)
    reload()
  }

  const showSearch = q.trim().length > 0

  return (
    <div>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={primaryBtn} onClick={() => setShowAdd(true)}><Plus size={14} /> 添加仓库</button>
        <Tooltip label="刷新全部仓库">
          <button style={topIconBtn} onClick={handleRefreshAll}><RefreshCw size={14} /></button>
        </Tooltip>
      </div>

      {/* 搜索框（双重上下文） */}
      <input
        placeholder="搜索仓库或插件..."
        value={q} onChange={e => setQ(e.target.value)}
        style={inputStyle}
      />
      {showSearch && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          {searching ? '搜索中...' : `在 ${marketplaces.length} 个仓库中搜索，${searchResults.length} 个结果`}
        </div>
      )}

      {/* 搜索结果视图 */}
      {showSearch && !searching && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {searchResults.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>无匹配插件</div>}
          {searchResults.map((r, i) => (
            <PluginRow
              key={`${r.pluginName}@${r.marketplace}-${i}`}
              name={r.pluginName} version={r.version} desc={r.description}
              marketplaceName={r.marketplace}
              installed={r.installed}
              onDetail={async () => {
                const plugins = await window.api?.cc?.marketplaces.getPlugins(r.marketplace)
                const entry = plugins?.find((p: PluginMarketplaceEntry) => p.name === r.pluginName)
                if (entry) setDetailEntry({ entry, marketplace: r.marketplace, installed: r.installed })
              }}
              onInstalled={reload}
            />
          ))}
        </div>
      )}

      {/* 仓库列表视图（空搜索时） */}
      {!showSearch && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>加载中…</div>}
          {!loading && marketplaces.length === 0 && <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>尚未添加任何仓库</div>}
          {!loading && marketplaces.map((m, idx) => (
            <MarketplaceCard
              key={idx}
              mkt={m}
              expanded={expanded === `${idx}`}
              refreshing={refreshingName === m.source.source}
              onToggle={() => setExpanded(expanded === `${idx}` ? null : `${idx}`)}
              onRefresh={() => handleRefresh(m.source.source)}
              onRemove={async () => {
                // 获取级联插件列表用于确认框（先读已安装）
                setConfirmRemove({ name: m.source.source, cascaded: [] })
              }}
              onSetAutoUpdate={(en) => handleSetAutoUpdate(m.source.source, en)}
              onDetail={setDetailEntry}
            />
          ))}
        </div>
      )}

      {showAdd && <AddMarketplaceDialog onAdded={reload} onClose={() => setShowAdd(false)} />}

      {detailEntry && (
        <PluginDetailDialog
          entry={detailEntry.entry}
          marketplaceName={detailEntry.marketplace}
          installed={detailEntry.installed}
          onInstalled={reload}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {/* 删除仓库确认框 */}
      {confirmRemove && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmRemove(null)}>
          <div style={{ width: 420, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: 20, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--text)', fontSize: 13, marginBottom: 12 }}>
              确定删除仓库「{confirmRemove.name}」？
            </div>
            {confirmRemove.cascaded.length > 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
                将同时卸载从此仓库安装的 {confirmRemove.cascaded.length} 个插件：
                {confirmRemove.cascaded.map(p => <div key={p} style={{ paddingLeft: 12 }}>• {p}</div>)}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
                未发现从此仓库安装的插件。
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmRemove(null)} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}>取消</button>
              <button onClick={handleRemove} style={{ padding: '7px 18px', fontSize: 12, cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)', background: 'var(--danger, #e57373)', color: '#fff' }}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- 仓库卡片 ----

function MarketplaceCard({ mkt, expanded, refreshing, onToggle, onRefresh, onRemove, onSetAutoUpdate, onDetail }: {
  mkt: KnownMarketplace
  expanded: boolean
  refreshing: boolean
  onToggle: () => void
  onRefresh: () => void
  onRemove: () => void
  onSetAutoUpdate: (enabled: boolean) => void
  onDetail: (d: { entry: PluginMarketplaceEntry; marketplace: string; installed: boolean }) => void
}) {
  const [plugins, setPlugins] = useState<PluginMarketplaceEntry[]>([])
  const [loadingPlugins, setLoadingPlugins] = useState(false)
  const installedIds = useState<Set<string>>(new Set())[0]

  // 展开时加载插件列表
  useEffect(() => {
    if (!expanded || plugins.length > 0) return
    setLoadingPlugins(true)
    // 注意：KnownMarketplace 没有 name 字段，这里用 source.source 作临时标识——
    // 实际实现需要后端 getMarketplaces 返回包含 name 的结构。
    // 这是个待修正点：后端 getMarketplaces 应返回 name key。
    window.api?.cc?.marketplaces.getPlugins(mkt.source.source)
      .then(list => setPlugins(list || []))
      .catch(() => setPlugins([]))
      .finally(() => setLoadingPlugins(false))
  }, [expanded])

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', boxShadow: 'var(--shadow-float)' }}>
      {/* 卡片头 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer' }} onClick={onToggle}>
        <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{mkt.source.source}</span>
        <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{sourceBadge(mkt)}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
          <Tooltip label={mkt.autoUpdate ? '自动更新已开启' : '自动更新已关闭'}>
            <Toggle on={mkt.autoUpdate ?? false} onChange={onSetAutoUpdate} />
          </Tooltip>
          <Tooltip label="刷新">
            <button onClick={onRefresh} style={iconBtn}>
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            </button>
          </Tooltip>
          <Tooltip label="删除仓库">
            <button onClick={onRemove} style={iconBtn}><Trash2 size={14} /></button>
          </Tooltip>
        </span>
      </div>
      {/* 展开内容 */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            更新于 {mkt.lastUpdated ? new Date(mkt.lastUpdated).toLocaleString() : '未知'}
          </div>
          {loadingPlugins && <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 12 }}>加载插件列表...</div>}
          {!loadingPlugins && plugins.length === 0 && <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 12 }}>此仓库无插件</div>}
          {!loadingPlugins && plugins.map((entry, i) => (
            <PluginRow
              key={`${entry.name}-${i}`}
              name={entry.name} version={entry.version || 'unknown'} desc={entry.description || ''}
              marketplaceName={mkt.source.source}
              installed={installedIds.has(`${entry.name}@${mkt.source.source}`)}
              onDetail={() => onDetail({ entry, marketplace: mkt.source.source, installed: installedIds.has(`${entry.name}@${mkt.source.source}`) })}
              onInstalled={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ---- 插件行（搜索结果和仓库展开共用） ----

function PluginRow({ name, version, desc, marketplaceName, installed, onDetail, onInstalled }: {
  name: string
  version: string
  desc: string
  marketplaceName: string
  installed: boolean
  onDetail: () => void
  onInstalled: () => void
}) {
  const [nowInstalled, setNowInstalled] = useState(installed)
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await window.api?.cc?.plugins.install(`${name}@${marketplaceName}`)
      setNowInstalled(true)
      onInstalled()
    } catch {}
    setInstalling(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{name}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>v{version}</span>
          <span style={{ padding: '0px 6px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{marketplaceName}</span>
        </div>
        {desc && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Tooltip label="详情">
          <button onClick={onDetail} style={iconBtn}><FileText size={13} /></button>
        </Tooltip>
        {!nowInstalled ? (
          <Tooltip label="安装">
            <button onClick={handleInstall} disabled={installing} style={{ ...iconBtn, opacity: installing ? 0.5 : 1 }}>
              <Download size={13} />
            </button>
          </Tooltip>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>已安装</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无类型错误（注意：KnownMarketplace 缺 name 字段的问题在 Task 11 修正）

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/settings/PluginSettings.tsx
git commit -m "feat(ui): PluginSettings 重构为双 Tab + 仓库管理 + 跨仓库搜索"
```


---

## Task 11: PluginSettings.tsx 引用修正 + 删除确认框级联预览

Task 10 的 UI 代码中，仓库标识应使用 `mkt.name`（已知字段）。同时删除仓库的确认框需预览级联插件列表。

**Files:**
- Modify: `src/renderer/components/settings/PluginSettings.tsx`

- [ ] **Step 1: 确保 PluginSettings.tsx 使用 mkt.name**

Task 10 实现的 `MarketplaceCard` 和 `MarketplacesTab` 中，所有仓库操作（refresh / remove / setAutoUpdate / getPlugins / expanded key）都应使用 `mkt.name`，而非 `mkt.source.source`。

在 Task 10 完成后，逐一检查这些调用点，确保传给 `window.api.cc.marketplaces.*` 的 name 参数是 `mkt.name`：

- `handleRefresh(mkt.name)` 而非 `handleRefresh(mkt.source.source)`
- `onRemove` 回调里用 `mkt.name` 查级联插件
- `handleSetAutoUpdate(mkt.name, enabled)`
- `MarketplaceCard` 内 `useEffect` 里 `getPlugins(mkt.name)`
- 卡片标题显示 `mkt.name`，source badge 用 `sourceBadge(mkt)` 显示来源类型

- [ ] **Step 2: 删除确认框级联预览**

在 `MarketplacesTab` 的 `onRemove` 回调中，弹出确认框前先查已安装插件：

```typescript
onRemove={async () => {
  const installed = await window.api?.cc?.plugins.get()
  const cascaded = installed?.filter(p => p.id.endsWith(`@${mkt.name}`)).map(p => p.name) || []
  setConfirmRemove({ name: mkt.name, cascaded })
}}
```

- [ ] **Step 3: 验证编译 + 运行所有测试**

Run: `npx tsc --noEmit && npx vitest run tests/marketplace-manager.test.ts tests/plugin-install.test.ts`
Expected: 无类型错误 + 全部测试通过

- [ ] **Step 4: 提交**

```bash
git add src/renderer/components/settings/PluginSettings.tsx
git commit -m "fix(ui): 仓库操作使用 mkt.name，删除确认框预览级联插件"
```

---

## Task 12: 添加 spin 动画 CSS + 最终集成验证

**Files:**
- Modify: 项目的全局 CSS（找到现有 CSS 入口）

- [ ] **Step 1: 添加 spin 动画**

找到渲染端的全局 CSS 文件（可能是 `src/renderer/index.css` 或 `src/renderer/App.css`），追加：

```css
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin {
  animation: spin 1s linear infinite;
}
```

- [ ] **Step 2: 启动 dev server 验证完整功能**

Run: `npm run dev`

手动验证清单：
1. 设置 → 插件管理，看到双 Tab（已安装 / 仓库）
2. 已安装 Tab：现有插件列表正常显示，卸载按钮可点击
3. 仓库 Tab：空仓库时显示「尚未添加任何仓库」
4. 点击「添加仓库」，弹窗弹出，输入 `anthropics/claude-plugins`，看到「识别为：GitHub」badge
5. 点击添加，git clone 执行（可能需要网络），成功后仓库出现在列表
6. 点击仓库卡片展开，看到插件列表
7. 在搜索框输入关键词，视图切换为跨仓库搜索结果
8. 点击插件详情按钮，弹窗展示 manifest 信息
9. 点击安装按钮，插件安装成功
10. 切回已安装 Tab，看到新安装的插件

- [ ] **Step 3: 运行全部测试**

Run: `npx vitest run`
Expected: 全部测试通过（含已有的旧测试不回归）

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: 插件管理功能完整实现（仓库管理+安装/卸载+搜索+双Tab UI）"
```

