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
  it('session.list → session.list 协议消息（payload.sessions）', async () => {
    const { createEventForwarder } = await import('../src/main/remote-bridge')
    const sent: any[] = []
    const fwd = createEventForwarder((env) => sent.push(env))
    fwd.sendSessionList([
      { localSessionId: 's1', title: 'A', status: 'idle' },
      { localSessionId: 's2', title: 'B', status: 'running' },
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('session.list')
    expect(sent[0].payload.sessions).toHaveLength(2)
    expect(sent[0].payload.sessions[0]).toMatchObject({ localSessionId: 's1', title: 'A', status: 'idle' })
    // 占位字段（由外层 send 重签）
    expect(sent[0].sig).toBe('')
  })
})
