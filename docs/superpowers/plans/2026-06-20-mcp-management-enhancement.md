# MCP 管理增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 MCP 编辑的 JSON 模式崩溃与格式不符标准的问题，为 http 类型补 headers 支持，并在列表页新增可编辑 JSON 视图。

**Architecture:** 核心是后端 `buildMcpEntry` 归一化——对 args/env/headers 无论收到字符串还是数组/对象都能正确处理，一处兜住表单和 JSON 两个入口。渲染端 JSON 模式改为展示/编辑真实落盘格式（含 mcpServers 外层），表单与 JSON 双向同步。

**Tech Stack:** Electron IPC、React、TypeScript、Vitest（jsdom + 临时 CLAUDE_CONFIG_DIR 隔离）。

**参考设计：** [docs/superpowers/specs/2026-06-20-mcp-management-enhancement-design.md](../specs/2026-06-20-mcp-management-enhancement-design.md)

---

## 文件结构

- **修改** `src/main/claude-config.ts` — `ClaudeMcpServer` 加 headers 字段；`buildMcpEntry` 归一化 args/env/headers；`parseMcpEntry` 读回 headers。
- **修改** `src/main/settings-store.ts` — `McpServer`（settings-store 里的）加 headers 字段。
- **修改** `src/renderer/types.ts` — `McpServer` 加 headers 字段。
- **修改** `src/renderer/components/settings/McpEditDialog.tsx` — JSON 模式改真实格式；表单 http 加 headers 输入。
- **修改** `src/renderer/components/settings/McpSettings.tsx` — 顶部列表/JSON 视图切换 + JSON 视图可编辑。
- **修改** `tests/claude-config-write.test.ts` — buildMcpEntry 归一化 + headers 往返测试。

---

### Task 1: 后端归一化 + headers 字段

**Files:**
- Modify: `src/main/claude-config.ts`（ClaudeMcpServer 类型、buildMcpEntry、parseMcpEntry）
- Test: `tests/claude-config-write.test.ts`

- [ ] **Step 1: 写失败测试（归一化 + headers 往返）**

在 `tests/claude-config-write.test.ts` 的 MCP describe 块内（紧跟现有 saveMcpServers 用例之后）加：

```typescript
  it('buildMcpEntry 归一化：args/env 为数组/对象形态也正确落盘', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    // 模拟 JSON 模式传入标准格式形态（args 数组、env 对象）
    await mod.saveMcpServers([
      // 注：saveMcpServers 期望 ClaudeMcpServer，但 buildMcpEntry 内部归一化后正常落盘
      { id: 's', name: 's', transport: 'stdio', command: 'npx',
        args: '-y @playwright/mcp@latest' as any, env: 'API_KEY=secret\nNODE_ENV=prod',
        headers: '', enabled: true, scope: '用户' } as any,
    ])
    const data = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(data.mcpServers.s.args).toEqual(['-y', '@playwright/mcp@latest'])
    expect(data.mcpServers.s.env).toEqual({ API_KEY: 'secret', NODE_ENV: 'prod' })
  })

  it('http 类型 headers 写盘与往返', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    await mod.saveMcpServers([
      { id: 'h', name: 'h', transport: 'http', command: 'https://api.example.com',
        args: '', env: '', headers: 'Authorization: Bearer xxx\nContent-Type: application/json',
        enabled: true, scope: '用户' } as any,
    ])
    const data = await readJsonFile(join(fakeDir, '.claude.json'))
    expect(data.mcpServers.h.type).toBe('http')
    expect(data.mcpServers.h.url).toBe('https://api.example.com')
    expect(data.mcpServers.h.headers).toEqual({
      Authorization: 'Bearer xxx',
      'Content-Type': 'application/json',
    })
    // 往返读回：headers 对象 → KEY: VALUE 行字符串
    const back = await mod.getMcpServers()
    const h = back.find(s => s.name === 'h')!
    expect(h.transport).toBe('http')
    expect(h.headers).toBe('Authorization: Bearer xxx\nContent-Type: application/json')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/claude-config-write.test.ts`
Expected: FAIL（headers 字段不存在 / 落盘无 headers）。

- [ ] **Step 3: ClaudeMcpServer 加 headers 字段**

修改 `src/main/claude-config.ts` 的 `ClaudeMcpServer` 接口，在 `env` 之后加：

```typescript
  headers: string              // http 类型：KEY: VALUE 每行一个
```

- [ ] **Step 4: parseMcpEntry 读回 headers**

修改 `parseMcpEntry`（src/main/claude-config.ts），http 分支加 headers 读取：

```typescript
function parseMcpEntry(name: string, raw: any, enabled = true): ClaudeMcpServer {
  const isHttp = raw.type === 'http' || (!!raw.url && !raw.command)
  if (isHttp) {
    return {
      id: name, name, transport: 'http',
      command: raw.url || '',
      args: '', env: '',
      headers: raw.headers && typeof raw.headers === 'object'
        ? Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`).join('\n')
        : '',
      enabled, scope: '用户',
    }
  }
  return {
    id: name, name, transport: 'stdio',
    command: raw.command || '',
    args: Array.isArray(raw.args) ? raw.args.join(' ') : '',
    env: raw.env && typeof raw.env === 'object'
      ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join('\n')
      : '',
    headers: '',
    enabled, scope: '用户',
  }
}
```

- [ ] **Step 5: buildMcpEntry 归一化 + headers**

修改 `buildMcpEntry`（src/main/claude-config.ts）：

```typescript
// args 归一化：数组 join，字符串 split
function normalizeArgs(args: any): string[] {
  if (Array.isArray(args)) return args.map(String)
  if (typeof args === 'string') {
    const t = args.trim()
    return t ? t.split(/\s+/) : []
  }
  return []
}
// env 归一化：对象直用，字符串按 KEY=VALUE 解析
function normalizeEnv(env: any): Record<string, string> {
  if (env && typeof env === 'object') return env as Record<string, string>
  const obj: Record<string, string> = {}
  if (typeof env === 'string') {
    env.split('\n').forEach(line => {
      const i = line.indexOf('=')
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1)
    })
  }
  return obj
}
// headers 归一化：对象直用，字符串按 KEY: VALUE 解析
function normalizeHeaders(headers: any): Record<string, string> {
  if (headers && typeof headers === 'object') return headers as Record<string, string>
  const obj: Record<string, string> = {}
  if (typeof headers === 'string') {
    headers.split('\n').forEach(line => {
      const i = line.indexOf(':')
      if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    })
  }
  return obj
}

function buildMcpEntry(s: ClaudeMcpServer): Record<string, any> {
  if (s.transport === 'http') {
    const obj: any = { type: 'http', url: s.command }
    const headers = normalizeHeaders(s.headers)
    if (Object.keys(headers).length) obj.headers = headers
    return obj
  }
  const obj: any = { command: s.command }
  const args = normalizeArgs(s.args)
  if (args.length) obj.args = args
  const envObj = normalizeEnv(s.env)
  if (Object.keys(envObj).length) obj.env = envObj
  return obj
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/claude-config-write.test.ts`
Expected: PASS（含原有用例 + 2 个新用例）。

- [ ] **Step 7: 提交**

```bash
git add src/main/claude-config.ts tests/claude-config-write.test.ts
git commit -m "fix(mcp): buildMcpEntry 归一化 args/env/headers，修复 JSON 模式崩溃"
```

---

### Task 2: 渲染端 McpServer 类型加 headers

**Files:**
- Modify: `src/renderer/types.ts`
- Modify: `src/main/settings-store.ts`

- [ ] **Step 1: types.ts McpServer 加 headers**

修改 `src/renderer/types.ts` 的 `McpServer` 接口，在 `env` 之后加：

```typescript
  headers: string              // http 类型：KEY: VALUE 每行一个，可选
```

- [ ] **Step 2: settings-store.ts McpServer 加 headers**

修改 `src/main/settings-store.ts` 的 `McpServer` 接口（如果存在），同样在 env 后加 `headers: string`。

Run: `rg -n "interface McpServer" src/main/settings-store.ts` 确认是否存在；不存在则跳过此步。

- [ ] **Step 3: 修复现有构造缺 headers 的地方**

全仓搜索缺 headers 的 McpServer 字面量构造点：

Run: `rg -n "transport: 'stdio'" src/renderer/`

对每个命中处（如 McpSettings.tsx 的 addNew、McpEditDialog.tsx 的 draft 初始化），补 `headers: ''`（stdio）或确保 http 有 headers 字段。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -v "dataPath\|bump-version"`
Expected: 仅剩预先存在错误，无 headers 相关新错误（若有构造点缺字段会报错，按 Step 3 补齐）。

- [ ] **Step 5: 不单独提交，与 Task 3 合并（类型改动会让中间状态 tsc 报错）**

---

### Task 3: McpEditDialog JSON 模式改真实格式 + 表单 headers

**Files:**
- Modify: `src/renderer/components/settings/McpEditDialog.tsx`

- [ ] **Step 1: 抽取双向转换辅助函数**

在 `McpEditDialog.tsx` 顶部（组件外）加辅助函数：

```typescript
// 渲染端字段 → 标准落盘格式单条 server 对象
function serverToStdJSON(s: McpServer): Record<string, any> {
  if (s.transport === 'http') {
    const obj: any = { type: 'http', url: s.command }
    const headers = parseHeaderLines(s.headers)
    if (Object.keys(headers).length) obj.headers = headers
    return obj
  }
  const obj: any = { command: s.command }
  const args = s.args.trim() ? s.args.trim().split(/\s+/) : []
  if (args.length) obj.args = args
  const env = parseEnvLines(s.env)
  if (Object.keys(env).length) obj.env = env
  return obj
}
// 标准格式单条 server 对象 → 渲染端字段
function stdJSONToServer(name: string, raw: any): Partial<McpServer> {
  const isHttp = raw.type === 'http' || (!!raw.url && !raw.command)
  if (isHttp) {
    return {
      name, transport: 'http', command: raw.url || '',
      args: '', env: '',
      headers: raw.headers && typeof raw.headers === 'object'
        ? Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
    }
  }
  return {
    name, transport: 'stdio', command: raw.command || '',
    args: Array.isArray(raw.args) ? raw.args.join(' ') : '',
    env: raw.env && typeof raw.env === 'object'
      ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    headers: '',
  }
}
function parseEnvLines(env: string): Record<string, string> {
  const obj: Record<string, string> = {}
  env.split('\n').forEach(line => {
    const i = line.indexOf('=')
    if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1)
  })
  return obj
}
function parseHeaderLines(headers: string): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.split('\n').forEach(line => {
    const i = line.indexOf(':')
    if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  })
  return obj
}
```

- [ ] **Step 2: 改 jsonText 初始值 + tab 切换时重新生成**

把组件内的 jsonText 状态改为：进入 JSON tab 时用当前 draft 生成标准格式。

替换 jsonText 初始化和 tab 切换逻辑：

```typescript
  // 标准 JSON：完整 mcpServers 外层 + 单条 server
  const buildStdJsonText = (s: McpServer) =>
    JSON.stringify({ mcpServers: { [s.name]: serverToStdJSON(s) } }, null, 2)

  const [jsonText, setJsonText] = useState(() => buildStdJsonText(server))
  const [jsonError, setJsonError] = useState<string | null>(null)
```

tab 切换到 json 时刷新：

```typescript
  // 切到 JSON tab 时用最新 draft 重新生成标准格式
  const onTabChange = (t: 'form' | 'json') => {
    setTab(t)
    if (t === 'json') { setJsonText(buildStdJsonText(draft)); setJsonError(null) }
  }
```

把两个 tab 按钮 onClick 从 `() => setTab('form')` / `() => setTab('json')` 改为 `() => onTabChange('form')` / `() => onTabChange('json')`。

- [ ] **Step 3: 改 save 函数 JSON 分支**

替换 save 函数：

```typescript
  const save = () => {
    if (tab === 'json') {
      try {
        const parsed = JSON.parse(jsonText)
        const mcpServers = parsed.mcpServers || parsed
        // 取第一个 server 条目（编辑的是单条）
        const entries = Object.entries(mcpServers)
        if (entries.length === 0) { setJsonError('JSON 中无 mcpServers 条目'); return }
        const [name, raw] = entries[0]
        const fields = stdJSONToServer(name, raw)
        onSave(fields)
      } catch (e) {
        setJsonError('JSON 格式错误：' + (e instanceof Error ? e.message : String(e)))
        return
      }
      return
    }
    onSave({
      name: draft.name, transport: draft.transport, command: draft.command,
      args: draft.args, env: draft.env, headers: draft.headers, scope: draft.scope
    })
  }
```

- [ ] **Step 4: JSON 文本区显示错误提示**

在 JSON 模式的 textarea 上方/下方加 jsonError 提示（替换原"配置 JSON"区域）：

```typescript
            <>
              <div style={fieldLabel}>配置 JSON（标准格式，含 mcpServers 外层）</div>
              <textarea
                value={jsonText}
                onChange={e => { setJsonText(e.target.value); setJsonError(null) }}
                style={{ ...inputStyle, minHeight: 280, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
              />
              {jsonError && (
                <div style={{ marginTop: 6, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{jsonError}</div>
              )}
            </>
```

- [ ] **Step 5: 表单 draft 初始化加 headers**

修改 draft 初始化，确保 headers 字段存在：

```typescript
  const [draft, setDraft] = useState<McpServer>({ ...server, headers: server.headers ?? '' })
```

- [ ] **Step 6: 表单 http 类型加 headers 输入框**

在 http 分支（URL 输入框之后）加 headers 输入：

```typescript
              ) : (
                <>
                  <div style={fieldLabel}>URL</div>
                  <input value={draft.command} onChange={e => patch({ command: e.target.value })} placeholder="https://..." style={inputStyle} />
                  <div style={fieldLabel}>Headers（KEY: VALUE 每行一个，可选）</div>
                  <textarea
                    value={draft.headers}
                    onChange={e => patch({ headers: e.target.value })}
                    placeholder={'Authorization: Bearer xxx\nContent-Type: application/json'}
                    style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
                  />
                </>
              )}
```

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -v "dataPath\|bump-version"`
Expected: 无 headers 相关错误。

- [ ] **Step 8: 提交（Task 2 + Task 3 合并）**

```bash
git add src/renderer/types.ts src/main/settings-store.ts src/renderer/components/settings/McpEditDialog.tsx
git commit -m "feat(mcp): JSON 模式改标准格式 + http headers 支持 + 双向同步"
```

---

### Task 4: 列表页 JSON 视图

**Files:**
- Modify: `src/renderer/components/settings/McpSettings.tsx`

- [ ] **Step 1: 加视图切换状态**

在 McpSettings 组件内加视图状态：

```typescript
  const [view, setView] = useState<'list' | 'json'>('list')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
```

servers 加载后生成 jsonText：在 reload 的 then 回调里，或用一个 effect 同步。在 `reload` 改为：

```typescript
  const reload = () => {
    setLoading(true)
    window.api?.cc?.mcp.get().then(list => {
      setServers(list)
      setJsonText(buildAllJson(list))
      setLoading(false)
    })
  }
```

加组件外辅助函数（同 McpEditDialog 的转换逻辑，复用思路）：

```typescript
// 全部 servers → 标准 mcpServers JSON 文本
function buildAllJson(servers: ClaudeMcpServer[]): string {
  const mcpServers: Record<string, any> = {}
  for (const s of servers) {
    mcpServers[s.name] = serverEntryToStd(s)
  }
  return JSON.stringify({ mcpServers }, null, 2)
}
// 单条 server → 标准落盘对象（与后端 buildMcpEntry 同构，渲染端复制此逻辑用于 JSON 展示）
function serverEntryToStd(s: ClaudeMcpServer): Record<string, any> {
  if (s.transport === 'http') {
    const obj: any = { type: 'http', url: s.command }
    const headers = parseColonLines(s.headers)
    if (Object.keys(headers).length) obj.headers = headers
    return obj
  }
  const obj: any = { command: s.command }
  const args = s.args.trim() ? s.args.trim().split(/\s+/) : []
  if (args.length) obj.args = args
  const env = parseEqLines(s.env)
  if (Object.keys(env).length) obj.env = env
  return obj
}
function parseColonLines(text: string): Record<string, string> {
  const obj: Record<string, string> = {}
  ;(text || '').split('\n').forEach(line => {
    const i = line.indexOf(':')
    if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  })
  return obj
}
function parseEqLines(text: string): Record<string, string> {
  const obj: Record<string, string> = {}
  ;(text || '').split('\n').forEach(line => {
    const i = line.indexOf('=')
    if (i > 0) obj[line.slice(0, i).trim()] = line.slice(i + 1)
  })
  return obj
}
```

- [ ] **Step 2: 顶部加视图切换分段控件**

在标题行下方（desc 之后、搜索框之前）加分段切换。仅 list 视图显示搜索框。

```typescript
      {/* 视图切换 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        <button onClick={() => setView('list')} style={segBtn(view === 'list')}>列表</button>
        <button onClick={() => { setView('json'); setJsonError(null) }} style={segBtn(view === 'json')}>JSON</button>
      </div>
```

加组件外 segBtn 样式：

```typescript
const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? 'var(--accent-text)' : 'var(--text-muted)',
  marginRight: 4,
})
```

- [ ] **Step 3: JSON 视图渲染 + 保存**

把搜索框和列表包进 `{view === 'list' && (...)}`，新增 `{view === 'json' && (...)}` 块：

```typescript
      {view === 'list' && (
        <>
          {/* 搜索框 */}
          <input ... />
          {/* 计数 + 列表 */}
          ...
        </>
      )}

      {view === 'json' && (
        <>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setJsonError(null) }}
            style={{ width: '100%', minHeight: 360, padding: '10px', background: 'var(--bg-sidebar)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)',
              fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', resize: 'vertical' }}
          />
          {jsonError && (
            <div style={{ marginTop: 6, color: 'var(--danger, #dc2626)', fontSize: 12 }}>{jsonError}</div>
          )}
          <div style={{ marginTop: 10 }}>
            <button onClick={saveJson} style={{
              padding: '7px 18px', fontSize: 12, cursor: 'pointer',
              border: 'none', borderRadius: 'var(--radius)',
              background: 'var(--accent)', color: 'var(--accent-text)'
            }}>保存</button>
          </div>
        </>
      )}
```

- [ ] **Step 4: saveJson 实现**

在组件内加：

```typescript
  // JSON 视图保存：解析标准 JSON → server 数组 → cc.mcp.save
  const saveJson = () => {
    try {
      const parsed = JSON.parse(jsonText)
      const entries = Object.entries(parsed.mcpServers || {})
      const next: ClaudeMcpServer[] = entries.map(([name, raw]: [string, any]) => {
        const isHttp = raw.type === 'http' || (!!raw.url && !raw.command)
        // 保留原 server 的 id/enabled/scope（用 name 匹配）
        const existing = servers.find(s => s.name === name)
        if (isHttp) {
          return {
            id: name, name, transport: 'http', command: raw.url || '',
            args: '', env: '',
            headers: raw.headers && typeof raw.headers === 'object'
              ? Object.entries(raw.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '',
            enabled: existing?.enabled ?? true, scope: existing?.scope ?? '用户',
          }
        }
        return {
          id: name, name, transport: 'stdio', command: raw.command || '',
          args: Array.isArray(raw.args) ? raw.args.join(' ') : '',
          env: raw.env && typeof raw.env === 'object'
            ? Object.entries(raw.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
          headers: '',
          enabled: existing?.enabled ?? true, scope: existing?.scope ?? '用户',
        }
      })
      persist(next)
      setJsonText(buildAllJson(next))
    } catch (e) {
      setJsonError('JSON 格式错误：' + (e instanceof Error ? e.message : String(e)))
    }
  }
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -v "dataPath\|bump-version"`
Expected: 无新错误。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/settings/McpSettings.tsx
git commit -m "feat(mcp): 列表页新增可编辑 JSON 视图，支持标准格式整段粘贴"
```

---

### Task 5: 全量验证

**Files:** 无修改，仅验证

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 全部通过。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit 2>&1 | grep -v "dataPath\|bump-version"`
Expected: 无新增错误。

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 4（可选）：dev 手测**

Run: `pnpm dev`
验证：
- MCP 设置 → 编辑 → JSON tab：展示 `{mcpServers:{...}}` 标准格式，含 args 数组/env 对象。
- 从官方文档粘贴标准配置 → 保存 → 不崩溃 → 切回表单字段正确同步。
- http 类型表单出现 Headers 输入框，填 `Authorization: Bearer xxx` → 保存 → `cat ~/.cc-desk/claude/.claude.json` 确认 headers 对象落盘。
- 列表页切换 JSON 视图 → 可编辑整段 → 保存 → 切回列表反映改动。
