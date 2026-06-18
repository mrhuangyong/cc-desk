# 对话区 UI 重设计 — 还原 Codex app 视觉语言 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉对话区域及全站的"线条感"（硬边框 + 描边光环 + 气泡边界），改为靠柔和阴影 + 背景色阶分层，还原 OpenAI Codex app 的克制工程感。

**Architecture:** 改动分三层、自底向上推进：(1) 设计系统根变量（`index.css`）—— 重写 `--shadow-float` 去描边、新增 `--surface-1/2` 与 `--border-hair` 色阶、定义 markdown 去边框规则；(2) 全站组件内联样式去 border（悬浮面板/卡片/按钮）；(3) 对话区消息气泡打磨。每层独立提交、可单独验收。

**Tech Stack:** React + 内联 style + 全局 CSS 变量（`src/renderer/index.css`），Electron 渲染层。无新增依赖。

**测试策略说明：** 本任务是纯视觉层改造，无可单元测试断言的业务逻辑。每个任务用「视觉验收清单」替代单元测试：启动应用（`pnpm dev`）→ 对照清单肉眼检查 → 截图存档。验收清单即"测试"，逐条勾选。

**主题矩阵：** 5 个主题（`codex-light` / `codex-warm` / `codex-cool` / `codex-paper` / `codex-dark`）。色阶与阴影改动需在每个主题块里都改，验收时至少在 light + dark 两个主题下目检。

---

## File Structure

- **Modify** `src/renderer/index.css` — 5 个主题块各新增 `--surface-1` / `--surface-2` / `--border-hair`；重写全部 `--shadow-float`；改写 `.md` 表格/blockquote/代码块规则；改写 `.msg-copy` 去边框。
- **Modify** `src/renderer/components/ChatArea.tsx` — 用户消息气泡去边框调极淡、回到底部钮去 border。
- **Modify** `src/renderer/components/BackendTaskPanel.tsx` — 折叠/展开按钮去 border。
- **Modify** `src/renderer/components/TaskPanel.tsx` — 卡片去 border、折叠分隔线改 `--border-hair`。
- **Modify** `src/renderer/components/BackendTaskCard.tsx` — 卡片去 border、分隔线改 `--border-hair`、终止按钮去 border。
- **Modify** `src/renderer/components/InputBar.tsx` — 下拉菜单 `menuStyle` 去 border。

---

### Task 1: 设计系统根 — 新增色阶变量（5 主题）

为"背景色分层"提供比现有 `--bg-hover` 更细的色阶。`--surface-1` 用于悬浮面板/代码块底（比 bg 高一档），`--surface-2` 用于表头/hover 反馈（再高一档），`--border-hair` 仅留给必须的极淡分隔线。

**Files:**
- Modify: `src/renderer/index.css:1-130`（5 个主题块）

- [ ] **Step 1: 给 `codex-light`（`:root`）块新增色阶**

在 `src/renderer/index.css` 的 `:root, [data-theme='codex-light']` 块内，`--bg-hover` 行之后插入（注意 codex-light 的 `--bg` 是 `#ffffff`，surface 需略带灰）：

```css
  --surface-1: #f7f7f8;
  --surface-2: #efeff1;
  --border-hair: rgba(0,0,0,0.06);
```

- [ ] **Step 2: 给 `codex-warm` 块新增色阶**

在 `[data-theme='codex-warm']` 块内 `--bg-hover` 行之后插入（warm 偏暖灰，`--bg:#fdfcfa`）：

```css
  --surface-1: #f3efe9;
  --surface-2: #eae3da;
  --border-hair: rgba(42,37,32,0.06);
```

- [ ] **Step 3: 给 `codex-cool` 块新增色阶**

在 `[data-theme='codex-cool']` 块内 `--bg-hover` 行之后插入（cool 偏冷灰，`--bg:#fbfcfd`）：

```css
  --surface-1: #eef2f6;
  --surface-2: #e3e9f0;
  --border-hair: rgba(26,34,48,0.06);
```

- [ ] **Step 4: 给 `codex-paper` 块新增色阶**

在 `[data-theme='codex-paper']` 块内 `--bg-hover` 行之后插入（paper 米黄，`--bg:#f8f6f1`）：

```css
  --surface-1: #f1ecdf;
  --surface-2: #e6dfcd;
  --border-hair: rgba(44,40,32,0.06);
```

- [ ] **Step 5: 给 `codex-dark` 块新增色阶**

在 `[data-theme='codex-dark']` 块内 `--bg-hover` 行之后插入（dark，`--bg:#1a1b1e`，surface 需比 bg 亮一档）：

```css
  --surface-1: #202124;
  --surface-2: #2a2c31;
  --border-hair: rgba(255,255,255,0.06);
```

- [ ] **Step 6: 验收（无需截图，确认无语法错）**

Run: `pnpm dev` 启动渲染（或在 IDE 看 CSS 无报错）。
Expected: 应用正常启动，无 CSS 解析错误；因尚未引用新变量，视觉无变化。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/index.css
git commit -m "feat(design): 新增 --surface-1/2 与 --border-hair 色阶（5 主题）

为去线条改造提供背景色分层基础，替代 border 作为分隔手段。"
```

---

### Task 2: 设计系统根 — 重写 `--shadow-float` 去描边光环（5 主题）

去掉所有主题 `--shadow-float` 末尾的 `0 0 0 1px rgba(...)` 描边分量，改为有纵深的双层柔和阴影。这是全站去线条最关键的一步（~20 处引用同时生效）。

**Files:**
- Modify: `src/renderer/index.css:22,41,60,79,129`（5 处 `--shadow-float`）

- [ ] **Step 1: 改 codex-light 的 shadow**

`src/renderer/index.css:22` 改为：
```css
  --shadow-float: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08);
```

- [ ] **Step 2: 改 codex-warm 的 shadow**

`src/renderer/index.css:41` 改为：
```css
  --shadow-float: 0 1px 2px rgba(42,37,32,0.04), 0 8px 24px rgba(42,37,32,0.08);
```

- [ ] **Step 3: 改 codex-cool 的 shadow**

`src/renderer/index.css:60` 改为：
```css
  --shadow-float: 0 1px 2px rgba(26,34,48,0.04), 0 8px 24px rgba(26,34,48,0.08);
```

- [ ] **Step 4: 改 codex-paper 的 shadow**

`src/renderer/index.css:79` 改为：
```css
  --shadow-float: 0 1px 2px rgba(44,40,32,0.04), 0 8px 24px rgba(44,40,32,0.08);
```

- [ ] **Step 5: 改 codex-dark 的 shadow**

`src/renderer/index.css:129` 改为（深色主题阴影加重）：
```css
  --shadow-float: 0 1px 3px rgba(0,0,0,0.24), 0 10px 28px rgba(0,0,0,0.34);
```

- [ ] **Step 6: 验收 — 视觉验收清单**

启动 `pnpm dev`，在 **light + dark** 两个主题下检查以下悬浮元素，确认**不再有发丝描边光环**、且仍有柔和浮起感：
- [ ] 右侧后台任务面板（有任务时）
- [ ] 回到底部浮动按钮（向上滚动后出现）
- [ ] 消息 hover 出现的复制钮
- [ ] 设置页卡片（打开任意设置页）

Expected: 这些元素靠柔和投影浮起，但边缘**没有一圈 1px 硬线**。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/index.css
git commit -m "refactor(design): 重写 --shadow-float 去掉描边光环（5 主题）

去掉 0 0 0 1px rgba 描边分量，改为有纵深的双层柔和阴影。
全站约 20 处悬浮元素同步去线条。"
```

---

### Task 3: Markdown 去边框 — 表格/blockquote/代码块

弱化 markdown 渲染区的边框，改为底色分层。

**Files:**
- Modify: `src/renderer/index.css:149-166`（blockquote / hr / table / code / img 规则）

- [ ] **Step 1: blockquote 去竖线，改底色**

`src/renderer/index.css` 的 `.md blockquote` 规则（约 149 行）改为去掉 `border-left`、加底色：
```css
.md blockquote {
  margin: 8px 0; padding: 6px 14px;
  background: var(--surface-1); border-radius: 8px;
  color: var(--text-muted);
}
```

- [ ] **Step 2: 表格去单元格边框，仅保留表头底色 + 行间淡线**

`.md table` / `.md th, .md td` 规则（约 160-162 行）改为：
```css
.md table { border-collapse: collapse; margin: 8px 0; font-size: 0.95em; }
.md th, .md td { border-bottom: 1px solid var(--border-hair); padding: 6px 12px; text-align: left; }
.md th { background: var(--surface-2); font-weight: 600; border-bottom: 1px solid var(--border-hair); }
.md tr:last-child td { border-bottom: none; }
```

- [ ] **Step 3: 代码块底色统一用 surface-1**

`.md .shiki-block` 块（约 171-172 行）给 `pre` 加底色（深色主题代码块靠 shiki 自身深色背景，此处仅兜底浅色）：
```css
.md .shiki-block { margin: 8px 0; }
.md .shiki-block pre { margin: 0; border-radius: 10px; overflow-x: auto; font-family: var(--font-mono); background: var(--surface-1); padding: 12px 14px; }
```
> 注：shiki 输出的 `<pre>` 自带 inline `background-color`（高亮主题色），inline 样式优先级高于 class，浅色主题下代码块底色实际由 shiki 决定。此步兜底仅在 inline 缺失时生效，不破坏现有语法高亮。验收时确认代码块视觉无明显变差即可。

- [ ] **Step 4: 验收 — 视觉验收清单**

在 light 主题下，让 AI 输出一段含表格 + 引用 + 代码块的 markdown（或打开历史会话），检查：
- [ ] 引用块：无左侧竖线，是柔和底色块
- [ ] 表格：单元格无完整边框，仅行间极淡水平线，表头有底色
- [ ] 代码块：圆角柔和，无破坏性变化

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.css
git commit -m "style(md): 表格/blockquote/代码块去边框，改底色分层"
```

---

### Task 4: 复制钮去边框（`.msg-copy`）

**Files:**
- Modify: `src/renderer/index.css:189-197`（`.msg-copy` 规则）

- [ ] **Step 1: 去掉复制钮 border**

`.msg-copy` 规则里的 `border: 1px solid var(--border);` 删除，其余保留（背景 `--surface-1`、阴影、圆角）。改后：
```css
.msg-copy {
  position: absolute; bottom: -32px;
  opacity: 0; transition: opacity 0.12s;
  padding: 4px; border-radius: 6px;
  background: var(--surface-1);
  box-shadow: var(--shadow-float); color: var(--text-muted);
  cursor: pointer; display: inline-flex; align-items: center;
  line-height: 0; z-index: 20;
}
```

- [ ] **Step 2: 验收**

hover 任意消息，确认复制钮无硬边框、靠柔和阴影浮起。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.css
git commit -m "style(chat): 消息复制钮去硬边框"
```

---

### Task 5: 对话区 — 用户消息气泡去边框调极淡 + 回到底部钮去 border

**Files:**
- Modify: `src/renderer/components/ChatArea.tsx:262-272`（用户消息行）、`ChatArea.tsx:287-303`（回到底部钮）

- [ ] **Step 1: 用户消息：背景调极淡、圆角加大、去边框**

`src/renderer/components/ChatArea.tsx` 用户消息分支的 style（约 262 行），把 `background: 'var(--bg-hover)'` 改为更淡的 `--surface-1`，圆角 10 → 14（`var(--radius-lg)`）：
```tsx
            <div key={m.id} className="msg-row is-user" style={{
              maxWidth: '80%', alignSelf: 'flex-end',
              background: 'var(--surface-1)', borderRadius: 'var(--radius-lg)', padding: '9px 14px',
              color: 'var(--text)',
              display: 'flex', flexDirection: 'column', gap: 6,
              userSelect: 'text', cursor: 'text',
            }}>
```

- [ ] **Step 2: 回到底部钮：去 border，底色用 surface-1**

`src/renderer/components/ChatArea.tsx` 回到底部按钮 style（约 292-298 行），把 `border: '1px solid var(--border)'` 删除，`background: 'var(--bg-elevated)'` 改 `var(--surface-1)`：
```tsx
            style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '100%', marginBottom: 20,
              width: 34, height: 34, borderRadius: '50%',
              background: 'var(--surface-1)',
              boxShadow: 'var(--shadow-float)', color: 'var(--text)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', zIndex: 50,
            }}
```

- [ ] **Step 3: 验收 — 视觉验收清单**

light + dark 主题下：
- [ ] 用户消息气泡：背景比之前更淡、更柔和，无硬边框，圆角更大
- [ ] 回到底部钮（上滑出现）：无硬边框，靠柔和阴影浮起
- [ ] AI 消息保持无背景纯文本

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ChatArea.tsx
git commit -m "style(chat): 用户气泡去边框调极淡 + 回到底部钮去 border"
```

---

### Task 6: 悬浮面板 — 折叠/展开按钮去 border

**Files:**
- Modify: `src/renderer/components/BackendTaskPanel.tsx:26-61`（折叠态按钮 + 展开态收起按钮）

- [ ] **Step 1: 折叠态展开按钮去 border、底色 surface-1**

`BackendTaskPanel.tsx` 折叠态按钮 style（约 33-37 行），删 `border: '1px solid var(--border)'`，`background: 'var(--bg-elevated)'` 改 `var(--surface-1)`：
```tsx
          style={{
            width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-1)',
            borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)',
            boxShadow: 'var(--shadow-float)',
          }}>
```

- [ ] **Step 2: 展开态收起按钮去 border、底色 surface-1**

同文件展开态收起按钮 style（约 55-58 行），删 `border: '1px solid var(--border)'`，`background: 'var(--bg-elevated)'` 改 `var(--surface-1)`：
```tsx
          style={{
            width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-1)',
            borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)',
            boxShadow: 'var(--shadow-float)',
          }}>
```

- [ ] **Step 3: 验收**

有任务时切换面板折叠/展开，确认两个按钮无硬边框、靠阴影浮起。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/BackendTaskPanel.tsx
git commit -m "style(panel): 悬浮面板折叠/展开按钮去 border"
```

---

### Task 7: 任务卡片 — TaskPanel 去边框 + 折叠分隔线弱化

**Files:**
- Modify: `src/renderer/components/TaskPanel.tsx:36,56`

- [ ] **Step 1: 卡片去 border、底色 surface-1**

`TaskPanel.tsx` 卡片容器 style（约 36 行），删 `border: '1px solid var(--border)'`，`background: 'var(--bg-elevated)'` 改 `var(--surface-1)`：
```tsx
    <div style={{
      background: 'var(--surface-1)',
      borderRadius: 10, boxShadow: 'var(--shadow-float)',
      fontSize: 12, overflow: 'hidden',
    }}>
```

- [ ] **Step 2: 折叠区分隔线改 border-hair**

同文件折叠区容器内的 `borderTop: '1px solid var(--border)'`（约 56 行）改为：
```tsx
        <div style={{ padding: 4, borderTop: '1px solid var(--border-hair)' }}>
```

- [ ] **Step 3: 验收**

确认任务卡片无硬边框、折叠展开时分隔线极淡。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TaskPanel.tsx
git commit -m "style(panel): TaskPanel 卡片去边框 + 分隔线弱化"
```

---

### Task 8: 后台任务卡片 — BackendTaskCard 去边框 + 分隔线 + 终止钮

**Files:**
- Modify: `src/renderer/components/BackendTaskCard.tsx:35,55,63,112`

- [ ] **Step 1: 卡片去 border、底色 surface-1**

`BackendTaskCard.tsx` 卡片容器 style（约 35 行），删 `border: '1px solid var(--border)'`，`background: 'var(--bg-elevated)'` 改 `var(--surface-1)`：
```tsx
    <div style={{
      background: 'var(--surface-1)',
      borderRadius: 10, boxShadow: 'var(--shadow-float)', fontSize: 12, overflow: 'hidden',
    }}>
```

- [ ] **Step 2: 折叠区分隔线改 border-hair**

同文件折叠区容器 `borderTop: '1px solid var(--border)'`（约 55 行）改为：
```tsx
        <div style={{ padding: 4, borderTop: '1px solid var(--border-hair)' }}>
```

- [ ] **Step 3: 运行中/已结束分组分隔线改 border-hair**

同文件分组分隔 `<div style={{ height: 1, background: 'var(--border)', margin: '4px 8px' }} />`（约 63 行）改为：
```tsx
              {runningTasks.length > 0 && <div style={{ height: 1, background: 'var(--border-hair)', margin: '4px 8px' }} />}
```

- [ ] **Step 4: 终止按钮去 border、底色 surface-2**

同文件 TaskRow 终止按钮 style（约 112 行），删 `border: '1px solid var(--border)'`，加柔和底色 hover 反馈：
```tsx
        <button onClick={() => onKill(t.id)} title="终止" style={{
          padding: '2px 6px', color: 'var(--text-muted)', background: 'var(--surface-2)',
          border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
          display: 'inline-flex', alignItems: 'center',
        }}>
```

- [ ] **Step 5: 验收**

确认后台任务卡片无硬边框、分组分隔线极淡、终止钮无硬边框（底色块状）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/BackendTaskCard.tsx
git commit -m "style(panel): BackendTaskCard 去边框 + 分隔线弱化 + 终止钮去 border"
```

---

### Task 9: 输入框下拉菜单去 border

**Files:**
- Modify: `src/renderer/components/InputBar.tsx:189-194`（`menuStyle`）

- [ ] **Step 1: menuStyle 去 border、底色 surface-1**

`InputBar.tsx` 的 `menuStyle`（约 189 行），删 `border: '1px solid var(--border)'`，`background: 'var(--bg-elevated)'` 改 `var(--surface-1)`：
```tsx
  const menuStyle: React.CSSProperties = {
    position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
    background: 'var(--surface-1)',
    borderRadius: 10, boxShadow: 'var(--shadow-float)',
    padding: 5, minWidth: 180, zIndex: 100,
  }
```

- [ ] **Step 2: 验收**

点开输入框的权限/模型/思考下拉菜单，确认无硬边框、靠柔和阴影浮起。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/InputBar.tsx
git commit -m "style(input): 下拉菜单去 border，改 surface 底色"
```

---

### Task 10: 全主题目检 + 收尾

- [ ] **Step 1: 5 主题逐一目检**

启动 `pnpm dev`，依次切到 `codex-light` / `codex-warm` / `codex-cool` / `codex-paper` / `codex-dark`，每个主题对照 spec §5 验收标准检查：
- [ ] 对话区用户/AI 消息无可见 1px 硬边框
- [ ] 悬浮面板无描边光环
- [ ] 回到底部钮/复制钮/面板折叠钮无硬 border
- [ ] markdown 表格/代码块/blockquote 柔和
- [ ] 浅色主题下元素没有"糊在一起"（surface 色阶对比度足够）

- [ ] **Step 2: 若某主题 surface 对比度不足，微调**

如某主题（如 paper）下 surface-1 与 bg 差异太小导致面板"消失"，按需加深该主题的 `--surface-1`（直接改 `index.css` 对应行）。记录改动并 amend 到 Task 1 的提交或单独 commit。

- [ ] **Step 3: 最终提交（如有微调）**

```bash
git add src/renderer/index.css
git commit -m "style(design): 主题色阶微调，保证去边框后对比度"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec §3.1（色阶+shadow）→ Task 1,2；§3.2（对话区）→ Task 5；§3.3（悬浮面板）→ Task 6,7,8；§3.4（markdown）→ Task 3,4；§3.5（toolUse）→ spec 已标"实施时先读 BlockRenderer 确认"，**本计划暂未单独建 Task**，因 toolUse 块若复用 `.md`/卡片样式会自动吃红利；如验收时发现 toolUse 块仍有独立硬边框，再补一个 Task。
- **Placeholder**：无 TBD/TODO。
- **类型/命名一致**：`--surface-1` / `--surface-2` / `--border-hair` 全计划统一。
- **覆盖度**：5 主题 × 3 类改动（色阶/shadow/markdown）均有逐主题 step。
