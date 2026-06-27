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

  it('projectsMeta 带项目路径，按首次出现顺序；有 path 的项目即使全归档也保留（用户还要建新会话）', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'proj-1', path: '/Users/x/proj-1', sessions: [{ id: 's1', title: 'a' }] },
      { id: 'p2', name: 'proj-2', path: '/Users/x/proj-2', sessions: [{ id: 's2', title: 'b', archived: true }] }, // 全归档但有 path：保留
      { id: 'p3', name: 'proj-3', sessions: [{ id: 's3', title: 'c' }] }, // 无 path 但有活跃会话：保留
      { id: 'p-junk', name: '占位', sessions: [{ id: 's4', title: 'd', archived: true }] }, // 无 path 且全归档：排除
    ])
    // p2 全归档但仍是真实工作目录，必须保留（否则用户归档最后一条会话后项目消失、无法新建会话）
    expect(r.projectsMeta.map((m) => m.projectId)).toEqual(['p1', 'p2', 'p3'])
    expect(r.projectsMeta[0]).toMatchObject({ projectName: 'proj-1', projectPath: '/Users/x/proj-1' })
    expect(r.projectsMeta[1]).toMatchObject({ projectName: 'proj-2', projectPath: '/Users/x/proj-2' })
    expect(r.projectsMeta[2].projectPath).toBeUndefined()
  })

  it('移动端归档最后一条会话后，项目仍在 projectsMeta（修复：删除最后会话项目消失）', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    // 场景：项目原本有一条会话，移动端把它归档（archived=true）→ 项目无活跃会话
    const r = buildSessionListPayload([
      { id: 'p1', name: 'my-proj', path: '/code/my-proj', sessions: [{ id: 's1', title: '唯一的会话', archived: true }] },
    ])
    // 项目必须仍在，用户才能在它下面新建会话（否则删除最后一条会话后项目凭空消失）
    expect(r.projectsMeta.map((m) => m.projectId)).toContain('p1')
    expect(r.sessions).toEqual([]) // 归档的会话不出现在会话列表
  })

  it('projectsMeta 包含无会话的空项目（修复：桌面新增工作目录后移动端刷新看不到）', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'proj-1', path: '/Users/x/proj-1', sessions: [{ id: 's1', title: 'a' }] },
      { id: 'p-new', name: '新增工作目录', path: '/Users/x/new', sessions: [] }, // 桌面新加的项目，暂无会话
    ])
    // 空项目必须进入 projectsMeta，否则移动端刷新拿不到这个新项目、无法在它下面建会话
    const ids = r.projectsMeta.map((m) => m.projectId)
    expect(ids).toContain('p1')
    expect(ids).toContain('p-new')
    expect(r.projectsMeta.find((m) => m.projectId === 'p-new')).toMatchObject({ projectName: '新增工作目录', projectPath: '/Users/x/new' })
  })

  it('projectsMeta 不包含无 path 的占位空项目（避免无意义项目刷屏）', async () => {
    const { buildSessionListPayload } = await import('../src/main/remote-bridge')
    const r = buildSessionListPayload([
      { id: 'p1', name: 'real', path: '/Users/x/real', sessions: [] }, // 有 path 的真实空项目：保留
      { id: 'p-junk', name: '占位', sessions: [] }, // 无 path 无会话：排除
    ])
    const ids = r.projectsMeta.map((m) => m.projectId)
    expect(ids).toContain('p1')
    expect(ids).not.toContain('p-junk')
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
