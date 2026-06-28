# 移动端输入框对齐 — 子项目 B1:发送参数控件(权限模式 + 思考强度)

**日期**:2026-06-27
**状态**:设计阶段
**关联**:移动端输入框全面对齐桌面端。A(协议层)已完成,B 分解为 B1 控件 / B2 图片附件 / B3 草稿 / B4 编辑重发 / B5 排队。本文档是 B1。

## Context(背景与目标)

子项目 A 已打通协议层:移动端 sendMessage → session.message → dispatcher → claude.send 全链路透传 permission/thinking,App.tsx 持有 currentPermission/currentThinking 状态(默认 变更前确认/medium)并随消息发出,ChatPage 已预留 4 个 props(currentPermission/currentThinking/onPermissionChange/onThinkingChange)但 A 阶段未渲染控件。

**B1 目标**:在 ChatPage 输入框上方渲染权限模式 + 思考强度两个原生 `<select>` 下拉,让用户能控制 Agent 行为。A 阶段打通的协议层立即变成用户可操作的能力。

**不在 B1 范围**:图片附件(B2)、草稿持久化(B3)、编辑重发(B4)、排队模式(B5)。

## 设计决策(已与用户确认)

1. **控件位置**:输入框上方控件栏(对齐桌面 InputBar 控件栏布局,移动端拇指易达)。
2. **控件形态**:原生 `<select>` 下拉(与现有模型 select 风格统一,移动端原生体验好)。
3. **选项范围**:完全照搬桌面——权限 4 项(变更前确认/自动编辑/计划模式/完全访问)、思考 3 档(low/medium/high),默认 变更前确认/medium。
4. **思考文案**:select 选项显示 low/medium/high(与桌面 InputBar 一致)。

## 改动方案

### ChatPage.tsx

**1. 顶部声明选项常量**(对齐桌面 InputBar.tsx:16-17):

```ts
const PERMISSIONS = ['变更前确认', '自动编辑', '计划模式', '完全访问'] as const
const THINKINGS = ['low', 'medium', 'high'] as const
```

**2. 解构 A 阶段预留的 props**(ChatPage 组件函数体解构列表加 4 个):

```ts
const { ..., currentPermission, currentThinking, onPermissionChange, onThinkingChange } = props
```

**3. footer 内、textarea 上方加控件栏**(在 `<footer className="chat-input-bar">` 内、`<div className="chat-input-wrap">` 之前):

```tsx
{(onPermissionChange || onThinkingChange) && (
  <div className="chat-input-controls">
    {onPermissionChange && (
      <select
        className="param-select"
        value={currentPermission || '变更前确认'}
        onChange={(e) => onPermissionChange(e.target.value)}
        aria-label="权限模式"
      >
        {PERMISSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    )}
    {onThinkingChange && (
      <select
        className="param-select"
        value={currentThinking || 'medium'}
        onChange={(e) => onThinkingChange(e.target.value as 'low' | 'medium' | 'high')}
        aria-label="思考强度"
      >
        {THINKINGS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    )}
  </div>
)}
```

### styles.css

加 `.chat-input-controls`(紧凑横排,gap 小)和 `.param-select`(与现有 `.model-select` 风格一致的小尺寸 select)。参考现有 `.model-select` 样式。

## 关键点

- **A 阶段已铺好全部基础设施**:props 预留 + App 状态 + handleSend 透传 + 协议层。B1 只渲染控件 + 接 onChange,**无需改 App.tsx / useSessionChat / 协议层**。
- **控件栏条件渲染**:仅当 onPermissionChange/onThinkingChange 注入时才显示(防御,且向后兼容旧调用方)。
- **默认值兜底**:`currentPermission || '变更前确认'`、`currentThinking || 'medium'`,与 App state 默认值一致。
- **模型 select 仍在 header**(不动),权限/思考在输入框上方(对齐桌面控件栏位置)。

## 测试策略

1. **ChatPage.test.tsx** 新增:
   - 渲染时传入 currentPermission/currentThinking + setter → 控件栏显示两个 select,选中值正确
   - 改权限 select → 触发 onPermissionChange(新值)
   - 改思考 select → 触发 onThinkingChange(新值)
   - 不传 setter 时不渲染控件栏(向后兼容)
2. 现有 ChatPage 测试保持通过(新 props 可选,旧测试不传也不报错)

## 验证

- `cd web && npx vitest run`(全套,含新增 ChatPage 测试)
- `cd web && npx tsc --noEmit`
- 手动 smoke(用户做):pnpm web:dev,移动端切权限/思考,发消息观察桌面端 SDK 行为(权限模式/思考强度生效)
