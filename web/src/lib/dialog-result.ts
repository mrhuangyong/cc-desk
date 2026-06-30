// web/src/lib/dialog-result.ts
// dialog.response 的 result 形态构造（Task 14 Fix 轮 C1）。
//
// 为什么独立成纯函数：
// 桌面端 ClaudeService 的 askUserViaPanel 把 result 透传给三类 dialog 的处理逻辑，
// 每类对 result 形态的期望不同（见 src/main/claude-service.ts）：
//   - permission_request：result.behavior === 'completed' → 本次批准；
//     result.autoAllow && suggestions → 自动允许；其余 → deny
//   - plan_proposed：result.behavior === 'completed' && result.result.permissionMode
//     → 批准并切权限；其余 → 拒绝（保持 plan 模式）
//   - ask_user_question：result.behavior === 'completed' && result.result.answers
//     → 把答案 push 回 SDK；其余 → 取消（push「用户取消了这次提问」）
//   - SDK 原生 onUserDialog：result 透传给 SDK，形态因 dialog 而异
//
// 早期手机端发 {behavior:'approve'/'deny'} 不匹配任何分支，会被桌面端按「取消」处理，
// 导致用户点批准桌面端却走取消。本模块按 dialogKind 构造正确形态，脱离 React 单测。
//
// 注：plan_proposed 批准需要 permissionMode（中文标签，桌面端 setPermissionMode 据此
// 转 SDK code）。permissionMode 由 PlanSheet 收集后经 opts 传入，未传则默认 '自动编辑'
// （acceptEdits，计划批准后最常见的执行态）。
//
// 注：ask_user_question 批准需要 answers（由 AskQuestionSheet 收集）。早期手机端无答案
// 输入框只能回 cancelled；现 AskQuestionSheet 经 opts.answers 传入真实答案，桌面端 push
// 回 SDK，模型拿到用户选择续跑。

/** plan_proposed 批准时使用的默认权限模式（中文标签）。 */
export const DEFAULT_PLAN_PERMISSION_MODE = '自动编辑'

/**
 * approve 时附带的额外数据（plan 的 permissionMode、ask 的 answers）。
 * deny 不需要额外数据（统一 behavior='deny'）。
 */
export interface ApproveOpts {
  /** plan_proposed 批准时用户选定的权限模式（中文标签）。 */
  permissionMode?: string
  /** ask_user_question 批准时用户提交的答案数组（形态同桌面 AnswerPanel.submit）。 */
  answers?: any[]
}

/**
 * 按 dialogKind + 用户意图（approve/deny）构造桌面端期望的 dialog.response result。
 *
 * @param dialogKind 来自 dialog.request 信封 payload（forwarder 透传 claude:dialog-request）
 * @param decision   'approve' | 'deny'
 * @param opts       approve 时的额外数据（permissionMode / answers）。仅 approve 用到。
 * @returns result 对象，传给 dialog.response 信封的 payload.result
 */
export function buildDialogResult(
  dialogKind: string,
  decision: 'approve' | 'deny',
  opts?: ApproveOpts,
): { behavior: string; autoAllow?: boolean; result?: { permissionMode?: string; answers?: any[] } } {
  if (decision === 'deny') {
    // 拒绝统一用非 completed 的 behavior：桌面端三类 dialog 都把「非 completed」视为
    // 拒绝/取消（permission→deny 分支；plan→保持 plan 模式；ask→push 取消提示）。
    // 用 'deny' 而非 'cancelled' 以便日志区分「用户主动拒绝」与「abort/超时取消」。
    return { behavior: 'deny' }
  }

  // approve：按 dialogKind 构造各类期望的 completed 形态
  switch (dialogKind) {
    case 'plan_proposed':
      // 批准计划 + 选定权限模式：桌面端 handleExitPlanMode 据此调 setPermissionMode
      // 并 pushMessage「用户已批准计划，开始执行」。
      return { behavior: 'completed', result: { permissionMode: opts?.permissionMode ?? DEFAULT_PLAN_PERMISSION_MODE } }
    case 'permission_request':
      // 本次批准（不持久化）：桌面端 handlePermissionRequest 走 allow() 分支。
      // 不带 autoAllow，避免在用户未明确「自动允许」时持久化规则。
      return { behavior: 'completed' }
    case 'ask_user_question':
      // 用户答案（AskQuestionSheet 收集）：桌面端 handleAskUserQuestion 据 behavior=completed
      // + result.answers 把答案 push 回 SDK，模型拿到用户选择续跑。
      // answers 缺省（理论上不会，AskQuestionSheet 必传）退化为空数组。
      return { behavior: 'completed', result: { answers: opts?.answers ?? [] } }
    default:
      // 未知 dialogKind（含 SDK 原生 onUserDialog 的各类）：保守按 completed 透传，
      // 让桌面端 askUserDialog 原样转交 SDK（SDK 自行解释 result）。
      // approve 语义下 completed 比 cancelled 更贴近用户意图。
      return { behavior: 'completed' }
  }
}
