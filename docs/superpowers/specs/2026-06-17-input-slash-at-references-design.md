# 对话区输入框 `/` `@` 引用能力 · 设计文档

日期：2026-06-17
状态：已确认（待实现）

## Context（背景与动机）

cc-desk 的对话输入框（`src/renderer/components/InputBar.tsx`）当前是个受控 `<textarea>`，draft 只有 `{ text, attachment? }`，附件仅支持拾取的网页元素。底部「`@` `#` `/`」三个按钮是纯占位（点击只关闭菜单，无任何动作）。

目标：实现 Claude Code 的核心输入能力——

- **`/` 引用命令、技能**：输入 `/` 弹出命令 + 技能菜单，选中后插入
- **`@` 引用文件**：输入 `@` 弹出文件菜单（实时过滤、目录导航），选中后插入文件引用
- **粘贴/拖拽图片与文件**：作为附件

### 现状（已就绪的后端能力）

- `src/main/claude-config.ts` 已能扫描 skills（name/desc/enabled/source）、commands（`/name`/desc）、文件树。`getSkills()` / `getCommands()` 已实现。
- preload 已暴露 `window.api.cc.skills.get()` / `cc.commands.get()` / `fs.readTree` / `fs.readFile`。
- `src/main/claude-service.ts` 的 `query()` 直接吃 `prompt` 纯文本，不传 systemPrompt、不主动注入技能。技能是否生效靠 SDK 内置工具（Claude 用 SkillTool 自加载）。

### Claude Code 的实现真相（参考 `claude-code-bak/src/`）

- 输入框本质是纯文本编辑器；`/` `@` 在 textarea 里就是普通字符，**无结构化 chip**。
- 输入时：`hooks/useTypeahead.tsx` 检测光标 token，匹配 `/`（命令，支持 mid-input inline ghost text + Tab 接受）或 `@`（文件路径补全，含目录导航、引号路径、team member、MCP resource）。
- 提交时：`utils/attachments.ts` 的 `getAttachments()` 对纯文本做正则解析（`extractAtMentionedFiles` / `parseAtMentionedFileLines`），真正读文件内容；slash 走 `processSlashCommand.tsx` 读 `.md` 命令定义。
- 最终 attachment 包成 `Contents of <path>:\n\n<content>` 的 system meta message 给模型。

**核心哲学**：输入态（纯文本 + 补全菜单）与展开态（提交时正则解析、读内容）彻底分离。

cc-desk 不完全照搬——桌面 UI 以美观优先，技能/文件引用做成**可视化内联 chip**；但提交时展开、输入/展开分离的哲学保留。

## 核心决策（已与用户确认）

1. **内联 chip，真富文本**：输入框用 TipTap 编辑器（ProseMirror 内核），chip 是真正的 inline DOM 节点，夹在文字之间。对齐完美、中文输入法（IME）完善。**不**用占位符 + 透明 textarea 镜像层（行中错位瑕疵）、**不**用裸 contentEditable（IME 重灾）、**不**把 chip 限行首。
2. **引用分类**（关键）：
   - 命令 `/review` → **纯文本**（可带参数 `/review PR-123`，光标可编辑）
   - 技能 → **内联 chip**（实体引用）
   - 文件 → **内联 chip**（实体引用）
   - 粘贴图片/文件 → **上方独立 chip 栏**（不进文本流）
   - 逻辑：触发词用文本，实体引用用 chip。
3. **技能 chip 提交展开**：文本锚点——`请使用 Skill: <name>`。Claude 用 SkillTool 自加载。不注入 SKILL.md 全文（省 token）。
4. **文件 chip 提交展开**：注入**路径** `@<绝对路径>`，Claude 用 Read 工具自读。**不**读内容注入（不踩大文件/二进制坑，prompt 短）。`@` 前缀与 Claude Code 语义对齐。
5. **`/` 菜单数据**：命令 + 技能全量缓存（打开输入框时 `cc.commands.get()` + `cc.skills.get()`），触发时本地过滤。
6. **`@` 菜单数据**：实时——每次按键 `fs.readTree(cwd)` + 输入过滤，防抖 ~150ms，上限 50 项。
7. **主进程不改**：`claude-service.ts` 仍吃纯文本 prompt，所有展开在渲染端序列化时完成。
8. **降级**：TipTap 初始化失败 → 回退原生 textarea + 纯文本模式。

## 总体形态

```
┌──────────────────────────────────────────────────┐
│ [🖼 screenshot.png ✕] [📄 data.json ✕]           │ ← ① 上方 chip 栏（粘贴/拖拽，独立区）
├──────────────────────────────────────────────────┤
│ /review 帮我用 [🎯 frontend-design ✕] 技能改     │ ← ② TipTap 编辑区（内联 chip + 命令纯文本）
│ [📄 InputBar.tsx ✕] 的样式                       │
├──────────────────────────────────────────────────┤
│ [📎][🛡变更前确认]   [sonnet-4.6][思考standard][↑]│ ← ③ 现有控件栏（不动）
└──────────────────────────────────────────────────┘
```

引用归属表：

| 引用类型 | 触发 | 渲染位置 | 形态 | 提交时展开为 |
|---|---|---|---|---|
| 命令 `/review` | 输入 `/` 选命令项 | 文本流内 | 纯文本（可带参数） | 原样 `/review`，SDK 原生识别 |
| 技能 `frontend-design` | 输入 `/` 选技能项 | 文本流内 | 内联 chip（SkillChip 节点） | `请使用 Skill: frontend-design` |
| 文件 `InputBar.tsx` | 输入 `@` 选文件 | 文本流内 | 内联 chip（FileChip 节点） | `@<绝对路径>` |
| 粘贴图片/文件 | Ctrl+V / 拖入 | 上方 chip 栏 | 独立 chip（attachments） | 走附件通道 |

## 数据模型

### 新增类型（`src/renderer/types.ts`）

```ts
// 内联 chip（技能或文件），作为 TipTap inline 节点的属性
export interface InlineChipAttrs {
  refId: string   // skill: 带 source 前缀的 id（如 "superpowers:frontend-design"），仅内部标识
                  // file: 文件绝对路径
  label: string   // skill: 技能 name（如 "frontend-design"），展开文本用这个——Claude 用 SkillTool 按 name 调用
                  // file: 文件名（不含目录），仅显示
}

// 草稿附件（上方 chip 栏），扩展现有 PickedElement
export type DraftAttachment =
  | { type: 'pickedElement'; el: PickedElement }   // 已有：网页元素
  | { type: 'image'; name: string; base64: string; mediaType: string }
  | { type: 'file'; name: string; path: string }    // 拖拽/粘贴的文件，存路径
```

### Draft 升级

```ts
export interface Draft {
  // TipTap 文档的 JSON 快照（结构化，含 text / skillChip / fileChip 节点）
  // 切会话时存它，恢复时 editor.commands.setContent(json)
  doc: TipTapDocJSON | null
  attachments: DraftAttachment[]   // 上方 chip 栏
}
```

> 旧的 `text: string` 与 `attachment?: PickedElement` 移除。`SET_DRAFT_TEXT` 等旧 action 由 TipTap 的 `onUpdate` 直接驱动新 action 替换。

### reducer action（`src/renderer/state/actions.ts`）

```ts
| { type: 'SET_DRAFT_DOC'; doc: TipTapDocJSON | null }              // TipTap onUpdate 回调
| { type: 'ADD_DRAFT_ATTACHMENT'; attachment: DraftAttachment }
| { type: 'REMOVE_DRAFT_ATTACHMENT'; index: number }
| { type: 'CLEAR_DRAFT' }
```

`SEND_MESSAGE` 改造：从 `state.draft.doc` 序列化为 prompt 纯文本（见下），不再读 `text`。

## 编辑器实现（TipTap）

### 依赖

```
@tiptap/react  @tiptap/starter-kit  @tiptap/pm  @tiptap/suggestion
```

### 编辑器骨架（替换 InputBar 的 `<textarea>`）

```tsx
const editor = useEditor({
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: t('input.placeholder') }),
    SkillChip,          // 自定义 inline 原子节点
    FileChip,           // 自定义 inline 原子节点
    SlashSuggestion,    // / 触发：命令 + 技能
    FileSuggestion,     // @ 触发：文件
  ],
  editorProps: {
    // 粘贴拦截：图片/文件走附件通道，否则交 TipTap 处理文本
    handlePaste: (view, event) => { /* 见「上方 chip 栏」 */ },
  },
  onUpdate: ({ editor }) => dispatch({ type: 'SET_DRAFT_DOC', doc: editor.getJSON() }),
})
return <EditorContent editor={editor} />
```

### 自定义 chip 节点

```ts
const FileChip = Node.create({
  name: 'fileChip',
  group: 'inline',
  inline: true,
  atom: true,            // 原子：光标不进 chip 内部，退格整块删
  selectable: true,
  attrs: { refId: {}, label: {} },
  // 用 ReactNodeView 渲染：[📄 label ✕]
})

// SkillChip 结构同，图标/颜色区分
```

- `ReactNodeView`（`@tiptap/react`）画卡片：inline-block、圆角、底色、边框、hover 高亮、✕ 按钮删节点
- `atom: true` 保证退格删 chip 整块、光标不卡进 chip 内部

### `/` 触发：SlashSuggestion（命令 + 技能混合）

- 触发字符 `/`
- 数据源：组件 mount 时 `Promise.all([cc.commands.get(), cc.skills.get()])` 全量缓存，触发时本地过滤（按 name/desc 模糊匹配）
- 菜单项分两类，带分隔线：
  - 命令项（⚡）→ 选中插入**纯文本** `/review `（可继续带参数）
  - 技能项（🎯）→ 选中插入 **SkillChip 节点**
- 用 `@tiptap/suggestion` 提供菜单浮层、键盘 ↑↓/Enter/Tab/Esc、光标跟随定位

### `@` 触发：FileSuggestion（文件，实时）

- 触发字符 `@`
- 数据源：每次按键防抖 ~150ms 调 `fs.readTree(<会话项目 path>)`，本地过滤 + 路径前缀累积（目录导航）
- 菜单项：
  - 目录（📂）→ 选中进下一层（前缀累积 `components/`）
  - 文件（📄）→ 选中插入 **FileChip**（refId=绝对路径，label=文件名）
- 上限 50 项，超出显示「…还有 N 项，输入更精确的关键字」
- 路径基点：当前会话所属项目的 `path`，无项目回退 `settings.cwd`

### draft 序列化与提交展开

```ts
// 遍历 TipTap doc，把 chip 展开成纯文本 prompt
function serializeForPrompt(doc: TipTapDocJSON): string {
  // text 节点 → 原样
  // skillChip → "请使用 Skill: <label>"
  // fileChip  → "@<refId>"（绝对路径，Claude 自读）
  // 换行节点 → \n
}
```

`doSend()` 改造：
```ts
const prompt = serializeForPrompt(state.draft.doc)
window.api.claude.send({ prompt, ... })   // 主进程 claude-service 一行不改
```

### 上方 chip 栏（粘贴/拖拽）

- 独立于 TipTap，纯 React flex 容器渲染 `attachments`，复用 `AttachmentChip`（扩 image/file 类型）
- `useEditor` 的 `editorProps.handlePaste` + 容器 `onDrop` 拦截：
  - clipboard 含图片 → 读 base64 → 加 `{ type: 'image', ... }` attachment，return true（拦截 TipTap 文本粘贴）
  - 粘贴/拖拽文件 → 加 `{ type: 'file', ... }` attachment
  - 否则交 TipTap 处理文本

## 交互细节

### 菜单浮层

- 向上展开，定位跟随光标（`props.clientRect`）
- 风格统一 `menuStyle`：`var(--bg-elevated)` / 圆角 / `--shadow-float`
- ↑↓ 选择、Enter/Tab 确认、Esc 关闭、失焦关闭
- `/` 菜单：命令在上、技能在下、中间分隔线；每项 图标 + 名称 + description（省略截断）

### chip 增删

- 删除：点 ✕ 或光标在 chip 后退格 → 整块删（atom）
- 不可编辑 chip 内容（换则删了重选）
- 光标可在 chip 前后停留；chip 可选中复制（复制出展开后的文本）

## 错误处理与边界

| 场景 | 处理 |
|---|---|
| `@` 引用的文件已删/移 | chip 仍在，提交时注入路径，Claude Read 报错由 Claude 自处理（cc-desk 侧不崩） |
| 命令/技能列表为空 | 菜单显示「无可用命令/技能」 |
| `@` 目录无权限/空 | 菜单显示「目录为空或无权限」 |
| 文件树过大 | 上限 50 + 「更多」提示 |
| TipTap 初始化失败 | 回退原生 textarea + 纯文本模式（降级） |
| 切会话 draft 恢复失败（JSON 损坏） | catch 后清空 draft，不阻塞 |

## 测试策略（vitest + testing-library + Playwright）

**纯函数层（重点）**
- `serializeForPrompt(doc)`：命令原样、技能→`请使用 Skill: x`、文件→`@path`、混合、嵌套换行
- `/` 菜单本地过滤函数
- `@` 文件树路径累积逻辑（目录导航）

**组件层**
- 菜单浮层渲染、键盘导航、确认插入
- chip ✕ 删除、退格删除

**集成（Playwright MCP，真实窗口）**
- 输入 `/` 选命令、`/` 选技能插 chip、`@` 选文件插 chip、粘贴图片、提交后验 prompt 展开

**不测**：TipTap 内核（光标/IME）交框架。

## 影响范围

**新增**
- `src/renderer/components/InputBar.tsx`（重写 textarea → TipTap）
- `src/renderer/editor/`：`SkillChip.ts`、`FileChip.ts`、`SlashSuggestion.ts`、`FileSuggestion.ts`、`serialize.ts`、菜单浮层组件
- `src/main/` 的 IPC：复用现有 `cc.skills.get` / `cc.commands.get` / `fs.readTree`，**无需新增**

**修改**
- `src/renderer/types.ts`：Draft / DraftAttachment / InlineChipAttrs
- `src/renderer/state/actions.ts` + `reducer.ts`：draft action 改造、SEND_MESSAGE 序列化
- `src/renderer/components/AttachmentChip.tsx`：扩 image/file 类型

**不改**
- `src/main/claude-service.ts`、`src/preload/index.ts`、控件栏（模型/思考/权限/发送）

## YAGNI（本期不做）

- chip 右键菜单、键盘快捷键插入、多 chip 同名去重逻辑
- 命令参数的智能补全（argumentHint）
- `@` 引用 MCP resource / agent（仅文件）
- `#` 会话引用（现有占位按钮，本期不实现）
