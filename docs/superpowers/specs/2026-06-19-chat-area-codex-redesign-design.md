# 对话区 UI 重设计：去线条、还原 Codex app 视觉语言

> 日期：2026-06-19
> 触发：用户反馈"线条感太强"，目标参照 OpenAI Codex app 的对话界面。

## 1. 背景与问题诊断

### 1.1 用户反馈
"重新设计对话区域 UI，包括悬浮面板，当前线条感太强了。"
明确要求：**极致还原 OpenAI Codex app** 的视觉语言。

### 1.2 根因分析（为什么会"线条感太强"）

逐一排查后，"线条感"来自设计系统层面的三个默认手段：

1. **描边光环阴影** —— `--shadow-float` 在所有主题里都定义为：
   `0 2px 12px rgba(...,0.06), 0 0 0 1px rgba(...,0.03)`
   末尾的 `0 0 0 1px` 是一圈 1px 发丝描边，给**每一个**悬浮元素（按钮、面板、卡片、输入框、复制钮、回到底部钮……）都罩上一层硬轮廓。这是最强烈的"线条感"来源，全站约 20 处引用。

2. **硬边框依赖** —— 大量元素用 `border: 1px solid var(--border)` 作为分隔手段：
   悬浮面板折叠按钮、复制钮、回到底部钮、卡片、设置项、表格 `th/td`、blockquote 左边框、markdown 表格全边框等。元素之间**靠线分隔**而非靠底色/间距分隔。

3. **消息气泡边界** —— 用户消息用 `--bg-hover` 实色块 + 10px 圆角，与 AI 无背景纯文本形成强对比，气泡边界感明显。

### 1.3 Codex app 的视觉语言（还原目标）

依据 OpenAI 官方文档对 Codex app 的界面描述（"project sidebar, thread list, review pane"）、Features 页图像摘要，以及 OpenAI 一贯的设计系统，提炼出对话区核心特征：

- **无气泡、无边框的对话流**：用户/AI 消息靠"角色标签 + 对齐 + 留白"区分，不靠色块气泡（用户已选择折中：保留**极淡背景**区分，去掉硬边框）。
- **边框极少**：分隔主要靠**背景色微差**（surface vs bg）和**间距**，不靠 `1px border`。
- **悬浮面板（task sidebar）**：柔和投影 + 轻微底色 + 圆角，**不带描边光环**，有材质感但不生硬。
- **代码块**：无边框，仅靠底色 + 圆角，和正文之间靠间距分隔。
- **气质**：冷静、克制、留白充足、工程感。

## 2. 设计决策（已与用户对齐）

| 决策点 | 选择 |
|---|---|
| 线条感来源 | 全选：卡片硬边框 + 悬浮面板描边光环 + 消息气泡边界 + 代码块/引用块边框 + toolUse |
| 层次手法 | 极致还原 Codex app（OpenAI 版） |
| 用户/AI 区分 | **极淡背景区分**：保留用户消息轻背景但调到极淡、去硬边框；AI 仍纯文本 |
| 改动范围 | **全局设计系统根统一 + 重点打磨对话区/悬浮面板** |

## 3. 改造方案

### 3.1 设计系统层（`src/renderer/index.css`）—— 全站去线条

#### 3.1.1 新增色阶变量（让"背景色分层"成为主分隔手段）

当前只有 `--bg` / `--bg-elevated` / `--bg-hover` / `--bg-sidebar`，色阶不够细。新增：

```css
--surface-1   /* 比 bg 高一档的浮起面：悬浮面板、代码块底 */
--surface-2   /* 再高一档：hover、active 反馈 */
--border-hair /* 极淡分隔线（仅用于必须的地方，如 markdown 表格），不作为默认手段 */
```

各主题（codex-light / warm / cool / paper / dark）逐一配对，保持现有色温基调。

#### 3.1.2 重写 `--shadow-float` —— 去掉描边光环

**改前**（所有主题）：
```
0 2px 12px rgba(...,0.06), 0 0 0 1px rgba(...,0.03)
```
**改后**：去掉 `0 0 0 1px` 描边，改为更柔和、有纵深的多层阴影，让悬浮元素靠"光"而非"线"浮起：
```
0 1px 2px rgba(...,0.04), 0 8px 24px rgba(...,0.08)
```
（深色主题 opacity 相应加重。）这一项**同时影响全站约 20 处悬浮元素**，是最关键的改动。

#### 3.1.3 折叠态/按钮的 `border` 处理

- 悬浮按钮（回到底部、面板折叠/展开）的 `border: 1px solid var(--border)` → 移除，改靠 `--shadow-float` + `--surface-1` 底色浮起。
- `.msg-copy` 复制钮：移除 `border`，靠底色 + 柔和阴影。

### 3.2 对话区（`src/renderer/components/ChatArea.tsx`）—— 核心打磨

#### 3.2.1 用户消息：极淡背景 + 去边框

**改前**：
```tsx
background: 'var(--bg-hover)', borderRadius: 10, padding: '9px 13px'
```
**改后**：背景调到极淡（用新增的 `--surface-1` 或半透明叠层），圆角加大到 14px（`--radius-lg`）使其更柔和，padding 收紧，去掉任何边框。视觉上是"微微浮起的纸面"而非"勾了边的方块"。

#### 3.2.2 AI 消息：保持纯文本

维持现状（无背景、左对齐），但调整底部 `.msg-foot`（cost + 复制钮）的间距，让 metadata 更克制（`--text-faint` 已经够淡）。

#### 3.2.3 回到底部浮动按钮

去掉 `border: 1px solid var(--border)`，底色用 `--surface-1`，靠重写后的 `--shadow-float` 浮起。

#### 3.2.4 流式光标区

流式消息容器 `padding: '0 28px'` 与正文对齐，去除多余分隔感。

### 3.3 悬浮面板（`BackendTaskPanel.tsx` + `TaskPanel` + `BackendTaskCard`）

#### 3.3.1 面板折叠/展开按钮

`border: 1px solid var(--border)` → 移除；底色 `--surface-1` + 新 `--shadow-float`。

#### 3.3.2 TaskCard / BackendTaskCard 卡片

当前 `borderRadius: 10, boxShadow: 'var(--shadow-float)'` 且部分带 `border`。
- 移除显式 border；
- 底色用 `--surface-1`（与对话区 bg 形成微差）；
- 卡片之间靠 `gap` 间距分隔，不靠边框。
- 卡片内部状态行（running/done）用色点 + 文字，不加边框 pill。

### 3.4 Markdown 渲染（`.md` 全局规则）

#### 3.4.1 代码块

`.md .shiki-block pre` 当前 `border-radius: 8px` 无边框（已 OK）。补：代码块底色统一用 `--surface-1`，确保与正文有清晰但不刺眼的分层。

#### 3.4.2 blockquote

**改前**：`border-left: 3px solid var(--border)`。
**改后**：去掉竖线，改为 `--surface-1` 左侧色带底色（仅给引用区一个极淡的整体底色 + 左侧 3px 同色加重条，非硬边线），或纯 `--surface-1` 底 + 加大左 padding。**明确去边框**——用户已把"引用块边框"列入不满项，不留竖线。

#### 3.4.3 表格

**改前**：`th, td { border: 1px solid var(--border) }` + `th { background: --bg-hover }`。
**改后**：去掉单元格边框，仅保留 `th` 的底色 `--surface-2` 区分表头；行间用极淡的水平分隔线（`--border-hair`，仅 `border-bottom`）。

### 3.5 toolUse 块（`BlockRenderer` / 工具调用展示）

工具调用块当前若带边框/卡片感，统一改为：极淡 `--surface-1` 底 + 圆角，无硬边框，靠左侧小图标 + 工具名 + 折叠态区分（与 Codex task sidebar 的 step 展示一致）。
> 实施时需先读 `BlockRenderer` 及工具块组件确认现状再细化。

## 4. 不在本次范围内（YAGNI）

- 不重做左侧栏 / 顶部 TabBar 的整体布局，仅顺带享受根变量去边框的红利。
- 不引入新字体（保持现有 `-apple-system`，Codex 也用系统无衬线）。
- 不改 i18n / 交互逻辑，纯视觉层。

## 5. 验收标准

1. 对话区用户/AI 消息**无可见 1px 硬边框**，靠极淡底色 + 对齐区分。
2. 悬浮面板（BackendTaskPanel 及其卡片）**无描边光环**，靠柔和投影浮起。
3. 全站 `--shadow-float` 不再含 `0 0 0 1px` 描边分量。
4. 回到底部钮、复制钮、面板折叠钮无硬 border。
5. markdown 表格/代码块/blockquote 视觉更柔和，边框显著弱化。
6. 5 个主题（light/warm/cool/paper/dark）逐一验证色阶与阴影一致性。

## 6. 风险与回滚

- **风险**：去掉描边后，浅色主题下低对比度元素可能"糊"在一起。**对策**：新增的 `--surface-1/2` 色阶需在各主题下保证足够对比度；`--shadow-float` 加重纵深层级补偿。
- **回滚**：所有改动集中在 `index.css` + 几个组件的 style 对象，git 单提交可整体 revert。
