// web/src/lib/session-list.test.ts
// session.list 信封 payload 解析与映射的纯逻辑测试（Task 14）。
import { describe, it, expect } from 'vitest'
import {
  parseSessionListPayload,
  type SessionListItem,
  sessionStatusToLabel,
  isAttachableSession,
} from './session-list'

describe('parseSessionListPayload', () => {
  it('解析合法 payload 为会话列表（保留顺序）', () => {
    const payload = {
      sessions: [
        { localSessionId: 's1', title: '修 bug', status: 'idle' },
        { localSessionId: 's2', title: '加功能', status: 'running' },
      ],
    }
    expect(parseSessionListPayload(payload)).toEqual<SessionListItem[]>([
      { localSessionId: 's1', title: '修 bug', status: 'idle' },
      { localSessionId: 's2', title: '加功能', status: 'running' },
    ])
  })

  it('缺失 sessions 字段返回空数组（容错）', () => {
    expect(parseSessionListPayload({})).toEqual([])
    expect(parseSessionListPayload(null)).toEqual([])
    expect(parseSessionListPayload(undefined)).toEqual([])
  })

  it('过滤掉缺 localSessionId 的非法条目（半结构容错）', () => {
    const payload = {
      sessions: [
        { localSessionId: 's1', title: 'a' },
        { title: '无 id' }, // 非法
        { localSessionId: 's2', status: 'running' }, // title 缺失允许
      ],
    }
    const r = parseSessionListPayload(payload)
    expect(r.map((x) => x.localSessionId)).toEqual(['s1', 's2'])
  })

  it('title 缺失时回退为空串（不报错）', () => {
    const r = parseSessionListPayload({ sessions: [{ localSessionId: 'x' }] })
    expect(r[0].title).toBe('')
  })

  it('未知 status 原样保留（append-only 思想，不丢字段）', () => {
    const r = parseSessionListPayload({
      sessions: [{ localSessionId: 'x', status: 'unknown_state' }],
    })
    expect(r[0].status).toBe('unknown_state')
  })
})

describe('sessionStatusToLabel', () => {
  it('running → 进行中', () => {
    expect(sessionStatusToLabel('running')).toBe('进行中')
  })
  it('idle → 空闲', () => {
    expect(sessionStatusToLabel('idle')).toBe('空闲')
  })
  it('未知 status 回退到 status 原值', () => {
    expect(sessionStatusToLabel('foo')).toBe('foo')
  })
  it('空 status 回退到「空闲」', () => {
    expect(sessionStatusToLabel('')).toBe('空闲')
  })
})

describe('isAttachableSession', () => {
  it('有 localSessionId 即可 attach', () => {
    expect(isAttachableSession({ localSessionId: 's1', title: '', status: 'idle' })).toBe(true)
  })
})
