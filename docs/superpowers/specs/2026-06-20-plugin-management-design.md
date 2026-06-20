# 插件管理功能设计

> 完整还原 Claude 的插件管理：插件仓库(marketplace)管理 + 通过仓库安装/卸载插件 + 跨仓库插件搜索。

## 背景

cc-desk 当前的插件设置页（`PluginSettings.tsx`）仅有插件列表 + 启停 Toggle（读写 `settings.json` 的 `enabledPlugins`），没有仓库管理和安装/卸载能力。

Claude CLI 的插件系统由三层构成：仓库层（known_marketplaces.json + marketplaces/ 缓存）、安装层（installed_plugins.json + cache/ versioned 目录）、运行时层（SDK 通过 CLAUDE_CONFIG_DIR 自动发现）。cc-desk 只需正确维护前两层的磁盘文件，SDK（通过 `CLAUDE_CONFIG_DIR = ~/.cc-desk/claude`）会自动加载，无需在 `claude-service.ts` 里传 `plugins:` option。

## 配置目录

所有操作均在 `CLAUDE_CONFIG_DIR`（`~/.cc-desk/claude`）下，不触碰 `~/.claude`。

```
~/.cc-desk/claude/plugins/
├── known_marketplaces.json      # 已注册仓库（name → source + installLocation + lastUpdated + autoUpdate）
├── installed_plugins.json       # 已安装插件（plugin@marketplace → [{scope, installPath, version}]）
├── marketplaces/                # 仓库缓存（git clone 目录 或 url 单文件）
│   ├── claude-plugins-official/ # github 仓库克隆
│   └── my-company.json          # url 仓库单文件
└── cache/                       # 已安装插件 versioned cache
    └── <marketplace>/<plugin>/<version>/
```

## 后端设计

### 新建 `src/main/marketplace-manager.ts`

#### 类型定义

```typescript
type MarketplaceSource =
  | { source: 'github'; repo: string; ref?: string }
  | { source: 'git'; url: string; ref?: string }
  | { source: 'url'; url: string; headers?: Record<string, string> }
  | { source: 'file'; path: string }
  | { source: 'directory'; path: string }

interface KnownMarketplace {
  source: MarketplaceSource
  installLocation: string
  lastUpdated: string
  autoUpdate?: boolean
}

interface PluginMarketplace {
  name: string
  owner: { name: string; email?: string; url?: string }
  plugins: PluginMarketplaceEntry[]
}

interface PluginMarketplaceEntry {
  name: string
  description?: string
  version?: string
  source: string | object    // 本地 './xxx' 或远程对象
  category?: string
  tags?: string[]
}

interface SearchResult {
  pluginName: string
  marketplace: string
  version: string
  description: string
  category?: string
  tags?: string[]
  installed: boolean
}
```

#### 核心函数

`parseSource(input: string): MarketplaceSource` — 智能识别：
- 含 `/` 且无 `://` 且无空格 → github（`owner/repo`）
- `github.com/owner/repo` → github（提取 repo）
- `git@github.com:owner/repo` → github
- 其他 `git@` 或 `.git` 结尾的 URL → git
- `http(s)://` 且非 git → url
- 以 `.json` 结尾或 stat 为文件 → file
- stat 为目录 → directory

`addMarketplace(source, { autoUpdate }): { name, alreadyExists }` — 克隆/下载到 `marketplaces/<name>`，校验 marketplace.json，写 known_marketplaces.json。source 幂等。

`removeMarketplace(name): { cascadedPlugins: string[] }` — 删条目 + 清理缓存 + 级联移除 enabledPlugins 里 `@<name>` 后缀的条目 + installed_plugins.json 对应条目。

`refreshMarketplace(name)` — 按类型刷新：github/git 走 git pull（120s 超时），url 重新下载，file/directory 重新校验。更新 lastUpdated。

`refreshAllMarketplaces()` — 串行刷新所有非 seed、非 settings-sourced 仓库。

`getMarketplaces(): KnownMarketplace[]` — 读 known_marketplaces.json。

`getMarketplacePlugins(name): PluginMarketplaceEntry[]` — 读 marketplace.json。

`searchMarketplacePlugins(query: string): SearchResult[]` — 遍历所有仓库的 marketplace.json，匹配 name/description/category/tags。

`setMarketplaceAutoUpdate(name, enabled)` — 切换 autoUpdate 标记。

#### git 操作

github 来源默认 HTTPS，失败提示用户可用 SSH。不实现 Claude 的完整 SSH/HTTPS 自动探测回退（`isGitHubSshLikelyConfigured`），保持简化。git 命令设 120s 超时。

### 扩展 `src/main/claude-config.ts`

#### installPlugin(pluginId): { success, message }

pluginId 格式 `plugin@marketplace`：
1. 从 known_marketplaces.json 找 marketplace 的 installLocation
2. 读 marketplace.json，找 `name === pluginName` 的 entry
3. 判断 entry.source 类型：
   - 本地相对路径（`./` 开头，相对 marketplace 目录）→ 源路径 = `join(marketplaceDir, entry.source)`
   - 远程对象（github/git/url 等）→ 当前版本暂不支持，返回错误提示
4. 读 manifest（`<sourcePath>/.claude-plugin/plugin.json`）获取 version
5. versioned cache 路径：`CLAUDE_DIR/plugins/cache/<marketplace>/<plugin>/<version>/`
6. 拷贝插件文件到 versioned cache
7. 写 installed_plugins.json：追加 `{ scope: 'user', installPath, version }`
8. 写 settings.json：`enabledPlugins[pluginId] = true`

#### uninstallPlugin(pluginId): { success, message }

1. 读 installed_plugins.json 找安装记录
2. 删除 versioned cache 目录（若无其他安装引用）
3. 从 installed_plugins.json 移除条目
4. 从 settings.json enabledPlugins 移除 key（整对象替换确保删除生效）

#### 远程 source 插件说明

完整远程插件 source 支持（npm/git-subdir/pip/MCPB）逻辑极重。实际 marketplace 里 99% 的插件 source 是本地相对路径（`./xxx`），指向仓库内子目录。本实现聚焦本地相对路径 source。日后可扩展。

### 启动自动刷新

应用初始化阶段（`ensureClaudeConfigDir()` 之后）新增 `refreshAutoUpdateMarketplaces()`：
- 遍历 known_marketplaces.json，对 `autoUpdate === true` 的仓库逐个 refresh
- 串行执行，每个仓库超时 30s
- 失败静默跳过（不阻塞应用启动，记日志）
- 异步执行（不 await），窗口加载不受阻

## 前端设计

### 页面结构（重构 PluginSettings.tsx）

双 Tab 布局，居中风格（`maxWidth: 760, margin: 0 auto`）：

```
插件管理（标题 + 刷新按钮）
├── Tab 栏：[已安装(N)]  [仓库(M)]
│
├── Tab「已安装」
│   ├── 搜索框
│   └── 插件卡片列表（现有样式 + 新增卸载按钮）
│
└── Tab「仓库」
    ├── 顶部栏：[添加仓库]  [刷新全部]
    ├── 搜索框（双重上下文）
    └── 内容区
        ├── 空输入：仓库折叠卡片列表
        └── 有关键词：跨仓库搜索结果列表
```

### Tab 切换

轻量自建 segmented control，样式与 MCP 管理页的列表/JSON 切换一致。Tab 切换保持组件 state。

### 已安装 Tab

现有插件卡片右上角，Toggle 左侧加卸载图标按钮（Trash2，lucide）+ Tooltip「卸载」。点击弹确认框（「确定卸载 xxx？将删除插件文件并移除配置」），确认后调 `uninstallPlugin`，刷新列表。

### 仓库 Tab — 搜索框双重上下文

- 空输入：显示仓库列表（折叠卡片）
- 输入关键词：切换为跨仓库搜索结果，提示「在 N 个仓库中搜索」

placeholder：`搜索仓库或插件...`

### 仓库 Tab — 仓库卡片

收起态：仓库名 + 来源类型 badge + autoUpdate 开关 + 刷新按钮 + 删除按钮

展开态（点击卡片头）：
- 来源详情 + lastUpdated + autoUpdate toggle + 刷新/删除按钮
- 插件目录（调 `getMarketplacePlugins`），每个插件行：名称 + 版本 + 简述 + 技能/命令/MCP 统计 + [详情][安装] 按钮
- 已安装插件显示「已安装」灰色标记，不显示安装按钮

### 搜索结果行

```
plugin-name     v1.2    [claude-plugins-official]
描述...
                        [详情] [安装]
```

样式与仓库展开内的插件行一致。

### AddMarketplaceDialog

智能输入框 + 实时识别结果 badge + 高级折叠区（来源类型手动覆盖 + ref + autoUpdate 复选框默认勾选）。

添加中 loading 状态（git clone 耗时），成功关闭刷新列表，失败显示错误。

### PluginDetailDialog

结构化展示（非编辑器）：
- 插件名 + 版本
- 描述全文 + 作者/许可证/仓库
- 提供的能力：技能(N)、命令(N)、MCP(N)
- [取消] [安装] 按钮

### 删除仓库确认框

```
确定删除仓库「xxx」？
将同时卸载从此仓库安装的 N 个插件：
  • plugin-a
  • plugin-b
              [取消] [删除]
```

## IPC 通道

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
plugins: {
  get(): Promise<ClaudePlugin[]>                              // 已有
  setEnabled(id: string, enabled: boolean): Promise<void>     // 已有
  install(pluginId: string): Promise<{ success: boolean; message: string }>
  uninstall(pluginId: string): Promise<{ success: boolean; message: string }>
}
```

main 进程 handler：`cc:marketplace:get` / `:get-plugins` / `:search` / `:add` / `:remove` / `:refresh` / `:refresh-all` / `:set-auto-update` + `cc:plugin:install` / `:uninstall`。

## 测试策略

所有主进程测试隔离 `CLAUDE_CONFIG_DIR`（`os.tmpdir()` + `vi.resetModules()`）。

### marketplace-manager.test.ts

- `parseSource`：五种输入正确识别
- `addMarketplace`：url/file/directory 添加成功；source 幂等；marketplace.json 校验失败报错
- `removeMarketplace`：删除条目 + 清理缓存 + 级联移除 enabledPlugins
- `refreshMarketplace`：file/directory 类型刷新；git/url 类型 mock 验证调用参数
- `searchMarketplacePlugins`：多仓库关键词匹配、已安装标记

### plugin-install.test.ts

- `installPlugin`：本地相对路径 source 安装成功；重复安装幂等
- `uninstallPlugin`：删除 cache + 移除 installed_plugins.json + 移除 enabledPlugins

tsx 多个 `vi.mock` 有 oxc 解析 bug，必要时拆独立文件。

前端组件手动验证为主。

## 风险与缓解

1. **git clone 超时**：设 120s 超时，超时报清晰错误提示重试
2. **SSH/HTTPS**：默认 HTTPS，失败提示可用 SSH（不实现完整自动探测）
3. **marketplace.json 格式差异**：解析宽容，缺可选字段不报错，只要求 name + plugins
4. **并发写入**：读-改-写串行化，不引入文件锁
