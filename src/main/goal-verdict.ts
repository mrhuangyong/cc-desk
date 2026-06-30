// src/main/goal-verdict.ts
// goal 评估结果的 JSON 解析(纯函数)。A3 容错:解析失败默认 met=false(继续轮),
// 避免评估器抖动导致 goal 误判达成而提前停止。

export interface GoalVerdict {
  met: boolean
  reason: string
}

// 从 Haiku 的文本响应解析 {met, reason}。
// 容错:① 代码块包裹 ② 前后多余文本 ③ 非法 JSON → 默认 {met:false, reason:'解析失败'}。
export function parseGoalVerdict(raw: string): GoalVerdict {
  const fallback: GoalVerdict = { met: false, reason: '评估响应解析失败,默认继续' }
  if (!raw || !raw.trim()) return { met: false, reason: '评估响应为空,默认继续' }
  // 提取首个 JSON 对象(容忍代码块包裹 / 前后文本)
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return fallback
  try {
    const obj = JSON.parse(match[0])
    if (typeof obj.met !== 'boolean') return fallback
    return { met: obj.met, reason: typeof obj.reason === 'string' ? obj.reason : '' }
  } catch {
    return fallback
  }
}

// 构造评估 prompt(给 Haiku)。单独导出便于测试 + 与 evaluateGoal 解耦。
export function buildGoalEvalPrompt(condition: string, lastAssistantMsg: string): string {
  return `你是目标评估器。判断以下对话进展是否满足目标条件。仅根据给定信息判断,不主动查文件/跑命令。

目标条件:
${condition}

最新进展(最后一条助手消息):
${lastAssistantMsg}

返回 JSON(不要代码块包裹): {"met": true/false, "reason": "简短理由(是否达成 + 下一步)"}`
}
