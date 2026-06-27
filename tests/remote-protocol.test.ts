import { describe, it, expect } from 'vitest'
import {
  makeEnvelope,
  verifySig,
  genNonce,
  sign,
  isStale,
  isReplay,
  type Envelope,
} from '../src/shared/remote-protocol'

const KEY = 'dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1rZXktMTIzNDU2' // base64 test key

describe('remote-protocol 信封与签名', () => {
  it('makeEnvelope 生成合法信封并通过验签', () => {
    const env = makeEnvelope(KEY, 'session.delta', 'device-D', { text: 'hi' })
    expect(env.type).toBe('session.delta')
    expect(env.deviceId).toBe('device-D')
    expect(env.v).toBe(1)
    expect(typeof env.sig).toBe('string')
    expect(verifySig(KEY, env)).toBe(true)
  })

  it('篡改 payload 后验签失败', () => {
    const env = makeEnvelope(KEY, 'session.delta', 'device-D', { text: 'hi' })
    const tampered = { ...env, payload: { text: 'hacked' } }
    expect(verifySig(KEY, tampered)).toBe(false)
  })

  it('错误密钥验签失败', () => {
    const env = makeEnvelope(KEY, 'session.delta', 'device-D', { text: 'hi' })
    expect(verifySig('wrong-base64-key', env)).toBe(false)
  })

  it('genNonce 每次不同且足够长', () => {
    const a = genNonce(), b = genNonce()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(16)
  })
})

describe('remote-protocol 会话管理消息类型', () => {
  it('session.created（桌面→手机）是合法消息类型，可签名可验签', () => {
    const env = makeEnvelope(KEY, 'session.created', 'device-D', { localSessionId: 's1', projectId: 'p1', title: '新会话' })
    expect(env.type).toBe('session.created')
    expect(verifySig(KEY, env)).toBe(true)
  })

  it('session.archive（手机→桌面）是合法消息类型，可签名可验签', () => {
    const env = makeEnvelope(KEY, 'session.archive', 'device-M', { localSessionId: 's1' })
    expect(env.type).toBe('session.archive')
    expect(verifySig(KEY, env)).toBe(true)
  })
})

describe('remote-protocol 防重放', () => {
  it('isStale：超过 60s 容差判过期', () => {
    const now = Date.now()
    expect(isStale({ ts: now } as Envelope, now)).toBe(false)
    expect(isStale({ ts: now - 61_000 } as Envelope, now)).toBe(true)
    expect(isStale({ ts: now + 61_000 } as Envelope, now)).toBe(true)
  })

  it('isReplay：同一 nonce 第二次判为重放', () => {
    const seen = new Set<string>()
    const env = { nonce: 'abc123' } as Envelope
    expect(isReplay(env, seen)).toBe(false)
    expect(isReplay(env, seen)).toBe(true) // 第二次
  })
})
