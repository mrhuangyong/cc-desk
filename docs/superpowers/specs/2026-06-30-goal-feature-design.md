# `/goal` 能力设计

> 日期：2026-06-30
> 状态：已通过头脑风暴，待用户审阅 → 转入实现计划
> 目标：实现 Claude Code 官方 `/goal` 命令，完整对齐官方行为
> 官方文档：https://code.claude.com/docs/en/goal

## 功能定义（来自官方文档）

`/goal` 设置一个**完成条件**，Claude 跨轮持续工作直到条件满足，无需用户逐轮提示：

- 每轮结束后，一个**小快模型（默认 Haiku）评估**条件是否达成（yes/no + 理由）
- "no" → Claude 继续下一轮（评估理由作为指导）；"yes" → 自动清除 goal
- 本质是**会话级 prompt-based Stop hook**
- 一个会话一个 goal；`/goal <新条件>` 替换已有 goal

三种用法：`/goal <条件>`（设置并立即启动一轮）、`/goal`（查看状态）、`/goal clear`（清除）。

## 关键决策（已与用户确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 实现范围 | 完整对齐官方（A-F 全做，不拆期） | 用户明确要全部 |
| 评估器实现 | SDK Stop hook（官方同款） | cc-desk 已用 hooks 体系，状态最干净 |
| 命令归属 | 内置命令体系（引用型） | cc-desk 完全掌控状态，与 /clear /export 一致 |
| goal 状态 UI | 独立 UI 面板（GoalCard）+ 指示条 | 用户选择方案 2 |
| 评估失败兜底（A3） | 失败继续轮（当 met=false） | 对齐官方"no 就继续" |
| 续轮上限（B2） | 不加硬上限，纯靠条件里的 turn 子句 | 完全对齐官方 |
| 手机端 | 复用现有输入框 + dispatcher 解析 | 零 PWA UI 改动 |

## 架构（已勘察确认全部可行）

cc-desk 的 SDK query() 已用 hooks 体系（PreToolUse）。加 Stop hook 是同一机制，架构无盲区。

关键勘察结论：
- **SDK 完整支持 `Stop` hook**（HOOK_EVENTS 列表确认）
- **StopHookInput 直接提供 `last_assistant_message`**（注释明确"避免读取 transcript 文件"）——评估器无需读 transcript_path
- **评估器模型**：cc-desk 已有 `modelRoleMap`（含 haiku 角色映射），SDK env 已设 `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- **评估调用**：复用现有 `runSideQuery`（claude-service.ts:1138，已用于 compact 的旁路 Haiku 查询）
- **续轮机制**：Stop hook 返回 `additionalContext` → SDK 自动开下一轮（官方同款）
- **resume**：`resumeId`/`resume` 机制已有
- **/clear**：`clear-session` action 已有
- **remote**：remote-bridge dispatcher + 入站命令白名单 + 事件 forwarder 已有

三层架构：

```
┌─ 命令层(渲染端) ─────────────────────────────────────────┐
│  /goal <条件>  →  内置命令识别 → dispatch SET_GOAL         │
│  /goal         →  dispatch → 弹 GoalCard                  │
│  /goal clear   →  dispatch CLEAR_GOAL                     │
├─ 核心(主进程 Stop hook) ──────────────────────────────────┤
│  query() hooks 加 Stop hook:                              │
│   1. 取 goal 条件(从 goalStore by lsid)                    │
│   2. 调 Haiku 评估(条件 + last_assistant_message)         │
│   3. 未满足 → return {additionalContext: 评估理由} 自动续轮 │
│      满足   → IPC GOAL_ACHIEVED → 清除(不返回 context)    │
├─ 状态层(渲染端 store) ────────────────────────────────────┤
│  goalBySession: { lsid → {condition, startedAt, turns,    │
│    tokensBaseline, lastReason, status} }                  │
│  + UI: ◎ /goal active 指示条 + GoalCard                   │
└───────────────────────────────────────────────────────────┘
```

## A. 命令三态 + 内置命令接入

**命令注册**（`builtin-commands.ts`）：注册 `/goal` 内置命令，builtinAction type 为 `goal`。slash 菜单里出现，desc 说明"设定目标，Claude 持续工作直到完成"。

**引用型命令**（与 `/init`/`/export` 同模式）：菜单选中 `/goal` 只是把 `/goal ` 文本插入输入框（用户补条件后发送），不走 onBuiltinRun 即时执行——因为 `/goal` 需要参数（条件文本），菜单选中时还没条件。

**三态解析**（InputBar 的 doSend，宿主级精确匹配，类似现有 /init//export 逻辑）：

| 用户输入 | 行为 |
|---|---|
| `/goal <条件文本>` | set：dispatch SET_GOAL（记条件 + 注册状态）→ 把"条件"作为 prompt 发给 Claude 启动第一轮 |
| `/goal`（无参，精确等于） | check：dispatch SHOW_GOAL_STATUS → 弹 GoalCard |
| `/goal clear`（或 stop/off/reset/none/cancel） | clear：dispatch CLEAR_GOAL + query.interrupt() 中断当前轮 |

**set 立即启动一轮**（官方"设置 goal 立即开始一轮，条件本身作为 directive"）：`/goal <条件>` 记录条件 + 立即把条件作为 prompt 发出去，Claude 开始干活，Stop hook 接管后续轮次。

**clear 别名**：`stop`、`off`、`reset`、`none`、`cancel` 都等价 `clear`（官方）。

## B. Stop hook 评估器 + 续轮核心

在 `ClaudeService.buildQuery` 的 `query()` hooks 加 Stop hook：

```ts
hooks: {
  PreToolUse: [...],  // 现有
  Stop: [{
    hooks: [async (input: StopHookInput) => {
      const goal = this.goalStore.get(lsid)
      if (!goal || goal.status !== 'active') return {}  // 无 goal: 正常停
      // stop_hook_active 兜底:防 hook 异常导致无限递归
      if (input.stop_hook_active && /* 上一轮 hook 出错 */) return {}
      const verdict = await this.evaluateGoal(goal.condition, input.last_assistant_message)
      this.dispatch(IPC 'goal:evaluated', { lsid, reason: verdict.reason })
      if (verdict.met) {
        this.dispatch(IPC 'goal:achieved', { lsid })
        return {}  // 不返回 context → SDK 真正停止,goal 清除
      }
      return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `目标尚未达成:${verdict.reason}。请继续。` } }
    }],
  }],
}
```

**评估器 `evaluateGoal`**（单独函数，走 runSideQuery 用 Haiku）：

```ts
async evaluateGoal(condition: string, lastAssistantMsg: string): Promise<{met: boolean; reason: string}> {
  const prompt = `你是目标评估器。判断以下对话进展是否满足目标条件。
目标条件:${condition}
最新进展(最后一条助手消息):
${lastAssistantMsg}
仅根据上述信息判断(不主动查文件/跑命令)。返回 JSON: {"met": true/false, "reason": "简短理由"}`
  const result = await this.runSideQuery(prompt)  // Haiku,复用 compact 的旁路通道
  return parseGoalVerdict(result)  // 解析 JSON,容错
}
```

**容错（A3）**：Haiku 调用失败 / JSON 解析失败 → 默认 `met=false`（继续轮）。评估失败不强制停 goal（对齐官方"no 就继续"）。

**`stop_hook_active` 防递归**：StopHookInput 有 `stop_hook_active` 字段——SDK 在"因 Stop hook 续轮后的下一次 stop"时为 true。hook 开头检查：若上一轮 hook 报错/超时，用此字段兜底停止，避免死循环。

**续轮上限（B2）**：不加硬上限。完全靠条件里的 turn 子句（如 `or stop after 20 turns`），由评估器从 last_assistant_message 判断（官方机制）。

**中断**：用户 stop 或 `/goal clear` → ClaudeService 清 goal + `query.interrupt()` 终止当前轮 → Stop hook 因 goal 已清 → return {} 真正停。

**A3+B2 的风险与 UI 兜底**：永不可证伪的条件 + 忘写 turn 子句 = 无限续轮烧 token（符合官方行为）。cc-desk 在 UI 层做透明化兜底（不改逻辑）：GoalCard 显眼展示轮数/token/理由；轮数 > 30 时温和提示"⚠️ 已跑 30+ 轮，确认要继续？[继续] [清除]"——纯 UI 提示，不干预 Stop hook。

## C. 状态层（渲染端 store）

`AppState` 加 `goalBySession: Record<string, GoalState>`（与 streamingBySession 同构，按 session 分片）。

```ts
interface GoalState {
  condition: string        // 目标条件文本(<=4000 字符,官方限制)
  startedAt: number        // 启动时间戳(用于"已运行 Xm")
  turns: number            // 已评估轮数
  tokensBaseline: number   // 启动时 token 基线(用于计算花费)
  lastReason: string       // 评估器最近一次理由
  status: 'active' | 'achieved' | 'cleared'
}
```

**reducer actions**：
- `SET_GOAL`：设置/替换 goal（status='active'，重置 turns/tokensBaseline/startedAt）
- `GOAL_EVALUATED`：turns+1、更新 lastReason（来自 Stop hook IPC）
- `GOAL_ACHIEVED`：status='achieved'（保留条件/耗时/轮数作记录，官方 achieved entry）
- `CLEAR_GOAL`：从 goalBySession 移除
- `SHOW_GOAL_STATUS`：触发 GoalCard 弹出（通过 UI state，如 pendingDialog 模式或独立 flag）

## D. resume 恢复

官方："goal 未完成时随会话 resume 还原；条件保留，计数器/计时器/token 基线重置；已达成/已清除的 goal 不还原。"

两层：
1. **goal 条件持久化**（刷新恢复）：goal 随会话写进 `projects.json`（快照落盘）。刷新后 App.tsx 恢复逻辑里，对每个会话检查未完成 goal → `SET_GOAL` 还原条件；`startedAt`/`turns`/`tokensBaseline` 重置。
2. **Stop hook 重新挂载**：resume 后会话的 query() 重建（SessionQueryManager ensureSession），Stop hook 自然挂上——goal 条件在 → 评估继续。

**边界**：只有 `status==='active'` 的 goal 持久化 + 还原；`achieved`/`cleared` 不落盘（官方"已达成/已清除的 goal 不还原"）。

## E. /clear 联动

官方："`/clear` 开新会话也清除 goal。"

`CLEAR_SESSION_MESSAGES` reducer 分支顺带清 goal：加 `goalBySession: { ...rest, [sid]: undefined }`。同一 reducer 改动，零额外通道。

## F. Remote Control（手机端）

官方："`/goal` 在 Remote Control 可用。"

手机端复用现有输入框发 `/goal xxx` 文本（零 PWA UI 改动）。主进程 dispatcher（remote-bridge）的入站命令白名单加：
- `goal.set`（条件）→ 等价桌面 SET_GOAL + 发 Claude 启动
- `goal.status` → 返回当前 goal 状态给手机端展示
- `goal.clear` → 清 goal + interrupt

**出站事件**：goal 状态变化（设置/评估/达成/清除）经现有 forwarder（旁路 `claude:*` 事件，新增 `goal:*` 通道）下发手机端，让手机端实时看到 `◎ /goal active` + 评估理由。

## UI（独立面板 + 指示条）

### `◎ /goal active` 指示条（常驻，goal 激活时）

goal 激活期间，对话区顶部（消息列表上方、BackendTaskPanel 之下）显示常驻指示条：
```
◎ /goal active · 让 test/auth 全部通过且 lint 干净 · 已运行 8 轮 · 12k tokens · 3m
```
- 条件文本超长截断，hover tooltip 显示完整条件
- 点击指示条 → 展开 GoalCard
- accent 色，一眼可见

### GoalCard 组件（新建 `GoalCard.tsx`，与 PlanCard 同级）

点击指示条或 `/goal` 无参时弹出。展示官方状态视图全部字段：
```
┌─ 🎯 Goal ────────────────────────────────┐
│ 条件: 让 test/auth 全部通过且 lint 干净    │
│ 状态: ● 进行中（已运行 8 轮 · 12k tokens · 3m）│
│                                            │
│ 最近评估:                                   │
│ ❝test/auth 还有 2 个失败(lint 已通过),     │
│  需修复 auth.spec.ts 的 mock。❞            │
│                                            │
│ [清除 goal]  [关闭]                        │
└────────────────────────────────────────────┘
```
- **达成态**：绿色"✓ 已达成"+ 达成耗时/轮数/token，同时对话流插系统 notice"🎯 目标已达成"（官方 achieved entry in transcript）
- **软阈值提示**（A3+B2 兜底）：轮数 > 30 时，卡片顶部"⚠️ 已跑 30+ 轮，确认要继续？[继续] [清除]"——纯 UI，不干预 Stop hook
- **评估理由流转**：每轮 Stop hook 评估后 IPC 下发理由 → 更新 `goalBySession[sid].lastReason` → GoalCard + 指示条实时反映

数据来源：`useSelector(s => s.goalBySession[activeSessionId])` 订阅，goal 不在的会话不渲染。

## 不动的边界（明确）

- 不改现有对话流式机制（STREAM_DELTA / batcher / 虚拟化等）
- 不改现有权限/思考/compact 逻辑
- Stop hook 是在现有 hooks 基础上**追加**，不替换 PreToolUse
- reducer 现有 actions 不改语义，只新增 goal 相关 actions + CLEAR_SESSION_MESSAGES 顺带清 goal

## 测试策略

- **reducer 层**：SET_GOAL / GOAL_EVALUATED / GOAL_ACHIEVED / CLEAR_GOAL 状态转换；CLEAR_SESSION_MESSAGES 联动清 goal
- **评估器**：evaluateGoal 的 JSON 解析容错（合法 JSON / 非法 JSON / 空响应）；met=true/false 路径
- **Stop hook**：有 goal 且 met=false → 返回 additionalContext；有 goal 且 met=true → 返回 {}；无 goal → 返回 {}；stop_hook_active 兜底
- **命令解析**：`/goal xxx`（set）/ `/goal`（check）/ `/goal clear` + 别名（stop/off/reset/none/cancel）
- **resume**：active goal 持久化 + 还原 + 计数器重置；achieved/cleared 不还原
- **remote**：goal.set/status/clear 命令分发 + 状态下发事件
- UI / Stop hook 真实续轮：手动验证（jsdom 测不了 SDK hook 真实续轮）
