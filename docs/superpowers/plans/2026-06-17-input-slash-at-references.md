# 对话区输入框 `/` `@` 引用能力 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把对话输入框从纯 `<textarea>` 升级为 TipTap 富文本编辑器，支持 `/` 引用命令（纯文本）和技能（内联 chip）、`@` 引用文件（内联 chip）、粘贴/拖拽图片文件（上方 chip 栏），提交时把 chip 序列化为 prompt 文本。

**Architecture:** TipTap 编辑器（ProseMirror 内核）替换 textarea；技能/文件做成自定义 inline 原子 Node（ReactNodeView 渲染卡片）；`/` `@` 用 `@tiptap/suggestion` 触发菜单浮层；提交时遍历 doc 把 chip 展开成纯文本 prompt，主进程 `claude-service.ts` 一行不改。

**Tech Stack:** React 18 + TypeScript + TipTap（`@tiptap/react` `@tiptap/starter-kit` `@tiptap/pm` `@tiptap/suggestion`）+ vitest + @testing-library/react + Playwright（集成）

**Spec:** `docs/superpowers/specs/2026-06-17-input-slash-at-references-design.md`

**关键约束：**
- 命令 = 纯文本（可带参数）；技能/文件 = 内联 chip。
- 技能 chip → `请使用 Skill: <name>`；文件 chip → `@<绝对路径>`（Claude 自读）。
- `/` 菜单全量缓存本地过滤；`@` 菜单实时 `fs.readTree` + 防抖 + 上限 50。
- 主进程不改。

---

## 文件结构

**新增（`src/renderer/editor/`）**
- `types.ts` — TipTap doc JSON 类型别名 + 菜单项类型
- `serialize.ts` — `serializeForPrompt(doc)` 纯函数（核心，最先实现）
- `slashFilter.ts` — `/` 菜单的本地过滤纯函数
- `fileNav.ts` — `@` 文件树路径累积/过滤纯函数
- `FileChip.ts` — TipTap FileChip Node + ReactNodeView 卡片
- `SkillChip.ts` — TipTap SkillChip Node + ReactNodeView 卡片
- `ChipView.tsx` — 共用 chip 卡片视觉组件（FileChip/SkillChip 复用）
- `SuggestionMenu.tsx` — 通用菜单浮层组件（`/` 和 `@` 共用渲染层）
- `SlashSuggestion.ts` — `/` 触发的 Suggestion 扩展
- `FileSuggestion.ts` — `@` 触发的 Suggestion 扩展
- `PromptEditor.tsx` — 封装 `useEditor` + `EditorContent` + 降级 textarea

**修改**
- `src/renderer/types.ts` — Draft / DraftAttachment / InlineChipAttrs
- `src/renderer/state/actions.ts` — draft action 改造
- `src/renderer/state/reducer.ts` — draft reducer 改造 + SEND_MESSAGE 序列化
- `src/renderer/state/store.tsx` — initialState 的 draft 改 `{ doc: null, attachments: [] }`
- `src/renderer/components/InputBar.tsx` — textarea → PromptEditor + 上方 chip 栏 + doSend 序列化
- `src/renderer/components/AttachmentChip.tsx` — 扩 image/file 类型
- `tests/reducer.test.ts` — 更新 draft 相关测试

**不改**
- `src/main/*`（含 claude-service.ts、claude-config.ts、file-service.ts）
- `src/preload/index.ts`
- InputBar 的控件栏（模型/思考/权限/发送三态）

**测试（`tests/editor/`）**
- `serialize.test.ts`、`slashFilter.test.ts`、`fileNav.test.ts`（纯函数）
- `ChipView.test.tsx`、`SuggestionMenu.test.tsx`（组件）

---

## Task 1: 安装 TipTap 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

Run:
```bash
pnpm add @tiptap/react @tiptap/starter-kit @tiptap/pm @tiptap/suggestion
```
Expected: 4 个包写入 `package.json` dependencies，pnpm-lock.yaml 更新。

- [ ] **Step 2: 确认版本写入**

Run: `grep -E "@tiptap/(react|starter-kit|pm|suggestion)" package.json`
Expected: 看到 4 行，每行带 `^` 版本号。

- [ ] **Step 3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: 安装 TipTap 编辑器依赖"
```

---

## Task 2: 类型定义（types.ts）

为编辑器引入类型基础。先改类型，后续所有任务都依赖它。

**Files:**
- Modify: `src/renderer/types.ts`（在末尾追加；同时改 `Draft`）
- Create: `src/renderer/editor/types.ts`

- [ ] **Step 1: 在 `src/renderer/editor/types.ts` 定义 TipTap doc 类型与菜单项**

```ts
// src/renderer/editor/types.ts
// TipTap / ProseMirror 文档的 JSON 形态（editor.getJSON() 的产物）。
// 用宽松类型，避免与 ProseMirror 内部类型耦合——序列化只关心结构。
export type TipTapDocJSON = {
  type: 'doc'
  content?: TipTapNodeJSON[]
}

export interface TipTapNodeJSON {
  type: string                  // 'paragraph' | 'text' | 'skillChip' | 'fileChip' | 'hardBreak' ...
  attrs?: Record<string, any>
  content?: TipTapNodeJSON[]
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
  text?: string
}

// / 菜单项（命令 + 技能混合）
export interface SlashMenuItem {
  kind: 'command' | 'skill'
  id: string        // command: 'user:review'；skill: 'superpowers:frontend-design'
  name: string      // command: '/review'（含斜杠）；skill: 'frontend-design'
  desc: string
}

// @ 菜单项（文件/目录）
export interface FileMenuItem {
  kind: 'dir' | 'file'
  name: string      // 条目名（不含路径）
  absPath: string   // 绝对路径
}
```

- [ ] **Step 2: 在 `src/renderer/types.ts` 追加新类型并改 `Draft`**

在 `src/renderer/types.ts` 末尾追加：

```ts
// ===== 输入框内联 chip / 草稿附件 =====

// 内联 chip（技能或文件），作为 TipTap inline 节点的属性
export interface InlineChipAttrs {
  refId: string   // skill: 带 source 前缀的 id（如 "superpowers:frontend-design"），仅内部标识
                  // file: 文件绝对路径
  label: string   // skill: 技能 name（如 "frontend-design"），展开文本用——Claude 用 SkillTool 按 name 调用
                  // file: 文件名（不含目录），仅显示
}

// 草稿附件（上方 chip 栏），扩展现有 PickedElement
export type DraftAttachment =
  | { type: 'pickedElement'; el: PickedElement }
  | { type: 'image'; name: string; base64: string; mediaType: string }
  | { type: 'file'; name: string; path: string }
```

把 `src/renderer/types.ts` 里现有的 `Draft` 接口**替换**为：

```ts
// 输入框草稿：TipTap 文档 JSON + 上方 chip 栏附件
export interface Draft {
  doc: import('./editor/types').TipTapDocJSON | null
  attachments: DraftAttachment[]
}
```

- [ ] **Step 3: 提交**

```bash
git add src/renderer/types.ts src/renderer/editor/types.ts
git commit -m "feat(editor): 引入 TipTap doc 类型与 Draft 重构类型定义"
```

---

## Task 3: 序列化纯函数（serialize.ts）—— 核心，TDD

提交时把 TipTap doc 展开为 prompt 纯文本。这是整个功能的核心逻辑，先写测试。

**Files:**
- Create: `src/renderer/editor/serialize.ts`
- Test: `tests/editor/serialize.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/editor/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { serializeForPrompt } from '../../src/renderer/editor/serialize'
import type { TipTapDocJSON } from '../../src/renderer/editor/types'

// 辅助：构造一个只含纯文本段落的 doc
function textDoc(text: string): TipTapDocJSON {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
// 辅助：构造含一个 skillChip 的段落
function skillDoc(label: string): TipTapDocJSON {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [
      { type: 'text', text: '用' },
      { type: 'skillChip', attrs: { refId: 'src:' + label, label } },
      { type: 'text', text: '改' },
    ] }],
  }
}
// 辅助：构造含一个 fileChip 的段落
function fileDoc(refId: string, label: string): TipTapDocJSON {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [
      { type: 'text', text: '看' },
      { type: 'fileChip', attrs: { refId, label } },
      { type: 'text', text: '这个' },
    ] }],
  }
}

describe('serializeForPrompt', () => {
  it('纯文本原样输出', () => {
    expect(serializeForPrompt(textDoc('你好'))).toBe('你好')
  })
  it('skillChip 展开为 Skill 锚点，夹在文本之间', () => {
    expect(serializeForPrompt(skillDoc('frontend-design'))).toBe('用请使用 Skill: frontend-design改')
  })
  it('fileChip 展开为 @绝对路径', () => {
    expect(serializeForPrompt(fileDoc('/abs/InputBar.tsx', 'InputBar.tsx'))).toBe('看@/abs/InputBar.tsx这个')
  })
  it('空 doc 返回空串', () => {
    expect(serializeForPrompt({ type: 'doc', content: [] })).toBe('')
  })
  it('null doc 返回空串', () => {
    expect(serializeForPrompt(null)).toBe('')
  })
  it('hardBreak 展开为换行', () => {
    const doc: TipTapDocJSON = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }] },
    ] }
    expect(serializeForPrompt(doc)).toBe('第一行\n第二行')
  })
  it('多个段落之间用换行分隔', () => {
    const doc: TipTapDocJSON = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
    ] }
    expect(serializeForPrompt(doc)).toBe('A\nB')
  })
  it('混合：命令纯文本 + 技能 chip + 文件 chip', () => {
    const doc: TipTapDocJSON = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: '/review 用' },
      { type: 'skillChip', attrs: { refId: 's:fd', label: 'frontend-design' } },
      { type: 'text', text: '改' },
      { type: 'fileChip', attrs: { refId: '/x/InputBar.tsx', label: 'InputBar.tsx' } },
    ] }] }
    expect(serializeForPrompt(doc)).toBe('/review 用请使用 Skill: frontend-design改@/x/InputBar.tsx')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test tests/editor/serialize.test.ts`
Expected: FAIL —— `serializeForPrompt` 未定义（模块不存在）。

- [ ] **Step 3: 实现 serializeForPrompt**

`src/renderer/editor/serialize.ts`:

```ts
// src/renderer/editor/serialize.ts
// 把 TipTap doc 展开为提交给 Claude 的纯文本 prompt。
// chip → 文本：skillChip = "请使用 Skill: <label>"；fileChip = "@<refId>"。
// 这是输入态(doc)与展开态(prompt)的边界——所有 chip 在这里"塌缩"成文本。
import type { TipTapDocJSON, TipTapNodeJSON } from './types'

export function serializeForPrompt(doc: TipTapDocJSON | null): string {
  if (!doc || !Array.isArray(doc.content)) return ''
  // 顶层段落之间用换行分隔；空段落贡献一个空行占位（与多行输入一致）
  return doc.content.map(node => serializeBlock(node)).join('\n')
}

// 块级节点（paragraph 等）→ 其内联子节点拼接成的单行文本
function serializeBlock(node: TipTapNodeJSON): string {
  if (!node.content) return ''
  return node.content.map(inline => serializeInline(inline)).join('')
}

// 内联节点 → 文本片段
function serializeInline(node: TipTapNodeJSON): string {
  switch (node.type) {
    case 'text':
      return node.text ?? ''
    case 'hardBreak':
      return '\n'
    case 'skillChip':
      return `请使用 Skill: ${node.attrs?.label ?? ''}`
    case 'fileChip':
      return `@${node.attrs?.refId ?? ''}`
    default:
      // 未知 inline 节点：忽略，不破坏序列化
      return ''
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test tests/editor/serialize.test.ts`
Expected: PASS（全部 8 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/editor/serialize.ts tests/editor/serialize.test.ts
git commit -m "feat(editor): serializeForPrompt 把 TipTap doc 展开为 prompt 文本"
```

---

## Task 4: `/` 菜单过滤纯函数（slashFilter.ts）—— TDD

`/` 菜单从全量缓存里按输入过滤，命令在上、技能在下。

**Files:**
- Create: `src/renderer/editor/slashFilter.ts`
- Test: `tests/editor/slashFilter.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/editor/slashFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterSlashItems } from '../../src/renderer/editor/slashFilter'
import type { SlashMenuItem } from '../../src/renderer/editor/types'

const ITEMS: SlashMenuItem[] = [
  { kind: 'command', id: 'user:review', name: '/review', desc: 'PR 审查' },
  { kind: 'command', id: 'user:commit', name: '/commit', desc: '提交' },
  { kind: 'skill', id: 's:frontend-design', name: 'frontend-design', desc: '创建前端界面' },
  { kind: 'skill', id: 's:code-review', name: 'code-review', desc: '代码审查' },
]

describe('filterSlashItems', () => {
  it('空查询返回全部，命令在前技能在后', () => {
    const r = filterSlashItems(ITEMS, '')
    expect(r.map(i => i.id)).toEqual(['user:review', 'user:commit', 's:frontend-design', 's:code-review'])
  })
  it('按 name 匹配（去掉前导 /）', () => {
    const r = filterSlashItems(ITEMS, 'rev')
    expect(r.map(i => i.id)).toEqual(['user:review', 's:code-review'])
  })
  it('按 desc 匹配', () => {
    const r = filterSlashItems(ITEMS, '审查')
    expect(r.map(i => i.id)).toEqual(['user:review', 's:code-review'])
  })
  it('匹配不区分大小写', () => {
    const r = filterSlashItems(ITEMS, 'FRONTEND')
    expect(r.map(i => i.id)).toEqual(['s:frontend-design'])
  })
  it('无匹配返回空数组', () => {
    expect(filterSlashItems(ITEMS, 'zzz')).toEqual([])
  })
  it('命令始终排在技能前面', () => {
    const r = filterSlashItems(ITEMS, 'e')
    // review/commit/frontend-design/code-review 都含 e，但命令在前
    expect(r[0].kind).toBe('command')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/editor/slashFilter.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/renderer/editor/slashFilter.ts`:

```ts
// src/renderer/editor/slashFilter.ts
// / 菜单本地过滤：按 name/desc 子串匹配（不区分大小写），命令在前、技能在后。
import type { SlashMenuItem } from './types'

export function filterSlashItems(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  const q = query.replace(/^\//, '').trim().toLowerCase()
  const filtered = q === ''
    ? items
    : items.filter(it => {
        const name = it.name.replace(/^\//, '').toLowerCase()
        const desc = it.desc.toLowerCase()
        return name.includes(q) || desc.includes(q)
      })
  // 命令在前，技能在后；各自保持原顺序
  return [
    ...filtered.filter(i => i.kind === 'command'),
    ...filtered.filter(i => i.kind === 'skill'),
  ]
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test tests/editor/slashFilter.test.ts`
Expected: PASS（全部 6 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/editor/slashFilter.ts tests/editor/slashFilter.test.ts
git commit -m "feat(editor): / 菜单本地过滤纯函数"
```

---

## Task 5: `@` 文件导航纯函数（fileNav.ts）—— TDD

`@` 菜单的路径前缀累积（目录导航）+ 文件树过滤。

**Files:**
- Create: `src/renderer/editor/fileNav.ts`
- Test: `tests/editor/fileNav.test.ts`

> 说明：`fs.readTree` 返回的 `FileNode`（`src/renderer/types.ts`）形如 `{ name, path, isDir, children? }`，已按"目录在前、名字排序"排好。本函数只负责：在已加载的树里，按累积的目录前缀取当前层、再按 query 过滤、截断到上限。

- [ ] **Step 1: 写失败测试**

`tests/editor/fileNav.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listDir, filterFileItems } from '../../src/renderer/editor/fileNav'
import type { FileNode } from '../../src/renderer/types'

// 构造测试树：root 下有 components/(含 InputBar.tsx, store.tsx) 和 package.json
const TREE: FileNode[] = [
  { name: 'components', path: '/root/components', isDir: true, children: [
    { name: 'InputBar.tsx', path: '/root/components/InputBar.tsx', isDir: false },
    { name: 'store.tsx', path: '/root/components/store.tsx', isDir: false },
  ] },
  { name: 'package.json', path: '/root/package.json', isDir: false },
]

describe('listDir', () => {
  it('无前缀返回根层（目录在前）', () => {
    const r = listDir(TREE, '')
    expect(r.map(n => n.name)).toEqual(['components', 'package.json'])
  })
  it('按前缀进入子目录', () => {
    const r = listDir(TREE, 'components/')
    expect(r.map(n => n.name)).toEqual(['InputBar.tsx', 'store.tsx'])
  })
  it('前缀指向不存在的目录返回空', () => {
    expect(listDir(TREE, 'nope/')).toEqual([])
  })
  it('多层前缀（本例只有一层，验证逻辑通用）', () => {
    const tree: FileNode[] = [
      { name: 'a', path: '/r/a', isDir: true, children: [
        { name: 'b', path: '/r/a/b', isDir: true, children: [
          { name: 'c.txt', path: '/r/a/b/c.txt', isDir: false },
        ] },
      ] },
    ]
    expect(listDir(tree, 'a/b/').map(n => n.name)).toEqual(['c.txt'])
  })
})

describe('filterFileItems', () => {
  it('空 query 返回全部（受上限）', () => {
    const nodes = listDir(TREE, 'components/')
    const r = filterFileItems(nodes, '', 50)
    expect(r.map(i => i.name)).toEqual(['InputBar.tsx', 'store.tsx'])
  })
  it('按 name 子串过滤（不区分大小写）', () => {
    const nodes = listDir(TREE, '')
    const r = filterFileItems(nodes, 'comp', 50)
    expect(r.map(i => i.name)).toEqual(['components'])
  })
  it('超出上限截断并返回 truncated=true', () => {
    const nodes = listDir(TREE, 'components/')
    const r = filterFileItems(nodes, '', 1)
    expect(r).toHaveLength(1)
    // 截断信息通过第二个返回值
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/editor/fileNav.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/renderer/editor/fileNav.ts`:

```ts
// src/renderer/editor/fileNav.ts
// @ 菜单的目录导航 + 文件过滤纯函数。
// listDir：在已加载树里按累积前缀取当前层；
// filterFileItems：当前层条目按 query 过滤 + 截断上限。
import type { FileNode } from '../types'
import type { FileMenuItem } from './types'

export interface FilterResult {
  items: FileMenuItem[]
  truncatedCount: number   // 被截断的条目数（0 = 未截断）
}

// 按前缀（如 'components/' 或 '' ）取当前目录层的直接子节点
export function listDir(tree: FileNode[], prefix: string): FileNode[] {
  if (!prefix) return tree
  const segs = prefix.replace(/\/+$/, '').split('/').filter(Boolean)
  let current: FileNode[] = tree
  for (const seg of segs) {
    const found = current.find(n => n.isDir && n.name === seg)
    if (!found || !found.children) return []
    current = found.children
  }
  return current
}

// 过滤当前层 + 截断上限；返回菜单项 + 被截断数
export function filterFileItems(nodes: FileNode[], query: string, limit: number): FilterResult {
  const q = query.trim().toLowerCase()
  const matched = q === ''
    ? nodes
    : nodes.filter(n => n.name.toLowerCase().includes(q))
  const truncatedCount = Math.max(0, matched.length - limit)
  const items: FileMenuItem[] = matched.slice(0, limit).map(n => ({
    kind: n.isDir ? 'dir' : 'file',
    name: n.name,
    absPath: n.path,
  }))
  return { items, truncatedCount }
}
```

- [ ] **Step 4: 修测试以匹配 FilterResult 返回结构**

上面的测试 Step 1 写的是 `filterFileItems(...).map(...)`，但实现返回 `{ items, truncatedCount }`。修正测试：

把 `tests/editor/fileNav.test.ts` 的 `filterFileItems` 三个用例改为：

```ts
describe('filterFileItems', () => {
  it('空 query 返回全部（受上限）', () => {
    const nodes = listDir(TREE, 'components/')
    const r = filterFileItems(nodes, '', 50)
    expect(r.items.map(i => i.name)).toEqual(['InputBar.tsx', 'store.tsx'])
    expect(r.truncatedCount).toBe(0)
  })
  it('按 name 子串过滤（不区分大小写）', () => {
    const nodes = listDir(TREE, '')
    const r = filterFileItems(nodes, 'comp', 50)
    expect(r.items.map(i => i.name)).toEqual(['components'])
  })
  it('超出上限截断，truncatedCount>0', () => {
    const nodes = listDir(TREE, 'components/')
    const r = filterFileItems(nodes, '', 1)
    expect(r.items).toHaveLength(1)
    expect(r.truncatedCount).toBe(1)
  })
})
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test tests/editor/fileNav.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/editor/fileNav.ts tests/editor/fileNav.test.ts
git commit -m "feat(editor): @ 文件目录导航与过滤纯函数"
```

---

## Task 6: chip 卡片视觉组件（ChipView.tsx）

FileChip/SkillChip 共用的卡片渲染。先做视觉组件，再做 TipTap Node。

**Files:**
- Create: `src/renderer/components/blocks/ChipView.tsx`（复用现有 blocks 目录的组件风格）
- Test: `tests/editor/ChipView.test.tsx`

- [ ] **Step 1: 写失败测试**

`tests/editor/ChipView.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChipView } from '../../src/renderer/components/blocks/ChipView'

describe('ChipView', () => {
  it('渲染 file 类型：图标 + 文件名', () => {
    render(<ChipView kind="file" label="InputBar.tsx" onRemove={() => {}} />)
    expect(screen.getByText('InputBar.tsx')).toBeTruthy()
  })
  it('渲染 skill 类型：图标 + 技能名', () => {
    render(<ChipView kind="skill" label="frontend-design" onRemove={() => {}} />)
    expect(screen.getByText('frontend-design')).toBeTruthy()
  })
  it('点 ✕ 触发 onRemove', () => {
    const onRemove = vi.fn()
    render(<ChipView kind="file" label="x.ts" onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test tests/editor/ChipView.test.ts`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现**

`src/renderer/components/blocks/ChipView.tsx`:

```tsx
// src/renderer/components/blocks/ChipView.tsx
// 内联 chip 卡片视觉：FileChip / SkillChip 的 ReactNodeView 共用。
// inline-block、圆角、底色、边框、✕ 删除按钮。
import { File, Sparkles } from 'lucide-react'

interface Props {
  kind: 'file' | 'skill'
  label: string
  onRemove?: () => void
  selected?: boolean
}

export function ChipView({ kind, label, onRemove, selected }: Props) {
  const Icon = kind === 'file' ? File : Sparkles
  return (
    <span
      data-chip={kind}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '1px 6px', borderRadius: 999,
        background: kind === 'skill' ? 'var(--accent-soft, rgba(99,102,241,0.12))' : 'var(--bg-hover)',
        color: 'var(--text)', fontSize: 12, lineHeight: 1.4,
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        cursor: 'default', userSelect: 'none', margin: '0 1px',
      }}
    >
      <Icon size={12} style={{ flexShrink: 0 }} />
      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          aria-label="移除"
          title="移除"
          style={{ fontSize: 12, lineHeight: 1, padding: 0, cursor: 'pointer',
            background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
        >×</button>
      )}
    </span>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test tests/editor/ChipView.test.tsx`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/blocks/ChipView.tsx tests/editor/ChipView.test.tsx
git commit -m "feat(editor): chip 卡片视觉组件 ChipView"
```

---

## Task 7: TipTap FileChip / SkillChip Node

把 ChipView 包成 TipTap inline 原子节点。

**Files:**
- Create: `src/renderer/editor/FileChip.ts`
- Create: `src/renderer/editor/SkillChip.ts`

> 说明：TipTap Node 用 `ReactNodeView` 渲染。`atom: true` 保证退格整块删、光标不进 chip。✕ 按钮调 `deleteNode()`（NodeViewProps 提供）。

- [ ] **Step 1: 实现 FileChip**

`src/renderer/editor/FileChip.ts`:

```ts
// src/renderer/editor/FileChip.ts
// 文件 chip：TipTap inline 原子节点。refId=绝对路径，label=文件名。
import { Node, nodeInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ChipView } from '../components/blocks/ChipView'

// NodeView：把 ChipView 挂进 TipTap 的 NodeViewWrapper。
// 注意：chip 要 inline 显示，wrapper 用 span 包裹并设 display:inline。
function FileChipView({ node, deleteNode, selected }: any) {
  const { refId, label } = node.attrs
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <ChipView kind="file" label={label} onRemove={deleteNode} selected={selected} />
    </NodeViewWrapper>
  )
}

export const FileChip = Node.create({
  name: 'fileChip',
  group: 'inline',
  inline: true,
  atom: true,           // 原子：光标不进 chip，退格整块删
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      refId: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-chip="file"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-chip': 'file' }]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileChipView)
  },
})
```

- [ ] **Step 2: 实现 SkillChip（结构同，name/图标不同）**

`src/renderer/editor/SkillChip.ts`:

```ts
// src/renderer/editor/SkillChip.ts
// 技能 chip：TipTap inline 原子节点。refId=带 source 的 id，label=技能 name（展开文本用）。
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ChipView } from '../components/blocks/ChipView'

function SkillChipView({ node, deleteNode, selected }: any) {
  const { refId, label } = node.attrs
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <ChipView kind="skill" label={label} onRemove={deleteNode} selected={selected} />
    </NodeViewWrapper>
  )
}

export const SkillChip = Node.create({
  name: 'skillChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      refId: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-chip="skill"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-chip': 'skill' }]
  },
  addNodeView() {
    return ReactNodeViewRenderer(SkillChipView)
  },
})
```

- [ ] **Step 3: 类型检查（确认编译通过）**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（若 TipTap 类型缺 `selected` 等，可把 NodeViewProps 标 any 已规避）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/editor/FileChip.ts src/renderer/editor/SkillChip.ts
git commit -m "feat(editor): FileChip / SkillChip TipTap inline 原子节点"
```

---

## Task 8: 通用菜单浮层组件（SuggestionMenu.tsx）

`/` 和 `@` 共用的浮层渲染层。`@tiptap/suggestion` 的 `render()` 期望一个带 `onStart/onUpdate/onKeyDown/onExit` 的控制器，本组件封装它。

**Files:**
- Create: `src/renderer/components/blocks/SuggestionMenu.tsx`

> 说明：浮层用 React Portal 定位到 `clientRect` 上方。菜单项类型用泛型，传入 `renderItem` 自定义每行。键盘导航（↑↓ Enter Esc）由 Suggestion 的 `onKeyDown` 通过 `commands` 驱动选中索引——本组件暴露 `onKeyDown` 回调给 Suggestion 调用。

- [ ] **Step 1: 实现 SuggestionMenu**

`src/renderer/components/blocks/SuggestionMenu.tsx`:

```tsx
// src/renderer/components/blocks/SuggestionMenu.tsx
// 通用 suggestion 浮层：/ 和 @ 共用。
// 用 React Portal 定位到光标 clientRect 上方。
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuController {
  onSelect: (idx: number) => void
  onClose: () => void
}

interface Props<T> {
  items: T[]
  selectedIndex: number
  clientRect: (() => DOMRect | null) | null
  renderItem: (item: T, selected: boolean) => ReactNode
  emptyHint?: string
  footer?: ReactNode              // 如「…还有 N 项」
  onSelectIdx: (idx: number) => void
  onHover: (idx: number) => void
}

export function SuggestionMenu<T>({
  items, selectedIndex, clientRect, renderItem, emptyHint, footer, onSelectIdx, onHover,
}: Props<T>) {
  const rect = clientRect?.() ?? null
  if (!rect) return null
  const top = rect.top
  const left = rect.left
  return createPortal(
    <div style={{
      position: 'fixed', top, left, transform: 'translateY(-100%)',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      borderRadius: 10, boxShadow: 'var(--shadow-float)',
      padding: 5, minWidth: 220, maxHeight: 280, overflowY: 'auto', zIndex: 1000,
    }}>
      {items.length === 0 && (
        <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 12 }}>{emptyHint ?? '无匹配项'}</div>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          onMouseEnter={() => onHover(i)}
          onClick={() => onSelectIdx(i)}
          style={{
            padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            background: i === selectedIndex ? 'var(--bg-hover)' : 'transparent',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {renderItem(item, i === selectedIndex)}
        </div>
      ))}
      {footer}
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/blocks/SuggestionMenu.tsx
git commit -m "feat(editor): 通用 suggestion 浮层组件 SuggestionMenu"
```

---

## Task 9: `/` 触发 Suggestion（SlashSuggestion.ts）

`/` 触发命令+技能混合菜单。选中命令插纯文本，选中技能插 SkillChip。

**Files:**
- Create: `src/renderer/editor/SlashSuggestion.ts`

> 说明：用 `@tiptap/suggestion` 的 `Suggestion` 插件。`items()` 全量缓存从外部注入（组件 mount 时拉 `cc.commands.get()` + `cc.skills.get()`，转换成 `SlashMenuItem[]`，命令 name 去掉前导 `/` 之外保留原样用于插入）。选中命令：`command.insertContent('/review ')`；选中技能：`command.insertContent({ type: 'skillChip', attrs: {...} })`。

- [ ] **Step 1: 实现 SlashSuggestion**

`src/renderer/editor/SlashSuggestion.ts`:

```ts
// src/renderer/editor/SlashSuggestion.ts
// / 触发：命令（插纯文本）+ 技能（插 skillChip）混合菜单。
import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { filterSlashItems } from './slashFilter'
import { SuggestionMenu } from '../components/blocks/SuggestionMenu'
import type { SlashMenuItem } from './types'
import { Command as CommandIcon, Sparkles } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'  // 仅示意；实际菜单用 React 实例

// 把外部传入的全量缓存 + render 回调，配成 Suggestion 插件。
// props.items 是全量列表；items() 调 filterSlashItems 本地过滤。
export function buildSlashSuggestion(allItems: SlashMenuItem[]): Extension {
  // 我们用一个外部 render controller 实例来桥接 Suggestion 的命令式 API 与 React 浮层。
  // 为简化，这里直接用 tippy 风格的命令式 popup：通过 ReactDOM 在浮层 DOM 上挂载 React。
  // —— 但更轻的做法是返回 Suggestion 配置，render 用 React。
  return Suggestion.configure({
    char: '/',
    startOfLine: false,
    allowSpaces: false,
    items: ({ query }) => filterSlashItems(allItems, query),
    render: () => {
      // 浮层控制器：用 react-dom render 到一个临时 div
      let popupEl: HTMLDivElement | null = null
      let state: { items: SlashMenuItem[]; sel: number; clientRect: (() => DOMRect | null) | null } = {
        items: [], sel: 0, clientRect: null,
      }
      // ... 完整 render 实现见 Step 2（因较长，拆开）
      return makeSlashController(() => state, (s) => { state = s; rerender() }, () => popupEl, (el) => { popupEl = el })
    },
  } as Partial<SuggestionOptions> as any)
}
```

> 注意：Step 1 是骨架。`/` 和 `@` 的 Suggestion render 逻辑高度相似（都是"创建浮层 div + ReactDOM render SuggestionMenu + 维护 sel 索引 + 键盘导航"），为 DRY，提取一个 `makeSuggestionController` 工厂。

- [ ] **Step 2: 提取共用 controller 工厂**

`src/renderer/editor/suggestionController.ts`:

```ts
// src/renderer/editor/suggestionController.ts
// / 和 @ 共用的 Suggestion render controller 工厂。
// 职责：创建浮层 div → ReactDOM render SuggestionMenu → 维护选中索引 → 处理 ↑↓/Enter/Esc。
import { createRoot, type Root } from 'react-dom/client'
import { SuggestionMenu } from '../components/blocks/SuggestionMenu'
import type { SuggestionKeyDownProps } from '@tiptap/suggestion'

interface Options<T> {
  renderItem: (item: T, selected: boolean) => React.ReactNode
  emptyHint?: string
  buildFooter?: (items: T[]) => React.ReactNode
}

export function makeSuggestionController<T>(opts: Options<T>) {
  let popupEl: HTMLDivElement | null = null
  let root: Root | null = null
  let items: T[] = []
  let sel = 0
  let clientRect: (() => DOMRect | null) | null = null

  const render = () => {
    if (!root) return
    root.render(
      <SuggestionMenu<T>
        items={items}
        selectedIndex={sel}
        clientRect={clientRect}
        renderItem={opts.renderItem}
        emptyHint={opts.emptyHint}
        footer={opts.buildFooter?.(items)}
        onSelectIdx={(i) => { /* onSelect 由 Suggestion 通过 props.callback 触发，这里仅点击时用 */ }}
        onHover={(i) => { sel = i; render() }}
      />,
    )
  }

  return {
    onStart: (p: any) => {
      items = p.items; sel = 0; clientRect = p.clientRect
      popupEl = document.createElement('div')
      document.body.appendChild(popupEl)
      root = createRoot(popupEl)
      render()
    },
    onUpdate: (p: any) => {
      items = p.items; sel = 0; clientRect = p.clientRect
      render()
    },
    onKeyDown: (p: SuggestionKeyDownProps) => {
      if (p.event.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; render(); return true }
      if (p.event.key === 'ArrowDown') { sel = (sel + 1) % items.length; render(); return true }
      if (p.event.key === 'Enter' || p.event.key === 'Tab') {
        if (items[sel]) { p.command(items[sel]); return true }
      }
      return false
    },
    onExit: () => {
      root?.unmount(); root = null
      if (popupEl) { popupEl.remove(); popupEl = null }
      items = []; sel = 0; clientRect = null
    },
    // 给点击选用：SuggestionMenu 点击时调 command
    _setCommand: (cmd: (item: T) => void) => { /* 由调用方注入 */ },
  }
}
```

> 修正：上面 `onSelectIdx` 点击确认没接到 `p.command`。需让 `makeSuggestionController` 持有当前 command。把 `onStart/onUpdate` 收到的 `p.command` 存成模块变量，`SuggestionMenu` 的 `onSelectIdx` 调它。最终版在 Task 9 Step 3 落地。

- [ ] **Step 3: 用 controller 落地 SlashSuggestion 最终版**

`src/renderer/editor/SlashSuggestion.ts`（覆盖 Step 1）:

```ts
// src/renderer/editor/SlashSuggestion.ts
// / 触发：命令（插纯文本）+ 技能（插 skillChip）混合菜单。
import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { filterSlashItems } from './slashFilter'
import { makeSuggestionController } from './suggestionController'
import { Command as CommandIcon, Sparkles } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SlashMenuItem } from './types'

// 把图标渲染成静态 HTML 字符串（菜单项里的图标用 dangerouslySetInnerHTML 挂）
function iconHtml(node: React.ReactNode): string {
  return renderToStaticMarkup(node as any)
}

// 选中回调：命令插纯文本（含尾空格，方便继续打参数）；技能插 skillChip 节点。
function applySlashItem(props: any, item: SlashMenuItem) {
  if (item.kind === 'command') {
    // 命令 name 形如 '/review'，插为纯文本 + 尾空格
    props.command(item.name + ' ')
  } else {
    // 技能：插入 skillChip 节点
    props.command({ refId: item.id, label: item.name.replace(/^\//, '') })
  }
}

// 注意：props.command 在 @tiptap/suggestion 里接受"要插入的内容"。
// 对节点，传 attrs 对象会被当作 skillChip 的 attrs 插入（需在 render 的 command 里适配）。
// 实际 Suggestion 的 command 期望一个"item"，然后调用方在 command 回调里处理。
// 这里改用标准模式：items() 返回 SlashMenuItem[]，command 直接收到选中的 item，
// 由 Extension 配置 command 处理。见下方 configure。

export function buildSlashExtension(allItems: SlashMenuItem[]): Extension {
  return Extension.create({
    name: 'slashSuggestion',
    addOptions() {
      return {
        suggestion: {
          char: '/',
          startOfLine: false,
          items: ({ query }: { query: string }) => filterSlashItems(allItems, query),
          command: ({ editor, range, props }: { editor: any; range: any; props: SlashMenuItem }) => {
            // 删掉触发字符 / 和已输入的 query
            editor.chain().focus().deleteRange(range).run()
            if (props.kind === 'command') {
              editor.chain().focus().insertContent(props.name + ' ').run()
            } else {
              editor.chain().focus().insertContent({
                type: 'skillChip',
                attrs: { refId: props.id, label: props.name.replace(/^\//, '') },
              }).insertContent(' ').run()
            }
          },
          render: () => {
            const ctrl = makeSuggestionController<SlashMenuItem>({
              renderItem: (item, selected) => {
                const isCmd = item.kind === 'command'
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span dangerouslySetInnerHTML={{ __html: iconHtml(isCmd ? <CommandIcon size={13} /> : <Sparkles size={13} />) }} />
                    <span>{item.name}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</span>
                  </span>
                )
              },
              emptyHint: '无可用命令/技能',
            })
            return ctrl
          },
        } as SuggestionOptions,
      }
    },
    addProseMirrorPlugins() {
      return [Suggestion(this.options.suggestion as any)]
    },
  })
}
```

> 说明：`renderToStaticMarkup` 把 lucide 图标转静态 HTML，避免在命令式 render 里直接放 React 元素。`command` 回调里 `deleteRange` 删触发字符 + query，再按 kind 插纯文本或节点。

- [ ] **Step 4: 修正 suggestionController 以对接 command**

`suggestionController.ts` 里 `onSelectIdx`（鼠标点击确认）需要调 Suggestion 的 command。但 Suggestion 的 command 只在键盘 `p.command(item)` 和 `onStart` 的 props 里有。修正：controller 持有 `command`（从 onStart/onUpdate 存），点击时调它。改 `makeSuggestionController`：

把 `onStart/onUpdate` 里加 `commandRef = p.command`，`SuggestionMenu` 的 `onSelectIdx` 改为 `(i) => { if (items[i]) commandRef(items[i]) }`。最终 suggestionController.ts 完整版：

```ts
// src/renderer/editor/suggestionController.ts（完整最终版）
import { createRoot, type Root } from 'react-dom/client'
import { SuggestionMenu } from '../components/blocks/SuggestionMenu'
import type { SuggestionKeyDownProps } from '@tiptap/suggestion'

interface Options<T> {
  renderItem: (item: T, selected: boolean) => React.ReactNode
  emptyHint?: string
  buildFooter?: (items: T[]) => React.ReactNode
}

export function makeSuggestionController<T>(opts: Options<T>) {
  let popupEl: HTMLDivElement | null = null
  let root: Root | null = null
  let items: T[] = []
  let sel = 0
  let clientRect: (() => DOMRect | null) | null = null
  let command: ((item: T) => void) | null = null

  const render = () => {
    if (!root) return
    root.render(
      <SuggestionMenu<T>
        items={items}
        selectedIndex={sel}
        clientRect={clientRect}
        renderItem={opts.renderItem}
        emptyHint={opts.emptyHint}
        footer={opts.buildFooter?.(items)}
        onSelectIdx={(i) => { if (command && items[i]) command(items[i]) }}
        onHover={(i) => { sel = i; render() }}
      />,
    )
  }

  return {
    onStart: (p: any) => {
      items = p.items; sel = 0; clientRect = p.clientRect; command = p.command
      popupEl = document.createElement('div')
      document.body.appendChild(popupEl)
      root = createRoot(popupEl)
      render()
    },
    onUpdate: (p: any) => {
      items = p.items; sel = 0; clientRect = p.clientRect; command = p.command
      render()
    },
    onKeyDown: (p: SuggestionKeyDownProps) => {
      if (items.length === 0) return false
      if (p.event.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; render(); return true }
      if (p.event.key === 'ArrowDown') { sel = (sel + 1) % items.length; render(); return true }
      if (p.event.key === 'Enter' || p.event.key === 'Tab') { if (command && items[sel]) { command(items[sel]); return true } }
      return false
    },
    onExit: () => {
      root?.unmount(); root = null
      if (popupEl) { popupEl.remove(); popupEl = null }
      items = []; sel = 0; clientRect = null; command = null
    },
  }
}
```

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（JSX 在 .ts 文件里需确保 tsconfig 支持；若报错，把 suggestionController.ts 改名为 .tsx，并相应改 import 路径）。

> 若 tsc 报 JSX-in-.ts 错误：把 `suggestionController.ts` 重命名为 `suggestionController.tsx`，SlashSuggestion.ts 里无 JSX 可保持 .ts（但用了 JSX 渲染图标——也改 .tsx）。统一：`SlashSuggestion.tsx`、`FileSuggestion.tsx`、`suggestionController.tsx`。修正所有 import 后再 tsc。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/editor/SlashSuggestion.tsx src/renderer/editor/suggestionController.tsx
# 若 Step 5 改了扩展名，连同 FileChip/SkillChip import 一起处理
git commit -m "feat(editor): / suggestion 控制器工厂与 slash 扩展"
```

---

## Task 10: `@` 触发 Suggestion（FileSuggestion.tsx）

`@` 触发文件菜单：实时 `fs.readTree` + 目录导航 + 上限 50。

**Files:**
- Create: `src/renderer/editor/FileSuggestion.tsx`

> 说明：与 SlashSuggestion 结构类似，但 `items()` 是**异步**（调 `fs.readTree`）。`@tiptap/suggestion` 的 `items` 支持返回 Promise。query 解析：把 `@` 后的输入按 `/` 切分，最后一段是过滤词，前面是累积的目录前缀。目录项选中 → 不插入节点，而是改写输入为 `<前缀><目录名>/`（让用户继续打字进下层）；文件项选中 → 插入 fileChip。

- [ ] **Step 1: 实现 FileSuggestion**

`src/renderer/editor/FileSuggestion.tsx`:

```tsx
// src/renderer/editor/FileSuggestion.tsx
// @ 触发：文件菜单，实时 fs.readTree + 目录导航 + 上限 50。
import { Extension } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { makeSuggestionController } from './suggestionController'
import { listDir, filterFileItems } from './fileNav'
import { Folder, File as FileIcon } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileNode } from '../types'
import type { FileMenuItem } from './types'

const FILE_LIMIT = 50

export function buildFileExtension(getCwd: () => string): Extension {
  // 缓存：同一 cwd 的树只读一次（输入框生命周期内）。cwd 变（切项目）时重置。
  let treeCache: { cwd: string; tree: FileNode[] } | null = null

  async function getTree(cwd: string): Promise<FileNode[]> {
    if (treeCache && treeCache.cwd === cwd) return treeCache.tree
    const tree = await (window as any).api.fs.readTree(cwd)
    treeCache = { cwd, tree }
    return tree
  }

  // query 解析：把 @a/b/c 拆成 { prefix: 'a/b/', filter: 'c' }
  function parseQuery(query: string): { prefix: string; filter: string } {
    const clean = query.replace(/^@\?/, '')  // 去掉可能的 @
    const idx = clean.lastIndexOf('/')
    if (idx < 0) return { prefix: '', filter: clean }
    return { prefix: clean.slice(0, idx + 1), filter: clean.slice(idx + 1) }
  }

  return Extension.create({
    name: 'fileSuggestion',
    addOptions() {
      return {
        suggestion: {
          char: '@',
          startOfLine: false,
          allowSpaces: false,
          // 异步 items：防抖由 suggestion 的 decoration 节奏自然限流（每次 query 变才调）
          items: async ({ query }: { query: string }): Promise<FileMenuItem[]> => {
            const cwd = getCwd()
            if (!cwd) return []
            const { prefix, filter } = parseQuery(query)
            const tree = await getTree(cwd)
            const layer = listDir(tree, prefix)
            const { items, truncatedCount } = filterFileItems(layer, filter, FILE_LIMIT)
            return items
          },
          command: ({ editor, range, props }: { editor: any; range: any; props: FileMenuItem }) => {
            editor.chain().focus().deleteRange(range).run()
            if (props.kind === 'dir') {
              // 目录：不插节点，改写为 <目录名>/ 让用户继续钻下层
              editor.chain().focus().insertContent(props.name + '/').run()
            } else {
              // 文件：插入 fileChip
              editor.chain().focus().insertContent({
                type: 'fileChip',
                attrs: { refId: props.absPath, label: props.name },
              }).insertContent(' ').run()
            }
          },
          render: () => makeSuggestionController<FileMenuItem>({
            renderItem: (item, selected) => {
              const isDir = item.kind === 'dir'
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span dangerouslySetInnerHTML={{ __html: renderToStaticMarkup(isDir ? <Folder size={13} /> : <FileIcon size={13} />) }} />
                  <span>{item.name}</span>
                  {isDir && <span style={{ color: 'var(--text-muted)' }}>/</span>}
                </span>
              )
            },
            emptyHint: '目录为空或无权限',
            // 截断提示放 footer（需要 items 上下文——简化：不显示精确数，仅当达上限时提示）
            buildFooter: (items) => items.length >= FILE_LIMIT
              ? <div style={{ padding: '4px 10px', color: 'var(--text-muted)', fontSize: 11 }}>…可能还有更多，输入更精确的关键字</div>
              : null,
          }),
        } as SuggestionOptions,
      }
    },
    addProseMirrorPlugins() {
      return [Suggestion(this.options.suggestion as any)]
    },
  })
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/editor/FileSuggestion.tsx
git commit -m "feat(editor): @ suggestion 文件菜单（实时树+目录导航+上限50）"
```

---

## Task 11: reducer 改造（draft action + SEND_MESSAGE 序列化）

改 actions / reducer，Draft 改为 `{ doc, attachments }`，SEND_MESSAGE 从 doc 序列化。

**Files:**
- Modify: `src/renderer/state/actions.ts`
- Modify: `src/renderer/state/reducer.ts`
- Modify: `src/renderer/state/store.tsx`
- Modify: `tests/reducer.test.ts`（更新 draft 测试）

- [ ] **Step 1: 改 actions.ts**

把 `src/renderer/state/actions.ts` 里的 draft 相关 action（`SET_DRAFT_TEXT` / `SET_DRAFT_ATTACHMENT` / `CLEAR_DRAFT_ATTACHMENT`）替换为：

```ts
  // 草稿：TipTap doc JSON + 上方 chip 栏附件
  | { type: 'SET_DRAFT_DOC'; doc: import('../editor/types').TipTapDocJSON | null }
  | { type: 'ADD_DRAFT_ATTACHMENT'; attachment: import('../types').DraftAttachment }
  | { type: 'REMOVE_DRAFT_ATTACHMENT'; index: number }
  | { type: 'CLEAR_DRAFT' }
```

并在 Action 类型的 import 块里，把不再使用的 `PickedElement`（若仅 draft 用）保留——Message.attachment 仍用 PickedElement，所以 import 不动。

- [ ] **Step 2: 改 reducer.ts**

把 `src/renderer/state/reducer.ts` 里这几个 case 替换：

```ts
    case 'SET_DRAFT_DOC': {
      return { ...state, draft: { ...state.draft, doc: action.doc } }
    }
    case 'ADD_DRAFT_ATTACHMENT': {
      return { ...state, draft: { ...state.draft, attachments: [...state.draft.attachments, action.attachment] } }
    }
    case 'REMOVE_DRAFT_ATTACHMENT': {
      return { ...state, draft: { ...state.draft, attachments: state.draft.attachments.filter((_, i) => i !== action.index) } }
    }
    case 'CLEAR_DRAFT': {
      return { ...state, draft: { doc: null, attachments: [] } }
    }
```

把 `SEND_MESSAGE` case 改为从 doc 序列化（替换原 `const { text, attachment } = state.draft`）：

```ts
    case 'SEND_MESSAGE': {
      const { doc, attachments } = state.draft
      const prompt = serializeForPrompt(doc)
      // 文本和附件都为空则不发送
      if (!prompt.trim() && attachments.length === 0) return state
      const sessionId = state.activeSessionId
      const newMessage = {
        id: nextId('m'),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: prompt }],
        ...(attachments.length ? { attachments } : {}),  // 注意：Message 需加 attachments 字段，见 Step 3
      }
      // 首条消息标题：用 prompt 文本生成
      const makeTitle = (raw: string) => {
        const clean = raw.replace(/\s+/g, ' ').trim()
        return clean.length > 30 ? clean.slice(0, 30) + '…' : clean
      }
      const projects = state.projects.map(p => ({
        ...p,
        sessions: p.sessions.map(s => {
          if (s.id !== sessionId) return s
          const isFirst = s.messages.length === 0
          return {
            ...s,
            messages: [...s.messages, newMessage],
            ...(isFirst && s.title === '新会话' && prompt.trim() ? { title: makeTitle(prompt) } : {}),
          }
        }),
      }))
      return { ...state, projects, draft: { doc: null, attachments: [] } }
    }
```

在 `src/renderer/state/reducer.ts` 顶部加 import：

```ts
import { serializeForPrompt } from '../editor/serialize'
```

- [ ] **Step 3: Message 类型加 attachments 字段**

`src/renderer/types.ts` 的 `Message` 接口，在 `attachment?: PickedElement` 旁加：

```ts
  attachments?: DraftAttachment[]   // 输入框上方 chip 栏的附件（图片/文件/网页元素）
```

（`attachment?: PickedElement` 保留，向后兼容旧消息。）

- [ ] **Step 4: 改 store.tsx 的 initialState**

`src/renderer/state/store.tsx` 两处 `draft: { text: '' }` 改为：

```ts
draft: { doc: null, attachments: [] },
```

- [ ] **Step 5: 更新 reducer.test.ts 的 draft 测试**

`tests/reducer.test.ts` 顶部 `draft: { text: '' }`（第 15 行）改为 `draft: { doc: null, attachments: [] }`。

把 `SET_DRAFT_ATTACHMENT / CLEAR_DRAFT_ATTACHMENT` 那个测试（约 218 行起）替换为：

```ts
  it('SET_DRAFT_DOC / ADD_DRAFT_ATTACHMENT / REMOVE_DRAFT_ATTACHMENT / CLEAR_DRAFT 管理草稿', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    const s1 = reducer(state, { type: 'SET_DRAFT_DOC', doc })
    expect(s1.draft.doc).toEqual(doc)
    const att = { type: 'file' as const, name: 'a.ts', path: '/a.ts' }
    const s2 = reducer(s1, { type: 'ADD_DRAFT_ATTACHMENT', attachment: att })
    expect(s2.draft.attachments).toEqual([att])
    expect(s2.draft.doc).toEqual(doc) // doc 不丢
    const s3 = reducer(s2, { type: 'REMOVE_DRAFT_ATTACHMENT', index: 0 })
    expect(s3.draft.attachments).toEqual([])
    const s4 = reducer(s3, { type: 'CLEAR_DRAFT' })
    expect(s4.draft).toEqual({ doc: null, attachments: [] })
  })
```

- [ ] **Step 6: 运行全部 reducer 测试**

Run: `pnpm test tests/reducer.test.ts`
Expected: PASS（含更新后的 draft 测试；其它不受影响）。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/state/actions.ts src/renderer/state/reducer.ts src/renderer/state/store.tsx src/renderer/types.ts tests/reducer.test.ts
git commit -m "feat(editor): Draft 改为 {doc, attachments}，SEND_MESSAGE 序列化提交"
```

---

## Task 12: AttachmentChip 扩 image/file 类型

上方 chip 栏复用现有 AttachmentChip，扩 image/file。

**Files:**
- Modify: `src/renderer/components/AttachmentChip.tsx`

- [ ] **Step 1: 改 AttachmentChip 支持 DraftAttachment 联合类型**

把 `src/renderer/components/AttachmentChip.tsx` 整体替换为：

```tsx
// src/renderer/components/AttachmentChip.tsx
// 草稿附件的可视化 chip：网页元素 / 图片 / 文件。
// 输入框内带 × 可删除；消息流内只读（onRemove 不传）。
import { Paperclip, File as FileIcon, Image as ImageIcon } from 'lucide-react'
import type { DraftAttachment } from '../types'

interface Props {
  attachment: DraftAttachment
  onRemove?: () => void
}

export function AttachmentChip({ attachment, onRemove }: Props) {
  let Icon = Paperclip
  let label = ''
  let title = ''
  if (attachment.type === 'pickedElement') {
    Icon = Paperclip
    label = `网页元素 · ${attachment.el.tag}`
    title = `来源: ${attachment.el.source}\n选择器: ${attachment.el.selector}`
  } else if (attachment.type === 'image') {
    Icon = ImageIcon
    label = attachment.name
    title = `图片: ${attachment.name}`
  } else { // file
    Icon = FileIcon
    label = attachment.name
    title = `文件: ${attachment.path}`
  }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', borderRadius: 999,
        background: 'var(--bg-hover)', color: 'var(--text)',
        fontSize: 12, lineHeight: 1.4, maxWidth: '100%',
        border: '1px solid var(--border)',
      }}
      title={title}
    >
      <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center' }}><Icon size={13} /></span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="移除附件"
          title="移除"
          style={{
            fontSize: 13, lineHeight: 1, padding: 0, cursor: 'pointer',
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
          }}
        >×</button>
      )}
    </span>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/components/AttachmentChip.tsx
git commit -m "feat(editor): AttachmentChip 支持图片/文件附件"
```

---

## Task 13: PromptEditor 封装（useEditor + 降级）

封装 TipTap 编辑器，含扩展装配、onUpdate→dispatch、降级 textarea。

**Files:**
- Create: `src/renderer/editor/PromptEditor.tsx`

> 说明：props 接收 `allSlashItems`（全量命令+技能）、`getCwd`、`onDocChange`、`doc`（受控恢复）。扩展装配 StarterKit + Placeholder + SkillChip + FileChip + slash/file suggestion。降级：`useEditor` 返回 null（初始化失败）→ 渲染原生 textarea + 纯文本 mode（doc 当纯文本用）。

- [ ] **Step 1: 实现 PromptEditor**

`src/renderer/editor/PromptEditor.tsx`:

```tsx
// src/renderer/editor/PromptEditor.tsx
// TipTap 编辑器封装：装配扩展、onUpdate→onDocChange、降级 textarea。
import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { SkillChip } from './SkillChip'
import { FileChip } from './FileChip'
import { buildSlashExtension } from './SlashSuggestion'
import { buildFileExtension } from './FileSuggestion'
import type { SlashMenuItem } from './types'
import type { TipTapDocJSON } from './types'

interface Props {
  doc: TipTapDocJSON | null
  placeholder: string
  allSlashItems: SlashMenuItem[]
  getCwd: () => string
  onDocChange: (doc: TipTapDocJSON) => void
  onPasteFiles?: (files: File[]) => void   // 粘贴的图片/文件走附件通道
}

export function PromptEditor({ doc, placeholder, allSlashItems, getCwd, onDocChange, onPasteFiles }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      SkillChip,
      FileChip,
      buildSlashExtension(allSlashItems),
      buildFileExtension(getCwd),
    ],
    content: doc ?? '',
    editorProps: {
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length > 0) {
          onPasteFiles?.(files)
          return true   // 拦截：不交给 TipTap 当文本粘贴
        }
        return false    // 交 TipTap 处理文本
      },
    },
    onUpdate: ({ editor }) => {
      onDocChange(editor.getJSON())
    },
  })

  // 外部 doc 变化（切会话恢复）→ 同步进编辑器
  useEffect(() => {
    if (editor && doc) {
      // 避免 onUpdate 回环：仅当当前内容与目标不一致时 set
      const cur = JSON.stringify(editor.getJSON())
      if (cur !== JSON.stringify(doc)) editor.commands.setContent(doc, false)
    }
  }, [doc, editor])

  // 降级：editor 初始化失败 → 原生 textarea（纯文本，无法 chip）
  if (!editor) {
    return (
      <textarea
        value={doc?.content?.[0]?.content?.[0]?.text ?? ''}
        onChange={e => onDocChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }] } as TipTapDocJSON)}
        placeholder={placeholder + '（降级模式）'}
        rows={1}
        style={{ width: '100%', minHeight: 48, padding: '14px 16px 8px', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, resize: 'none', boxSizing: 'border-box' }}
      />
    )
  }

  return <EditorContent editor={editor} />
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（若 `@tiptap/extension-placeholder` 未装，确认 Task 1 已装；若仍缺，`pnpm add @tiptap/extension-placeholder`）。

> 注：StarterKit 自带 Placeholder? 不自带。需单独装 `@tiptap/extension-placeholder`。在 Step 2 若报缺包：`pnpm add @tiptap/extension-placeholder`，加入 Task 1 的依赖说明。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/editor/PromptEditor.tsx
git commit -m "feat(editor): PromptEditor 封装（扩展装配+降级+粘贴拦截）"
```

---

## Task 14: 重写 InputBar（textarea → PromptEditor + 上方 chip 栏 + doSend）

把 InputBar 的 textarea 换成 PromptEditor，加上方 chip 栏，doSend 改用 dispatch SEND_MESSAGE（reducer 内序列化）。

**Files:**
- Modify: `src/renderer/components/InputBar.tsx`

- [ ] **Step 1: 在 InputBar 顶部加全量缓存与 cwd 计算**

`src/renderer/components/InputBar.tsx`，在现有 import 后加：

```tsx
import { PromptEditor } from '../editor/PromptEditor'
import type { SlashMenuItem } from '../editor/types'
import type { DraftAttachment } from '../types'
```

在组件内（`const { state, dispatch } = useStore()` 后）加：

```tsx
  // / 菜单全量缓存：组件 mount 时拉命令+技能，转成 SlashMenuItem[]
  const [allSlashItems, setAllSlashItems] = useState<SlashMenuItem[]>([])
  useEffect(() => {
    Promise.all([
      window.api?.cc?.commands?.get() ?? Promise.resolve([]),
      window.api?.cc?.skills?.get() ?? Promise.resolve([]),
    ]).then(([cmds, skills]) => {
      const cmdItems: SlashMenuItem[] = (cmds ?? []).map((c: any) => ({
        kind: 'command', id: c.id, name: c.name, desc: c.desc ?? '',
      }))
      const skillItems: SlashMenuItem[] = (skills ?? []).map((s: any) => ({
        kind: 'skill', id: s.id, name: s.name, desc: s.desc ?? '',
      }))
      setAllSlashItems([...cmdItems, ...skillItems])
    })
  }, [])

  // @ 菜单的 cwd 基点：当前会话所属项目的 path，回退 settings.cwd
  const project = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const getCwd = () => project?.path || state.settings?.cwd || ''

  // 粘贴的图片/文件 → 走附件通道
  const onPasteFiles = (files: File[]) => {
    files.forEach(f => {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] ?? ''
          dispatch({ type: 'ADD_DRAFT_ATTACHMENT', attachment: { type: 'image', name: f.name, base64, mediaType: f.type } })
        }
        reader.readAsDataURL(f)
      } else {
        // 普通文件：Electron 粘贴的 File 无路径，仅存 name（路径需走拖拽 drop 事件，下面 onDrop 处理）
        dispatch({ type: 'ADD_DRAFT_ATTACHMENT', attachment: { type: 'file', name: f.name, path: f.name } })
      }
    })
  }
```

- [ ] **Step 2: 替换 textarea 区为 PromptEditor + 上方 chip 栏**

把 InputBar return 里"文本区"那段（`<div style={{ position: 'relative' }}>...textarea...</div>`）替换为：

```tsx
      {/* 上方 chip 栏：粘贴/拖拽的附件 */}
      {state.draft.attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px 0' }}>
          {state.draft.attachments.map((att, i) => (
            <AttachmentChip
              key={i}
              attachment={att}
              onRemove={() => dispatch({ type: 'REMOVE_DRAFT_ATTACHMENT', index: i })}
            />
          ))}
        </div>
      )}
      {/* 编辑区 */}
      <div
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer?.files ?? [])
          if (files.length > 0) { e.preventDefault(); onPasteFiles(files) }
        }}
        onDragOver={(e) => e.preventDefault()}
        style={{ position: 'relative', minHeight: 48, padding: '14px 16px 8px' }}
      >
        <PromptEditor
          doc={state.draft.doc}
          placeholder={t('input.placeholder')}
          allSlashItems={allSlashItems}
          getCwd={getCwd}
          onDocChange={(doc) => dispatch({ type: 'SET_DRAFT_DOC', doc })}
          onPasteFiles={onPasteFiles}
        />
      </div>
```

移除原 `attachment && (...)` 的网页元素 chip 块（已并入上方 chip 栏）。

- [ ] **Step 3: doSend 改用 reducer 序列化**

把 `doSend` 里 `const prompt = text` 删除（reducer 的 SEND_MESSAGE 已序列化 doc）。`doSend` 改为：

```tsx
  const doSend = () => {
    // prompt 由 reducer 在 SEND_MESSAGE 时从 draft.doc 序列化得到；
    // 这里先取序列化结果用于发往主进程。
    const prompt = serializeForPrompt(state.draft.doc)
    if (!prompt.trim() && state.draft.attachments.length === 0) return
    const claudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
    const cwd = project?.path || state.settings?.cwd || undefined
    dispatch({ type: 'SEND_MESSAGE' })
    dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
    window.api?.claude?.send({
      prompt,
      localSessionId: state.activeSessionId,
      sessionId: claudeSessionId || undefined,
      cwd,
    })
  }
```

并在 InputBar 顶部 import：

```tsx
import { serializeForPrompt } from '../editor/serialize'
```

同时把 `handleSend` 里对 `text` 的依赖去掉（原 `if (!text.trim()) return` 改为基于序列化结果判断——已在 doSend 内判断）。

- [ ] **Step 4: 移除已废弃的按钮逻辑**

底部 `ATTACH_ITEMS`（`@` `#` `/` 三个占位项）已无意义——`/` 和 `@` 现在是输入触发，不是按钮。可保留附件按钮（📎）用于触发文件选择对话框（可选），或直接移除整个 attach 菜单。本任务**移除** `ATTACH_ITEMS` 数组与 attach 菜单，保留 `Paperclip` 按钮触发系统文件选择器加附件：

```tsx
  // 附件按钮：触发系统文件选择，选中→加附件 chip
  const pickFiles = async () => {
    // 复用 dialog.openDirectory? 不合适（要文件）。用原生 input file：
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      onPasteFiles(files)
    }
    input.click()
  }
```

把 attach 菜单按钮的 onClick 改为 `pickFiles`，删除 `ATTACH_ITEMS`、`@ # /` 项的渲染。

- [ ] **Step 5: 类型检查 + 跑全量测试**

Run:
```bash
pnpm exec tsc --noEmit
pnpm test
```
Expected: tsc 无错误；测试全过（含更新后的 reducer.test.ts）。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/components/InputBar.tsx
git commit -m "feat(editor): InputBar 切换到 TipTap 编辑器 + 上方 chip 栏 + 序列化提交"
```

---

## Task 15: 编辑器样式（chip 与 contentEditable 外观）

裸的 TipTap `EditorContent` 渲染一个空 contentEditable，需要 CSS 让它像输入框、chip 正确 inline 显示、占位符样式。

**Files:**
- Modify: `src/renderer/index.css`

- [ ] **Step 1: 追加编辑器样式**

在 `src/renderer/index.css` 末尾追加：

```css
/* ===== TipTap 输入编辑器 ===== */
.ProseMirror {
  outline: none;
  min-height: 20px;
  font-family: var(--font);
  font-size: 14px;
  color: var(--text);
  line-height: 1.5;
}
.ProseMirror p {
  margin: 0;
}
/* 占位符 */
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--text-faint);
  float: left;
  height: 0;
  pointer-events: none;
}
/* chip 卡片在 contentEditable 里 inline 显示 */
.ProseMirror span[data-chip] {
  display: inline-flex;
  vertical-align: baseline;
}
/* 光标在 chip 周围可见 */
.ProseMirror .ProseMirror-selectednode {
  outline: 2px solid var(--accent);
  border-radius: 999;
}
```

- [ ] **Step 2: 启动 dev 目视检查**

Run: `pnpm dev`
手动确认：输入框外观正常、placeholder 显示、打字流畅。不提交 CSS 调整前的视觉问题留到 Task 16 集成验证。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/index.css
git commit -m "style(editor): TipTap 编辑器与 chip 内联样式"
```

---

## Task 16: 集成验证（Playwright MCP，真实窗口）

用 Playwright 在真实 Electron 窗口里验证全链路。这是单元测试覆盖不到的（contentEditable + IPC + TipTap）。

**Files:** 无（手动验证 + 记录）

- [ ] **Step 1: 启动应用**

Run: `pnpm dev`
等 Electron 窗口打开。

- [ ] **Step 2: 用 Playwright MCP 连接并验证 `/` 命令**

通过 Playwright MCP：
1. 截图初始输入框
2. 点击输入框，输入 `/`
3. 截图——确认弹出命令+技能菜单
4. 输入 `rev` 过滤
5. ↓ 选中某命令，Enter
6. 截图——确认 `/review ` 纯文本插入
7. 发送，确认消息流里出现 `/review` 文本

- [ ] **Step 3: 验证 `/` 技能插 chip**

1. 清空输入框
2. 输入 `/`，过滤选一个技能，Enter
3. 截图——确认 `[🎯 技能名 ✕]` chip 插入
4. 输入「改下」后接 chip，确认 chip 夹在文字间
5. 发送，确认消息流里 prompt 含「请使用 Skill: xxx」

- [ ] **Step 4: 验证 `@` 文件插 chip**

1. 清空，输入 `@`
2. 截图——确认弹出文件菜单（目录+文件）
3. 选目录进下一层，截图确认前缀累积
4. 选一个文件，确认 `[📄 文件名 ✕]` chip 插入
5. 发送，确认消息流里 prompt 含 `@<绝对路径>`

- [ ] **Step 5: 验证 chip 删除**

点 chip 的 ✕，确认整块删除；或光标在 chip 后退格删除。

- [ ] **Step 6: 验证粘贴/拖拽**

1. 复制一张图片，Ctrl+V 粘贴——确认上方 chip 栏出现图片 chip
2. 拖一个文件进输入框——确认上方出现文件 chip
3. 发送（带文本），确认附件随消息发出

- [ ] **Step 7: 记录问题并修复**

若任一步异常，记下现象 + 复现，修代码后重跑该步。所有步通过后才算完成。

- [ ] **Step 8: 提交（若有修复）**

```bash
git add -A
git commit -m "fix(editor): 集成验证修复"
```

---

## Task 17: 最终全量检查 + 收尾

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全过。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 确认主进程未改**

Run: `git diff main -- src/main src/preload`
Expected: 空输出（主进程与 preload 一行未改）。

- [ ] **Step 4: 更新 memory（记录架构决策）**

记录本次输入框重构的关键决策到 memory（TipTap 内联 chip + 提交序列化），供后续会话参考。

- [ ] **Step 5: 最终提交（若有遗留）**

```bash
git status
# 若有未提交改动：
git add -A && git commit -m "chore(editor): 收尾"
```

---

## Self-Review 备注

- Spec 覆盖：命令纯文本（Task 9）、技能 chip（Task 7+9）、文件 chip（Task 7+10）、粘贴图片文件（Task 12+14）、提交展开（Task 3+11）、降级（Task 13）、错误边界空列表/上限（Task 8+10）—— 全覆盖。
- TipTap 文件扩展名：含 JSX 的统一 `.tsx`（SlashSuggestion/FileSuggestion/suggestionController）；纯逻辑 `.ts`（serialize/slashFilter/fileNav/types）。
- 类型一致性：`serializeForPrompt`、`DraftAttachment`、`InlineChipAttrs`、`SlashMenuItem`、`FileMenuItem` 在定义与使用处名称一致。
