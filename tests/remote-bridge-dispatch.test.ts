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
})
