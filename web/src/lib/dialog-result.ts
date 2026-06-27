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
// 转 SDK code）。手机端 UI 当前无模式选择控件，故批准时用默认 '自动编辑'（acceptEdits，
// 计划批准后最常见的执行态）。详见报告「遗留缺口」。

/** plan_proposed 批准时使用的默认权限模式（中文标签）。 */
export const DEFAULT_PLAN_PERMISSION_MODE = '自动编辑'

/**
 * 按 dialogKind + 用户意图（approve/deny）构造桌面端期望的 dialog.response result。
 *
 * @param dialogKind 来自 dialog.request 信封 payload（forwarder 透传 claude:dialog-request）
 * @param decision   'approve' | 'deny'
 * @returns result 对象，传给 dialog.response 信封的 payload.result
 */
export function buildDialogResult(
  dialogKind: string,
  decision: 'approve' | 'deny',
): { behavior: string; autoAllow?: boolean; result?: { permissionMode?: string } } {
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
      return { behavior: 'completed', result: { permissionMode: DEFAULT_PLAN_PERMISSION_MODE } }
    case 'permission_request':
      // 本次批准（不持久化）：桌面端 handlePermissionRequest 走 allow() 分支。
      // 不带 autoAllow，避免在用户未明确「自动允许」时持久化规则。
      return { behavior: 'completed' }
    case 'ask_user_question':
      // 遗留缺口：手机端 UI 当前无答案输入框，无法构造 answers。
      // 回 cancelled 让桌面端 push「用户取消了这次提问」，模型续跑而非卡死。
      // 后续若加答案输入 UI，应改为 { behavior:'completed', result:{answers:[...]} }。
      return { behavior: 'cancelled' }
    default:
      // 未知 dialogKind（含 SDK 原生 onUserDialog 的各类）：保守按 completed 透传，
      // 让桌面端 askUserDialog 原样转交 SDK（SDK 自行解释 result）。
      // approve 语义下 completed 比 cancelled 更贴近用户意图。
      return { behavior: 'completed' }
  }
}
