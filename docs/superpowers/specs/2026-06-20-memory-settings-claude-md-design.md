# 记忆设置（CLAUDE.md 编辑器）设计

日期：2026-06-20
状态：已确认，待实现

## 目标

在设置页新增「记忆」子页，让用户直接编辑 cc-desk 的全局 `CLAUDE.md` 记忆文件，无需手动定位文件或切到外部编辑器。

## 目标文件路径

`~/.cc-desk/claude/CLAUDE.md`，即 [paths.ts](../../src/main/paths.ts) 中 `CLAUDE_CONFIG_DIR` 下的 `CLAUDE.md`。

选择此路径的理由：cc-desk 运行时使用隔离配置目录 `~/.cc-desk/claude`，SDK 在所有项目会话中读取该目录下的 `CLAUDE.md` 作为全局记忆。编辑这个文件与运行时实际生效范围完全一致，不与本机原生 `~/.claude/CLAUDE.md`（cc-desk 不读取）混淆。

## 编辑器选择

复用 Monaco（`@monaco-editor/react`），language = markdown，主题走现有 `monacoThemeFor`。与 FileTab 的代码编辑体验一致，提供语法高亮。

不采用：
- 实时预览分栏：CLAUDE.md 是写给 Claude 的指令，纯编辑场景，分栏会挤占设置页空间。
- 纯 textarea：丢失语法高亮，与项目现有风格不统一。

## 自动保存策略

防抖 + 失焦兜底，对齐 cc-desk 现有 `projects:save` 的防抖模式。

- `onChange`：清掉上一个定时器，重设 1.2s 定时器；状态标「未保存」。
- 定时器触发：调用 save，状态标「已保存」。
- 组件卸载 / 编辑器失焦（onBlur）：若有未保存内容，立即 flush 保存。

好处：不频繁写盘，切走菜单时内容不丢。

## 改动点

### 1. 类型

[src/renderer/types.ts](../../src/renderer/types.ts)：`SettingsSection` 末尾加 `'memory'`。

### 2. 菜单

[src/renderer/components/settings/SettingsMenu.tsx](../../src/renderer/components/settings/SettingsMenu.tsx)：`ITEMS` 数组在 `model` 之后插入 `{ id: 'memory', labelKey: 'settings.memory' }`。

### 3. 路由

[src/renderer/components/settings/SettingsPage.tsx](../../src/renderer/components/settings/SettingsPage.tsx)：switch 加 `case 'memory': return <MemorySettings />`。

### 4. IPC

[src/preload/index.ts](../../src/preload/index.ts)：`cc` 命名空间下加：
```ts
memory: {
  get: () => ipcRenderer.invoke('cc:memory:get'),
  save: (content: string) => ipcRenderer.invoke('cc:memory:save', content),
},
```

主进程新增 handler：
- `cc:memory:get`：拼 `join(CLAUDE_CONFIG_DIR, 'CLAUDE.md')`，文件存在返回内容字符串，不存在返回空串（不报错）。
- `cc:memory:save`：写入同一路径，目录已存在（ensureClaudeConfigDir 保证），无需额外 mkdir。

### 5. 编辑器组件

新增 `src/renderer/components/settings/MemorySettings.tsx`：
- 进页面时 `cc.memory.get()` 拉取内容填充 Monaco。
- `onChange` 防抖 1.2s 调 `cc.memory.save`，`onBlur` 兜底 flush。
- 标题处一个轻量状态指示：「已保存 / 保存中 / 未保存」，保存成功后回显「已保存」。
- Monaco：language=markdown，theme=`monacoThemeFor(state.theme)`，高度自适应填满容器。

### 6. i18n

[src/renderer/i18n/index.ts](../../src/renderer/i18n/index.ts)：`settings.memory` 加 zh-CN「记忆」/ en「Memory」。

## 文件不存在的处理

首次进入时文件不存在，get 返回空串，用户首次保存时自动创建文件。不加预设模板内容，避免污染用户的空白记忆。

## 测试

- 渲染端：复用 [tests/settings-pages.test.tsx](../../tests/settings-pages.test.tsx) 模式，加用例验证 `activeSettingsSection === 'memory'` 时渲染 MemorySettings。
- 主进程：读写走隔离 `CLAUDE_CONFIG_DIR`，用 `os.tmpdir()` + `vi.resetModules()`，符合 CLAUDE.md 测试约定，不写真机 `~/.claude`。

## 不做的事

- 不加预设模板/示例内容。
- 不加 markdown 实时预览。
- 不处理项目级 `./CLAUDE.md`（那是会话/工作区上下文，不属于全局设置）。
- 不改其他设置子页。
