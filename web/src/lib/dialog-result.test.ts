// web/src/lib/dialog-result.test.ts
// buildDialogResult 的纯函数测试（Task 14 Fix 轮 C1）。
//
// 验证：按 dialogKind + decision 构造桌面端 ClaudeService 期望的 result 形态。
// 形态契约源自 src/main/claude-service.ts 的 handlePermissionRequest / handleExitPlanMode /
// handleAskUserQuestion（behavior==='completed' 的判定分支）。
import { describe, it, expect } from 'vitest'
import { buildDialogResult, DEFAULT_PLAN_PERMISSION_MODE } from './dialog-result'

describe('buildDialogResult - deny', () => {
  it('任意 dialogKind 的 deny 都返回 behavior=deny', () => {
    for (const k of ['permission_request', 'plan_proposed', 'ask_user_question', 'unknown']) {
      expect(buildDialogResult(k, 'deny')).toEqual({ behavior: 'deny' })
    }
  })
})

describe('buildDialogResult - approve: permission_request', () => {
  it('批准 → completed，不带 autoAllow（避免意外持久化规则）', () => {
    const r = buildDialogResult('permission_request', 'approve')
    expect(r.behavior).toBe('completed')
    expect(r).not.toHaveProperty('autoAllow')
  })
})

describe('buildDialogResult - approve: plan_proposed', () => {
  it('批准 → completed + result.permissionMode（默认自动编辑）', () => {
    const r = buildDialogResult('plan_proposed', 'approve')
    expect(r.behavior).toBe('completed')
    expect(r.result?.permissionMode).toBe(DEFAULT_PLAN_PERMISSION_MODE)
    expect(DEFAULT_PLAN_PERMISSION_MODE).toBe('自动编辑')
  })

  it('批准 → 透传 opts.permissionMode（用户选定完全访问）', () => {
    const r = buildDialogResult('plan_proposed', 'approve', { permissionMode: '完全访问' })
    expect(r.behavior).toBe('completed')
    expect(r.result?.permissionMode).toBe('完全访问')
  })
})

describe('buildDialogResult - approve: ask_user_question', () => {
  it('批准 → completed + result.answers（透传用户答案，不再 cancelled）', () => {
    const answers = [{ questionIndex: 0, selected: { index: 1, label: 'x' } }]
    const r = buildDialogResult('ask_user_question', 'approve', { answers })
    expect(r.behavior).toBe('completed')
    expect(r.result?.answers).toEqual(answers)
  })

  it('批准 → 未传 answers 时退化为空数组（AskQuestionSheet 必传，此为兜底）', () => {
    const r = buildDialogResult('ask_user_question', 'approve')
    expect(r.behavior).toBe('completed')
    expect(r.result?.answers).toEqual([])
  })
})

describe('buildDialogResult - approve: 未知 dialogKind', () => {
  it('未知 kind 批准 → completed 透传（保守贴近用户意图）', () => {
    const r = buildDialogResult('some_sdk_dialog', 'approve')
    expect(r.behavior).toBe('completed')
  })
})
