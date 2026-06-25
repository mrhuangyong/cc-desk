// tests/relay/router.test.ts
import { describe, it, expect, vi } from 'vitest'
import { makeEnvelope } from '../../src/shared/remote-protocol'

describe('router 路由转发', () => {
  it('已绑定设备签名合法的消息转发给对端', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M', 'M': 'D' })
    const desktopKey = 'a2V5LWQ='
    const router = createRouter(bindings, () => desktopKey) // 注入查密钥函数
    const sentToMobile: any[] = []
    router.register('D', (env) => {}) // 桌面在线但不接收本条
    router.register('M', (env) => sentToMobile.push(env))
    const env = makeEnvelope(desktopKey, 'session.delta', 'D', { text: 'hi' })
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(sentToMobile).toHaveLength(1)
  })

  it('未绑定设备 route 失败（unbound）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({})
    const router = createRouter(bindings, () => 'k')
    const env = makeEnvelope('k', 'session.delta', 'X', {})
    expect(router.route(env).ok).toBe(false)
  })

  it('签名错误 route 失败（bad_sig）', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M' })
    const router = createRouter(bindings, () => 'correct-key')
    const env = makeEnvelope('wrong-key', 'session.delta', 'D', {})
    expect(router.route(env).reason).toBe('bad_sig')
  })

  it('对端不在线返回 peer_offline', async () => {
    const { createRouter } = await import('../../relay/router')
    const bindings = makeFakeBindings({ 'D': 'M' })
    const router = createRouter(bindings, () => 'k')
    router.register('D', () => {})
    const env = makeEnvelope('k', 'session.delta', 'D', {})
    const r = router.route(env)
    expect(r.ok).toBe(true)
    expect(r.delivered).toBe(false) // peer M 未注册
  })
})

function makeFakeBindings(map: Record<string, string>) {
  return {
    getPeer: (id: string) => map[id],
    has: (id: string) => id in map,
    addBinding: vi.fn(), removeBinding: vi.fn(),
  } as any
}
