# 命令管理 Tab 视图设计

> 设置 → 命令管理重构为三 Tab（自定义 / 插件 / 内置），自定义命令支持完整 CRUD。

## 背景

当前命令管理页（`CommandSettings.tsx`）用 `EntryListSection` 平铺展示所有命令，不分来源、只读、无增删改能力。`getCommands()` 已返回 `source` 字段（`builtin` / 插件名 / `user`）和 `kind` 字段（`builtin` / `command`），足以按来源分类。

## 数据来源

命令文件全部在 `~/.cc-desk/claude/` 下：
- **自定义**：`~/.cc-desk/claude/commands/*.md`（用户创建，可增删改）
- **插件**：各已启用插件的 `installPath/commands/*.md`（只读，可查看详情）
- **内置**：`BUILTIN_COMMANDS` 静态注册表（只读，可查看描述 + builtinAction）

命令 `.md` 格式：
```markdown
---
description: 命令描述
---

命令的 prompt 内容...
```

## 后端设计

扩展 `src/main/claude-config.ts`，新增四个函数：

### createCommand(name, description): { success, message }

创建 `~/.cc-desk/claude/commands/<name>.md`，frontmatter 预填 description，body 留空。
- name 校验：仅小写字母、数字、连字符（`^[a-z0-9-]+$`）
- 不能与已有自定义命令重名
- 创建后默认启用（SDK 自动扫描 commands/ 目录）

### getCommandFile(source, name): string

读取命令 `.md` 全文：
- source 为 `user`：读 `~/.cc-desk/claude/commands/<name>.md`
- source 为插件名：从 `getPlugins()` 找 `installPath`，读 `installPath/commands/<name>.md`
- source 为 `builtin`：返回空串（无文件，前端特殊处理）
- 找不到返回空串

### saveCommandFile(name, content): void

写回 `~/.cc-desk/claude/commands/<name>.md`，仅自定义命令。

### deleteCommand(name): void

删除 `~/.cc-desk/claude/commands/<name>.md`，仅自定义命令。

### IPC 通道

```typescript
commands: {
  get(): Promise<ClaudeCommand[]>                                              // 已有
  create(name: string, description: string): Promise<{ success: boolean; message: string }>
  getFile(source: string, name: string): Promise<string>
  saveFile(name: string, content: string): Promise<void>
  delete(name: string): Promise<void>
}
```

main 进程 handler：`cc:command:create` / `cc:command:get-file` / `cc:command:save` / `cc:command:delete`。

## 前端设计

### 页面结构

```
命令管理（标题）
├── Tab 栏：[自定义(N)]  [插件(M)]  [内置(K)]
│
├── Tab「自定义」
│   ├── 顶部栏：[新建命令] 按钮
│   ├── 搜索框
│   └── 命令列表（editable 模式）
│       每行：/name + 描述 + [编辑] [删除]
│
├── Tab「插件」
│   ├── 搜索框
│   └── 命令列表（readonly 模式）
│       每行：/name + 描述 + 来源 badge + [详情]
│
└── Tab「内置」
    ├── 搜索框
    └── 命令列表（readonly 模式）
        每行：/name + 描述 + [详情]
```

Tab 切换复用插件管理页的 segmented control 样式（segBtn）。

### 组件清单

- `CommandSettings.tsx`：主容器，三 Tab + 数据加载 + Tab badge 计数
- `CreateCommandDialog.tsx`：新建命令弹窗（名称 + 描述输入）
- `CommandEditModal.tsx`：命令编辑/查看弹窗（Monaco，复用技能弹窗模式）

三 Tab 的列表用同一个 `CommandList` 渲染函数，按 mode 区分行为。

### CommandList 渲染逻辑

```typescript
function CommandList({ commands, mode, onEdit, onDelete }: {
  commands: ClaudeCommand[]
  mode: 'editable' | 'readonly'
  onEdit: (cmd: ClaudeCommand) => void
  onDelete?: (cmd: ClaudeCommand) => void
})
```

- `editable`：每行右侧 [编辑]（Pencil）+ [删除]（Trash2）
- `readonly`：每行右侧 [详情]（FileText）
- 搜索框过滤命令名和描述

### 新建命令弹窗

名称输入框（校验 `^[a-z0-9-]+$`，实时提示格式错误/重名）+ 描述输入框。创建成功后关闭弹窗、刷新列表、自动打开编辑弹窗让用户立即写内容。

### 命令编辑/查看弹窗

复用 `SkillModal` 模式：Monaco 编辑器 + 防抖 1.2s 自动保存 + 失焦兜底 + 保存按钮。
- 自定义命令：可编辑（Monaco 正常模式）
- 插件命令：只读（Monaco readOnly，展示 `.md` 全文）
- 内置命令：只读弹窗展示描述 + builtinAction 类型文本（无 Monaco）

### 删除确认框

复用插件卸载确认框样式：「确定删除 /my-command？此操作不可撤销。」+ [取消] [删除]。

### Tab badge 计数

每个 Tab 标签显示该分类命令数（如 `自定义(3)`），数据来自 `getCommands()` 的 source 字段分组。

## 测试策略

所有主进程测试隔离 `CLAUDE_CONFIG_DIR`（`os.tmpdir()` + `vi.resetModules()`）。

### claude-config 命令 CRUD 测试

- `createCommand`：创建成功（文件存在 + frontmatter 正确）；重名报错；非法 name 报错
- `getCommandFile`：自定义命令读取成功；插件命令读取成功（构造临时插件目录）；builtin 返回空串
- `saveCommandFile`：写回成功（内容一致）
- `deleteCommand`：删除成功（文件不存在）

### 前端组件

更新 `tests/settings-pages.test.tsx` 的命令测试，适配三 Tab 结构 + mock 新 IPC。

## 风险与缓解

1. **插件命令路径查找**：`getCommandFile` 需从插件名找 `installPath`，依赖 `getPlugins()` 返回正确的安装路径。找不到时返回空串容错。
2. **命令文件 frontmatter 解析**：创建时预填标准 frontmatter，编辑时 Monaco 直接操作原始文本，不做结构化解析（与技能编辑一致）。
3. **Tab 切换不丢状态**：用条件渲染但保持各 Tab 的搜索框 state 在父组件，切换不丢失搜索词。
