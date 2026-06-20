# MCP 管理增强设计

日期：2026-06-20
状态：已确认，待实现

## 目标

修复 MCP 管理的 JSON 编辑模式与标准格式不符、env 解析丢失、http 类型缺 headers 三个问题，并新增列表页 JSON 视图。

## 已确认的 Bug 与缺陷

1. **JSON 模式格式不符标准**：当前 JSON 模式展示的是渲染端扁平数据模型（`{name, transport, command, args(字符串), env(字符串), scope}`），而非真实落盘格式。用户无法对照标准格式（`{mcpServers: {name: {command, args:[], env:{}}}}`）填写或从官方文档粘贴。

2. **JSON 模式保存崩溃**（实测确认）：JSON 模式 `JSON.parse` 后直接 `onSave(obj)`，若用户按标准格式填（`args` 数组、`env` 对象），obj 原样传到后端 `buildMcpEntry`，触发 `s.args.trim is not a function`（数组无 trim）。env 同理（对象无 split）。这是"未正确解析为 key→value"的真实根因——两种模式用不同数据契约却共用同一写盘入口，无归一化。

3. **http 类型无 headers**：`buildMcpEntry` 对 http 只写 `{type:'http', url}`，headers 从未实现。表单 http 类型只有 URL 输入。

4. **列表页缺 JSON 视图**：仅有列表视图。

注：后端 `buildMcpEntry` 对**字符串形态**的 env/args 解析本身正确（实测 env 往返一致），bug 仅在 JSON 模式传入非字符串形态时触发。

## 设计

### 核心：统一数据契约（归一化）

所有问题的总根源：渲染端 `McpServer` 用字符串（`args: string, env: string`），标准 JSON 用数组/对象（`args: [], env: {}, headers: {}`），两种格式在 JSON 模式、表单、后端之间没有归一化。

修复方案：后端 `buildMcpEntry` 对 args/env 做防御性归一化——无论收到字符串还是数组/对象都能正确处理。一处归一化兜住所有入口。

### 改动点

#### 1. 后端归一化 + headers

`src/main/claude-config.ts`：

- `buildMcpEntry(s)`：
  - `args`：是数组则 `join(' ')`，是字符串则 `trim().split(/\s+/)`。
  - `env`：是对象则直用，是字符串则按 `KEY=VALUE` 行解析。
  - `headers`：新增。http 类型时，`s.headers`（字符串）按 `KEY: VALUE` 行解析成 headers 对象写入。
- `parseMcpEntry(name, raw, enabled)`：读回时把 `raw.headers` 对象转成 `KEY: VALUE` 行字符串。
- `ClaudeMcpServer` 加 `headers: string` 字段。

`src/main/settings-store.ts`、`src/renderer/types.ts`、`src/renderer/global.d.ts`：对应 `McpServer`/`ClaudeMcpServer` 加 `headers: string` 字段。

#### 2. JSON 模式改真实格式（McpEditDialog）

JSON 文本展示 `{ mcpServers: { [name]: { command, args:[], env:{}, headers?:{} } } }` 标准结构。

- 进入 JSON tab 时：用当前 draft 生成标准 JSON 文本（args 字符串 split 成数组、env/headers 字符串转成对象）。
- 保存时：解析 `mcpServers[name]` 单条，转成渲染端字段（args 数组 join、env/headers 对象转行字符串）后 `onSave`。解析失败提示格式错误，不保存。
- 表单修改后切回 JSON：同步重新生成标准 JSON 文本。

#### 3. 表单 headers 支持

http 类型时显示 headers 输入框，placeholder `Authorization: Bearer xxx\nContent-Type: application/json`，`KEY: VALUE` 冒号分隔。

#### 4. 列表页 JSON 视图（McpSettings）

顶部加「列表 / JSON」分段切换。

- JSON 视图展示完整 `mcpServers` 标准格式（可编辑）。
- 保存按钮：解析标准 JSON → 转成 server 数组 → `cc.mcp.save`。

### 分隔符约定

- env：`KEY=VALUE`（现有，不变）
- headers：`KEY: VALUE`（新增，贴合 HTTP 惯例）

两者分开，避免混淆。

### 往返一致性

读回 `parseMcpEntry`：env 对象 → `KEY=VALUE` 行，headers 对象 → `KEY: VALUE` 行。
写盘 `buildMcpEntry`：反向。表单和 JSON 两种入口都走同一后端归一化，保证无论从哪改都正确落盘。

## 测试

- 后端：扩展 `tests/claude-config-write.test.ts`，加 buildMcpEntry 归一化测试（args/env 字符串与数组/对象两种形态都正确落盘）、headers 往返、http 类型 headers 写盘。隔离 CLAUDE_CONFIG_DIR。
- 渲染端：扩展/新增测试覆盖 McpEditDialog JSON 模式标准格式双向同步、McpSettings 列表/JSON 视图切换。

## 不做的事

- 不新增独立 sse transport（http/sse 共用 headers，当前后端已把网络类统一为 http）。
- 不改列表视图的现有交互（增删改入口不变）。
