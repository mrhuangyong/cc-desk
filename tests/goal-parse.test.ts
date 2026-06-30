import { describe, it, expect } from 'vitest'
// 测 shared 层的规范源（主进程 remote-bridge 与渲染端 InputBar 均复用此函数）。
// renderer/editor/goalParse.ts 仅 re-export，所以测 shared 即覆盖两端。
import { parseGoalCommand } from '../src/shared/goal-parse'

describe('parseGoalCommand', () => {
  it('/goal <条件> → set', () => {
    expect(parseGoalCommand('/goal all tests pass')).toEqual({ kind: 'set', condition: 'all tests pass' })
  })
  it('/goal(精确无参) → check', () => {
    expect(parseGoalCommand('/goal')).toEqual({ kind: 'check' })
    expect(parseGoalCommand('/goal   ')).toEqual({ kind: 'check' })  // 尾随空格
  })
  it('/goal clear → clear', () => {
    expect(parseGoalCommand('/goal clear')).toEqual({ kind: 'clear' })
  })
  it('/goal 别名 → clear', () => {
    for (const alias of ['stop', 'off', 'reset', 'none', 'cancel']) {
      expect(parseGoalCommand(`/goal ${alias}`)).toEqual({ kind: 'clear' })
    }
  })
  it('非 /goal 开头 → null', () => {
    expect(parseGoalCommand('hello')).toBeNull()
    expect(parseGoalCommand('/init')).toBeNull()
  })
  it('条件保留多文本(含空格)', () => {
    expect(parseGoalCommand('/goal npm test exits 0 and git status is clean'))
      .toEqual({ kind: 'set', condition: 'npm test exits 0 and git status is clean' })
  })
})
