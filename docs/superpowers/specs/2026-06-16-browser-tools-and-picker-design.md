# cc-desk 浏览器工具按钮与元素拾取 — 设计文档

- **日期**：2026-06-16
- **阶段**：增量功能（基于已交付的 UI 原型）
- **状态**：待用户审阅

## 1. 背景

已交付的 UI 原型中，右栏的浏览器 Tab（`BrowserTab.tsx`）用 `<iframe>` 渲染网页，地址栏只有前进/后退。用户需求：地址栏右侧增加工具按钮——刷新、打开控制台、拾取网页元素送入 AI 对话。

## 2. 关键技术约束

**iframe 跨域限制**：原型用 `<iframe>` 加载外部网页（如 example.com）。出于浏览器同源策略，父页面（React 应用）**无法读取或注入脚本到跨域 iframe 内部**。因此"拾取 iframe 内元素"在跨域页面上不可行。

**解决方案：改用 Electron `<webview>` 标签替代 `<iframe>`。** webview 运行在独立进程中，可通过 `executeJavaScript` / `preload` 脚本注入任意页面、读取 DOM、双向通信，从而实现真实的元素拾取。Electron 42 完整支持 webview tag。

## 3. 功能规格

### 3.1 地址栏工具按钮（从左到右）

地址栏布局变为：`[← 后退] [→ 前进] [地址输入框 ───────────] [🔄 刷新] [🐞 控制台] [👆 拾取]`

| 按钮 | 行为 |
|------|------|
| 🔄 刷新 | 重新加载当前 webview 页面（`webview.reload()`） |
| 🐞 控制台 | 打开该 webview 的 DevTools（`webview.openDevTools()`）。甲壳虫图标，取 debug 之意 |
| 👆 拾取 | 进入/退出"拾取模式"，见 3.2。手指标，取选择/抓取之意 |

### 3.2 元素拾取 → 送入 AI 对话

**交互流程：**

1. 点击 ◎ 拾取按钮 → 进入拾取模式（按钮高亮表示激活）。
2. 向 webview 注入拾取脚本：鼠标在网页上移动时，高亮当前悬停元素（半透明描边覆盖层）。
3. 点击目标元素 → 脚本采集该元素信息，通过 webview 的 `ipc-message` / `postMessage` 回传给 React。
4. 退出拾取模式，移除注入的高亮覆盖层。
5. 把采集到的元素信息作为一条**用户消息**追加到当前会话的消息流（见 3.3）。

**拾取的元素信息（送入对话的内容）：**

```
[拾取的网页元素]
来源: <当前网址>
标签: <tagName>
文本: <innerText 前 200 字，超长截断>
选择器: <可定位的 CSS 选择器路径，如 #content > article > p>
HTML:
<outerHTML，截断到 500 字>
```

### 3.3 "送入 AI 对话" 的状态变更

新增 reducer action `ADD_MESSAGE`：
- payload: `{ sessionId: string, message: Message }`
- 行为：把消息追加到指定会话的 `messages` 数组（不可变更新）。
- 拾取完成时，以 `role: 'user'`、content 为 3.2 的元素摘要，追加到 `state.activeSessionId` 会话。

> 注：原型阶段不接真实 AI，消息追加后仅展示在对话区（用户可见），不触发 AI 回复。这和现有 ChatArea 输入框行为一致（spec §9 排除真实 AI）。

## 4. 组件改动

| 文件 | 改动 |
|------|------|
| `src/main/index.ts` | `webPreferences` 开启 webview：不需要额外配置（webview tag 在 Electron 默认可用）；如需可加 `webviewTag: true` 显式声明 |
| `src/renderer/components/BrowserTab.tsx` | iframe → webview；地址栏加三个工具按钮；实现拾取模式（注入/高亮/采集/回传） |
| `src/renderer/state/reducer.ts` + `actions.ts` | 新增 `ADD_MESSAGE` action 与处理 |
| `src/renderer/components/BrowserTab.tsx`（拾取注入脚本） | 一段注入到 webview 的 JS：监听 mousemove 高亮、click 采集并 postMessage 回传 |

## 5. 拾取注入脚本设计

注入脚本在 webview 的 guest 页面上下文运行（通过 webview 的 preload 或 executeJavaScript）。职责：

- 进入拾取模式时安装：`mousemove` → 在悬停元素上叠加一个绝对定位的高亮 div（outline）；`click` → 阻止默认行为，采集元素信息，`window.postMessage` 或 webview 的 ipc 回传，然后卸载监听。
- 退出/拾取完成后移除高亮 div 与所有监听。
- 跨域页面：webview 的 preload 脚本对所有页面生效（含跨域），因此拾取在任意页面均可工作。

## 6. 验证清单

- [ ] 浏览器 Tab 用 webview 渲染，能正常加载网页、地址栏可导航
- [ ] 刷新按钮重新加载当前页
- [ ] 控制台按钮打开该 webview 的 DevTools
- [ ] 点拾取 → 进拾取模式（按钮高亮），网页上移动鼠标高亮元素
- [ ] 点网页元素 → 退出拾取模式，当前会话追加一条含元素信息的用户消息
- [ ] 拾取在跨域网页（如 example.com）上同样有效

## 7. 不在本轮范围

- 拾取结果的真实 AI 分析（仅追加为用户消息展示）
- 拾取元素的视觉编辑/修改
- 多元素批量拾取
- DevTools 的深度集成（仅"打开"原生 DevTools）
