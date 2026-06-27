// tests/remote-bridge-session-list.test.ts
// Task 14 Fix 轮 I2：session.list 下发 + dispatcher 的 attach/create 分支。
//
// buildSessionListPayload：从工作区快照扁平化构造 session.list payload（纯函数）。
// dispatcher：session.attach 调 onAttach，session.create 调 onSessionCreate（未注入时静默）。
import { describe, it, expect, vi } from 'vitest'

describe('buildSessionListPayload', () => {
  it('扁平化多项目会话，带 projectId/projectName', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'proj-1', sessions: [
        { id: 's1', title: '会话A' },
        { id: 's2', title: '会话B' },
      ] },
      { id: 'p2', name: 'proj-2', sessions: [{ id: 's3', title: '会话C' }] },
    ])
    expect(r.sessions.map((s) => s.localSessionId)).toEqual(['s1', 's2', 's3'])
    expect(r.sessions[0]).toMatchObject({ localSessionId: 's1', title: '会话A', projectId: 'p1', projectName: 'proj-1', status: 'idle' })
  })

  it('排除已归档会话', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'p', sessions: [
        { id: 's1', title: '活跃' },
        { id: 's2', title: '归档', archived: true },
      ] },
    ])
    expect(r.sessions.map((s) => s.localSessionId)).toEqual(['s1'])
  })

  it('空标题回退为 (未命名会话)', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'p', sessions: [{ id: 's1', title: '' }] },
    ])
    expect(r.sessions[0].title).toBe('(未命名会话)')
  })

  it('空项目列表 → 空 sessions', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    expect(buildSessionListPayload([]).sessions).toEqual([])
  })

  it('runningIds 命中的会话 status=running，否则 idle', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'p', sessions: [
        { id: 's1', title: '在跑' },
        { id: 's2', title: '没跑' },
      ] },
    ], ['s1'])
    expect(r.sessions.find((s) => s.localSessionId === 's1')?.status).toBe('running')
    expect(r.sessions.find((s) => s.localSessionId === 's2')?.status).toBe('idle')
  })

  it('projectsMeta 带项目路径，按首次出现顺序，只含活跃会话的项目', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'proj-1', path: '/Users/x/proj-1', sessions: [{ id: 's1', title: 'a' }] },
      { id: 'p2', name: 'proj-2', path: '/Users/x/proj-2', sessions: [{ id: 's2', title: 'b', archived: true }] }, // 全归档
      { id: 'p3', name: 'proj-3', sessions: [{ id: 's3', title: 'c' }] }, // 无 path
    ])
    expect(r.projectsMeta.map((m) => m.projectId)).toEqual(['p1', 'p3']) // p2 全归档被排除
    expect(r.projectsMeta[0]).toMatchObject({ projectName: 'proj-1', projectPath: '/Users/x/proj-1' })
    expect(r.projectsMeta[1].projectPath).toBeUndefined()
  })

  it('updatedAt 取会话的 updatedAt，缺失时回退 lastUserSentAt', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'p', sessions: [
        { id: 's1', title: 'a', updatedAt: 1000 },
        { id: 's2', title: 'b', lastUserSentAt: 2000 },
        { id: 's3', title: 'c' },
      ] },
    ])
    expect(r.sessions.find((s) => s.localSessionId === 's1')?.updatedAt).toBe(1000)
    expect(r.sessions.find((s) => s.localSessionId === 's2')?.updatedAt).toBe(2000)
    expect(r.sessions.find((s) => s.localSessionId === 's3')?.updatedAt).toBeUndefined()
  })
})

describe('dispatcher session.attach / session.create', () => {
  it('session.attach 调 onAttach(localSessionId)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const onAttach = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn(), onAttach })
    await dispatch({ type: 'session.attach', deviceId: 'M', payload: { localSessionId: 's1' } } as any)
    expect(onAttach).toHaveBeenCalledWith('s1')
  })

  it('session.attach 未注入 onAttach 时不报错（静默）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn() })
    await expect(dispatch({ type: 'session.attach', deviceId: 'M', payload: { localSessionId: 's1' } } as any)).resolves.not.toThrow()
  })

  it('session.create 调 onSessionCreate', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const onSessionCreate = vi.fn().mockReturnValue('s-new')
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn(), onSessionCreate })
    await dispatch({ type: 'session.create', deviceId: 'M', payload: {} } as any)
    expect(onSessionCreate).toHaveBeenCalledTimes(1)
  })

  it('session.create 未注入 onSessionCreate 时不报错（静默，不 mock）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn() })
    await expect(dispatch({ type: 'session.create', deviceId: 'M', payload: {} } as any)).resolves.not.toThrow()
  })
})

describe('forwarder sendSessionList', () => {
  it('session.list → session.list 协议消息（payload.sessions + projectsMeta）', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    fwd.sendSessionList({
      sessions: [
        { localSessionId: 's1', title: 'A', status: 'idle' },
        { localSessionId: 's2', title: 'B', status: 'running' },
      ],
      projectsMeta: [{ projectId: 'p1', projectName: 'P1', projectPath: '/a/b' }],
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('session.list')
    expect(sent[0].payload.sessions).toHaveLength(2)
    expect(sent[0].payload.sessions[0]).toMatchObject({ localSessionId: 's1', title: 'A', status: 'idle' })
    expect(sent[0].payload.projectsMeta[0]).toMatchObject({ projectId: 'p1', projectPath: '/a/b' })
    // 占位字段（由外层 send 重签）
    expect(sent[0].sig).toBe('')
  })
})
