import { describe, it, expect } from 'vitest'
import { parseGoalVerdict } from '../src/main/goal-verdict'

describe('parseGoalVerdict', () => {
  it('合法 JSON met=true → 解析', () => {
    expect(parseGoalVerdict('{"met": true, "reason": "所有测试通过"}'))
      .toEqual({ met: true, reason: '所有测试通过' })
  })
  it('合法 JSON met=false → 解析', () => {
    expect(parseGoalVerdict('{"met": false, "reason": "还有 2 个失败"}'))
      .toEqual({ met: false, reason: '还有 2 个失败' })
  })
  it('JSON 被 markdown 代码块包裹 → 提取', () => {
    expect(parseGoalVerdict('```json\n{"met": true, "reason": "ok"}\n```'))
      .toEqual({ met: true, reason: 'ok' })
  })
  it('JSON 前后有多余文本 → 提取首个 JSON 对象', () => {
    expect(parseGoalVerdict('评估结果是:{"met": false, "reason": "未完成"} 谢谢'))
      .toEqual({ met: false, reason: '未完成' })
  })
  it('非法 JSON → A3 默认 met=false(继续轮) + reason 标注', () => {
    const r = parseGoalVerdict('乱码非JSON')
    expect(r.met).toBe(false)
    expect(r.reason).toMatch(/解析失败|无法解析/)
  })
  it('空响应 → A3 默认 met=false', () => {
    expect(parseGoalVerdict('').met).toBe(false)
    expect(parseGoalVerdict('   ').met).toBe(false)
  })
  it('缺少 reason → reason 兜底空串', () => {
    expect(parseGoalVerdict('{"met": true}')).toEqual({ met: true, reason: '' })
  })
})
