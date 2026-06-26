// web/src/lib/session-list.test.ts
// session.list 信封 payload 解析与映射的纯逻辑测试（Task 14）。
import { describe, it, expect } from 'vitest'
import {
  parseSessionListPayload,
  parseSessionListFull,
  type SessionListItem,
  sessionStatusToLabel,
  isAttachableSession,
  relativeTime,
  shortPath,
  groupByProject,
  type ProjectGroup,
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
      { localSessionId: 's1', title: '修 bug', status: 'idle', projectId: '', projectName: '' },
      { localSessionId: 's2', title: '加功能', status: 'running', projectId: '', projectName: '' },
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
    expect(isAttachableSession({ localSessionId: 's1', title: '', status: 'idle', projectId: '', projectName: '' })).toBe(true)
  })
})

describe('parseSessionListPayload 项目字段', () => {
  it('保留 projectId / projectName（桌面端 buildSessionListPayload 已带）', () => {
    const payload = {
      sessions: [
        { localSessionId: 's1', title: 'a', status: 'idle', projectId: 'p1', projectName: 'cc-desk' },
        { localSessionId: 's2', title: 'b', status: 'running', projectId: 'p1', projectName: 'cc-desk' },
        { localSessionId: 's3', title: 'c', status: 'idle', projectId: 'p2', projectName: '其他项目' },
      ],
    }
    const r = parseSessionListPayload(payload)
    expect(r[0]).toMatchObject({ projectId: 'p1', projectName: 'cc-desk' })
    expect(r[2]).toMatchObject({ projectId: 'p2', projectName: '其他项目' })
  })

  it('projectId / projectName 缺失时回退（兼容旧桌面端或异常）', () => {
    const r = parseSessionListPayload({ sessions: [{ localSessionId: 's1', title: 'a' }] })
    expect(r[0].projectId).toBe('')
    expect(r[0].projectName).toBe('')
  })
})

describe('groupByProject', () => {
  it('按 projectId 分组，保留项目内会话顺序', () => {
    const sessions: SessionListItem[] = [
      { localSessionId: 's1', title: 'a', status: 'idle', projectId: 'p1', projectName: 'P1' },
      { localSessionId: 's2', title: 'b', status: 'running', projectId: 'p1', projectName: 'P1' },
      { localSessionId: 's3', title: 'c', status: 'idle', projectId: 'p2', projectName: 'P2' },
    ]
    const groups = groupByProject(sessions)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ projectId: 'p1', projectName: 'P1' })
    expect(groups[0].sessions.map((s) => s.localSessionId)).toEqual(['s1', 's2'])
    expect(groups[1].projectId).toBe('p2')
  })

  it('保留项目首次出现的顺序（按 projectId 去重）', () => {
    const sessions: SessionListItem[] = [
      { localSessionId: 's1', title: 'a', status: 'idle', projectId: 'p2', projectName: 'P2' },
      { localSessionId: 's2', title: 'b', status: 'idle', projectId: 'p1', projectName: 'P1' },
      { localSessionId: 's3', title: 'c', status: 'idle', projectId: 'p2', projectName: 'P2' },
    ]
    const groups = groupByProject(sessions)
    expect(groups.map((g) => g.projectId)).toEqual(['p2', 'p1'])
    // p2 的两场会话归到同一组
    expect(groups[0].sessions.map((s) => s.localSessionId)).toEqual(['s1', 's3'])
  })

  it('projectId 为空的会话归到「未分组」项目', () => {
    const sessions: SessionListItem[] = [
      { localSessionId: 's1', title: 'a', status: 'idle', projectId: '', projectName: '' },
      { localSessionId: 's2', title: 'b', status: 'idle', projectId: 'p1', projectName: 'P1' },
    ]
    const groups = groupByProject(sessions)
    expect(groups).toHaveLength(2)
    // 未分组项目
    const ungrouped = groups.find((g) => g.projectId === '')
    expect(ungrouped?.sessions).toHaveLength(1)
    expect(ungrouped?.projectName).toBe('未分组')
  })

  it('空数组返回空分组', () => {
    expect(groupByProject([])).toEqual([])
  })

  it('projectsMeta 提供项目路径，透传到分组', () => {
    const sessions: SessionListItem[] = [
      { localSessionId: 's1', title: 'a', status: 'idle', projectId: 'p1', projectName: 'P1' },
    ]
    const groups = groupByProject(sessions, [{ projectId: 'p1', projectName: 'P1', projectPath: '/x/P1' }])
    expect(groups[0].projectPath).toBe('/x/P1')
  })
})

describe('parseSessionListFull', () => {
  it('同时返回 sessions 和 projectsMeta', () => {
    const data = parseSessionListFull({
      sessions: [{ localSessionId: 's1', title: 'a', status: 'idle', projectId: 'p1', updatedAt: 1000 }],
      projectsMeta: [{ projectId: 'p1', projectName: 'P1', projectPath: '/a/P1' }],
    })
    expect(data.sessions[0].updatedAt).toBe(1000)
    expect(data.projectsMeta[0].projectPath).toBe('/a/P1')
  })

  it('无 projectsMeta 字段时返回空数组（兼容）', () => {
    const data = parseSessionListFull({ sessions: [{ localSessionId: 's1', title: 'a' }] })
    expect(data.projectsMeta).toEqual([])
  })
})

describe('sessionStatusToLabel 扩展', () => {
  it('completed → 已完成', () => {
    expect(sessionStatusToLabel('completed')).toBe('已完成')
  })
  it('error → 出错', () => {
    expect(sessionStatusToLabel('error')).toBe('出错')
  })
})

describe('relativeTime', () => {
  it('undefined → 空串', () => {
    expect(relativeTime(undefined)).toBe('')
  })
  it('<1 分钟 → 刚刚', () => {
    expect(relativeTime(Date.now() - 30000)).toBe('刚刚')
  })
  it('>=30 天 → N 个月前', () => {
    expect(relativeTime(Date.now() - 35 * 86_400_000)).toBe('1 个月前')
  })
})

describe('shortPath', () => {
  it('undefined → 空串', () => {
    expect(shortPath(undefined)).toBe('')
  })
  it('长路径中间用 … 截断', () => {
    expect(shortPath('/Users/mrhua/projects/cc-desk')).toBe('~/Users/…/projects/cc-desk')
  })
  it('短路径（<=3 段）取末两段', () => {
    expect(shortPath('/a/b')).toBe('~/a/b')
  })
})
