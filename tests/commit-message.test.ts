import { describe, it, expect } from 'vitest'
// trimDiffForPrompt 必须从 claude-service 导出（见 Step 3）
import { trimDiffForPrompt } from '../src/main/claude-service'

describe('trimDiffForPrompt', () => {
  it('短 diff 原样返回', () => {
    const d = 'diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n'
    expect(trimDiffForPrompt(d, 8000)).toBe(d)
  })

  it('超长 diff 截断并标注', () => {
    const file = 'diff --git a/f b/f\n@@ -1,100 +1,100 @@\n' + Array(200).fill('+line').join('\n') + '\n'
    const big = file.repeat(10)
    const out = trimDiffForPrompt(big, 8000)
    expect(out.length).toBeLessThanOrEqual(8200)   // 含标注余量
    expect(out).toContain('diff --git')
    expect(out).toMatch(/截断|truncat/i)
  })

  it('空 diff 返回空串', () => {
    expect(trimDiffForPrompt('', 8000)).toBe('')
    expect(trimDiffForPrompt('   \n  ', 8000)).toBe('')
  })
})
