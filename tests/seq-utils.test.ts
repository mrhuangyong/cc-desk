import { describe, it, expect } from 'vitest'
import { computeLastSeq } from '../src/main/seq-utils'

describe('computeLastSeq', () => {
  it('从 projects 里 p/s/m id 取最大序号', () => {
    const snap = {
      projects: [
        {
          id: 'p2', sessions: [
            { id: 's5', messages: [{ id: 'm9', role: 'user', content: 'x' }] },
          ],
        },
      ],
      tabsBySession: { s5: [{ id: 't3', type: 'file', title: 'a' }] },
    }
    expect(computeLastSeq(snap)).toBe(9)
  })

  it('忽略非 [psmt]前缀或不带数字的 id', () => {
    const snap = {
      projects: [{ id: 'p2', sessions: [{ id: 'abc', messages: [{ id: 'msg-1', role: 'user', content: 'x' }] }] }],
      tabsBySession: {},
    }
    expect(computeLastSeq(snap)).toBe(2)
  })

  it('空快照返回 0', () => {
    expect(computeLastSeq({ projects: [], tabsBySession: {} })).toBe(0)
  })

  it('缺字段时不报错', () => {
    expect(computeLastSeq({})).toBe(0)
  })
})
