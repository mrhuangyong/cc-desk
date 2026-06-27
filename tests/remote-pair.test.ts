// remote-pair 纯函数单测：配对消息构造、二维码 URL 拼接、响应类型守卫。
// 被测对象无 IO，不依赖 Electron/网络，直接 import 断言。
import { describe, it, expect } from 'vitest'
import {
  buildPairCodeRequest, buildPairUrl,
  isPairCodeResponse, isPairErrorResponse, isPairRequestEnvelope,
} from '../src/main/remote-pair'
import { makeEnvelope } from '../src/shared/remote-protocol'

describe('remote-pair', () => {
  describe('buildPairCodeRequest', () => {
    it('构造中继 /pair 端点期望的明文请求消息', () => {
      const req = buildPairCodeRequest('dev-1', 'aGV5')
      expect(req).toEqual({ type: 'pair.code', deviceId: 'dev-1', deviceKey: 'aGV5' })
    })
  })

  describe('buildPairUrl', () => {
    it('拼出 base/?pair=code 形式', () => {
      expect(buildPairUrl('https://ccdesk.mrhua.top', '123456'))
        .toBe('https://ccdesk.mrhua.top/?pair=123456')
    })

    it('归一尾部斜杠（避免 base//?pair=）', () => {
      expect(buildPairUrl('https://ccdesk.mrhua.top/', '999999'))
        .toBe('https://ccdesk.mrhua.top/?pair=999999')
    })

    it('归一多个尾部斜杠', () => {
      expect(buildPairUrl('https://ccdesk.mrhua.top///', '000001'))
        .toBe('https://ccdesk.mrhua.top/?pair=000001')
    })

    it('对特殊字符 code 做 encode', () => {
      expect(buildPairUrl('https://x.top', 'a b/c'))
        .toBe('https://x.top/?pair=a%20b%2Fc')
    })
  })

  describe('isPairCodeResponse', () => {
    it('识别合法 pair.code 响应', () => {
      expect(isPairCodeResponse({ type: 'pair.code', payload: { code: '123456', expiresAt: 1 } })).toBe(true)
    })
    it('拒绝错误 type', () => {
      expect(isPairCodeResponse({ type: 'error', payload: { code: 'x' } })).toBe(false)
    })
    it('拒绝缺失 code 字段', () => {
      expect(isPairCodeResponse({ type: 'pair.code', payload: {} })).toBe(false)
    })
    it('拒绝非对象', () => {
      expect(isPairCodeResponse(null)).toBe(false)
      expect(isPairCodeResponse('str')).toBe(false)
    })
  })

  describe('isPairErrorResponse', () => {
    it('识别 error 响应', () => {
      expect(isPairErrorResponse({ type: 'error', payload: { code: 'bad_pair_code' } })).toBe(true)
    })
    it('拒绝非 error', () => {
      expect(isPairErrorResponse({ type: 'pair.code', payload: { code: '1' } })).toBe(false)
    })
  })

  describe('isPairRequestEnvelope', () => {
    it('识别 pair.request 信封', () => {
      const env = makeEnvelope('aGV5', 'pair.request', 'mobile-1', { foo: 1 })
      expect(isPairRequestEnvelope(env)).toBe(true)
    })
    it('拒绝业务信封', () => {
      const env = makeEnvelope('aGV5', 'session.message', 'mobile-1', { text: 'hi' })
      expect(isPairRequestEnvelope(env)).toBe(false)
    })
  })
})
