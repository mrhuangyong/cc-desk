// tests/remote-bridge-dispatch.test.ts
// Task 8: 入站命令分发（手机→桌面）。
// 验证 createDispatcher 把手机命令白名单分发到对应的桌面 API。
import { describe, it, expect, vi } from 'vitest'

describe('remote-bridge 入站分发', () => {
  it('session.message → 调 send({prompt, localSessionId})', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi' } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'hi', localSessionId: 's1' }))
  })

  it('session.message 带 permission 时 → 透传给 send（中文权限标签）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi', permission: '计划模式' } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'hi', localSessionId: 's1', permission: '计划模式' }))
  })

  it('session.message 带 extraDirs 时 → 透传给 send（附加目录数组）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi', extraDirs: ['/a/b', '/c/d'] } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ extraDirs: ['/a/b', '/c/d'] }))
  })

  it('session.message 带 images 时 → 透传给 send（base64 图片数组）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    const images = [{ mediaType: 'image/png', data: 'iVBORw0KGgo=', name: 'x.png' }]
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '看图', images } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ images }))
  })

  it('session.message 不带新字段时 → 向后兼容（permission/extraDirs/images 为 undefined）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi' } } as any)
    const call = send.mock.calls[0][0]
    expect(call.permission).toBeUndefined()
    expect(call.extraDirs).toBeUndefined()
    expect(call.images).toBeUndefined()
  })

  it('session.message 带 claudeSessionId 时 → 透传 sessionId 给 send（修复失忆）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn() })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi', claudeSessionId: 'cs-abc' } } as any)
    // claudeSessionId 必须作为 sessionId 透传，让 claude.send 的 resume 生效，避免失忆
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'hi', localSessionId: 's1', sessionId: 'cs-abc' }))
  })

  it('session.message 无 claudeSessionId 时 → 回退到 resolveClaudeSessionId 反查（双保险）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    // 反查注入：手机未带 sessionId 时，从主进程 projects-store 的 claudeSessionMap 兜底
    const resolveClaudeSessionId = vi.fn().mockReturnValue('cs-from-store')
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn(), resolveClaudeSessionId })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi' } } as any)
    expect(resolveClaudeSessionId).toHaveBeenCalledWith('s1')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ localSessionId: 's1', sessionId: 'cs-from-store' }))
  })

  it('session.message payload 和反查都没有 sessionId 时 → sessionId 为 undefined（开新会话）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const resolveClaudeSessionId = vi.fn().mockReturnValue(undefined)
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn(), resolveClaudeSessionId })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: 'hi' } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ sessionId: undefined }))
  })

  it('session.message → 调 notifyRemoteUserMessage 把 user 文本推给桌面（修复桌面看不到）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const notifyRemoteUserMessage = vi.fn()
    const dispatch = createDispatcher({ send, interrupt: vi.fn(), resolveDialog: vi.fn(), notifyRemoteUserMessage })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '从手机发的问题' } } as any)
    // user 文本必须被推给桌面 renderer，否则桌面端对话里只有 AI 回复、看不到问题
    expect(notifyRemoteUserMessage).toHaveBeenCalledWith('s1', '从手机发的问题')
  })

  it('session.interrupt → 调 interrupt(localSessionId)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const interrupt = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt, resolveDialog: vi.fn() })
    await dispatch({ type: 'session.interrupt', deviceId: 'M', payload: { localSessionId: 's1' } } as any)
    expect(interrupt).toHaveBeenCalledWith('s1')
  })

  it('dialog.response → 调 resolveDialog(reqId, result)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const resolveDialog = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog })
    await dispatch({ type: 'dialog.response', deviceId: 'M', payload: { reqId: 'r1', result: { ok: true } } } as any)
    expect(resolveDialog).toHaveBeenCalledWith('r1', { ok: true })
  })

  it('未知 type 不抛错（静默忽略）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn() })
    await expect(dispatch({ type: 'unknown.type', deviceId: 'M', payload: {} } as any)).resolves.not.toThrow()
  })

  it('session.sync → 调 onSync（重推列表）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const onSync = vi.fn()
    const dispatch = createDispatcher({ send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn(), onSync })
    await dispatch({ type: 'session.sync', deviceId: 'M', payload: {} } as any)
    expect(onSync).toHaveBeenCalledTimes(1)
  })

  it('session.create → 调 onSessionCreate 拿到结果后调 onSessionCreated 回告', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const createdInfo = { localSessionId: 'remote-s-1', projectId: 'p1', title: '新会话', cwd: '/code/x' }
    const onSessionCreate = vi.fn().mockReturnValue(createdInfo)
    const onSessionCreated = vi.fn()
    const dispatch = createDispatcher({
      send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn(),
      onSessionCreate, onSessionCreated,
    })
    await dispatch({ type: 'session.create', deviceId: 'M', payload: { projectId: 'p1' } } as any)
    expect(onSessionCreate).toHaveBeenCalledWith('p1')
    // 回告必须带上 onSessionCreate 返回的完整会话信息
    expect(onSessionCreated).toHaveBeenCalledWith(createdInfo)
  })

  it('session.create 返回 null（不支持远程新建）时不调 onSessionCreated（静默）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const onSessionCreate = vi.fn().mockReturnValue(null)
    const onSessionCreated = vi.fn()
    const dispatch = createDispatcher({
      send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn(),
      onSessionCreate, onSessionCreated,
    })
    await dispatch({ type: 'session.create', deviceId: 'M', payload: { projectId: 'p1' } } as any)
    expect(onSessionCreated).not.toHaveBeenCalled()
  })

  it('session.archive → 调 onArchive(localSessionId)', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const onArchive = vi.fn()
    const dispatch = createDispatcher({
      send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn(), onArchive,
    })
    await dispatch({ type: 'session.archive', deviceId: 'M', payload: { localSessionId: 's9' } } as any)
    expect(onArchive).toHaveBeenCalledWith('s9')
  })

  // ===== /goal 三态拦截（手机端 /goal 经 session.message 文本触发）=====

  it('/goal set → 调 onGoalSet(condition) + send(condition)，不调 getGoalStatus/onGoalStatus', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const onGoalSet = vi.fn()
    const getGoalStatus = vi.fn()
    const onGoalStatus = vi.fn()
    const dispatch = createDispatcher({
      send, interrupt: vi.fn(), resolveDialog: vi.fn(),
      onGoalSet, getGoalStatus, onGoalStatus,
    })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '/goal 所有测试通过' } } as any)
    expect(onGoalSet).toHaveBeenCalledWith('s1', '所有测试通过')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: '所有测试通过', localSessionId: 's1' }))
    // set 路径不应触发 status 查询
    expect(getGoalStatus).not.toHaveBeenCalled()
    expect(onGoalStatus).not.toHaveBeenCalled()
  })

  it('/goal clear → 调 onGoalSet(null) + interrupt，不调 send', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const interrupt = vi.fn()
    const onGoalSet = vi.fn()
    const dispatch = createDispatcher({
      send, interrupt, resolveDialog: vi.fn(), onGoalSet,
    })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '/goal clear' } } as any)
    expect(onGoalSet).toHaveBeenCalledWith('s1', null)
    expect(interrupt).toHaveBeenCalledWith('s1')
    expect(send).not.toHaveBeenCalled()
  })

  it('/goal check → 调 getGoalStatus + onGoalStatus 回告，不调 send/onGoalSet', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const onGoalSet = vi.fn()
    const goal = { condition: 'cond', status: 'active', turns: 3 }
    const getGoalStatus = vi.fn().mockReturnValue(goal)
    const onGoalStatus = vi.fn()
    const dispatch = createDispatcher({
      send, interrupt: vi.fn(), resolveDialog: vi.fn(),
      onGoalSet, getGoalStatus, onGoalStatus,
    })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '/goal' } } as any)
    expect(getGoalStatus).toHaveBeenCalledWith('s1')
    expect(onGoalStatus).toHaveBeenCalledWith('s1', goal)
    expect(send).not.toHaveBeenCalled()
    expect(onGoalSet).not.toHaveBeenCalled()
  })

  it('/goal check 无 goal 时 → 回告 null', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const onGoalStatus = vi.fn()
    const getGoalStatus = vi.fn().mockReturnValue(null)
    const dispatch = createDispatcher({
      send: vi.fn(), interrupt: vi.fn(), resolveDialog: vi.fn(),
      onGoalSet: vi.fn(), getGoalStatus, onGoalStatus,
    })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '/goal   ' } } as any)
    expect(onGoalStatus).toHaveBeenCalledWith('s1', null)
  })

  it('/goal set 带 claudeSessionId → 透传 sessionId 给 send（首轮续接历史）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const dispatch = createDispatcher({
      send, interrupt: vi.fn(), resolveDialog: vi.fn(), onGoalSet: vi.fn(),
    })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '/goal x', claudeSessionId: 'cs-1' } } as any)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'x', sessionId: 'cs-1' }))
  })

  it('非 /goal 文本 → 走普通 session.message（不触发 goal 拦截）', async () => {
    const { createDispatcher } = await import('../src/main/remote-bridge')
    const send = vi.fn().mockResolvedValue(undefined)
    const onGoalSet = vi.fn()
    const getGoalStatus = vi.fn()
    const dispatch = createDispatcher({
      send, interrupt: vi.fn(), resolveDialog: vi.fn(),
      onGoalSet, getGoalStatus,
    })
    await dispatch({ type: 'session.message', deviceId: 'M', payload: { localSessionId: 's1', text: '帮我看下 /goal 这个路径' } } as any)
    // 含 /goal 但不在开头，parseGoalCommand 返回 null，走普通 send
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ prompt: '帮我看下 /goal 这个路径' }))
    expect(onGoalSet).not.toHaveBeenCalled()
    expect(getGoalStatus).not.toHaveBeenCalled()
  })
})
