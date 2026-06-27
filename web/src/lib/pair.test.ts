// web/src/lib/pair.test.ts
// 配对流程的纯函数单测（TDD）。
//
// 测试边界（Musk Algorithm：删除不可测的、只测真实可测的）：
// - 真实 WebSocket 连中继 /pair 走 e2e，这里不 mock 协议/传输。
// - 可测纯逻辑：
//   1) URL ?pair=code 解析（扫码直达）
//   2) 配对请求消息构造（pair.consume）
//   3) 配对成功响应校验（pair.success payload 字段）
//   4) 配对失败响应识别（error/bad_pair_code）
//   5) 设备身份生成（deviceId 形态、deviceKey 是合法 base64 且可验签）
//   6) 本地存储读写（设备身份 + 配对结果）
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  parsePairCodeFromUrl,
  buildPairConsumeMessage,
  isPairSuccess,
  extractPairSuccess,
  isPairError,
  generateDeviceId,
  generateDeviceKey,
  loadDeviceIdentity,
  saveDeviceIdentity,
  loadDesktopIdentity,
  saveDesktopIdentity,
  clearPairingStorage,
} from './pair'

describe('parsePairCodeFromUrl 解析 ?pair=code', () => {
  it('从完整 URL 解析出 6 位码', () => {
    expect(parsePairCodeFromUrl('https://ccdesk.mrhua.top/?pair=123456')).toBe('123456')
  })

  it('从相对 search 解析', () => {
    expect(parsePairCodeFromUrl('/?pair=654321')).toBe('654321')
  })

  it('保留其他参数时仍取 pair', () => {
    expect(parsePairCodeFromUrl('https://h/?utm=x&pair=999888&foo=bar')).toBe('999888')
  })

  it('无 pair 参数返回 null', () => {
    expect(parsePairCodeFromUrl('https://h/?foo=bar')).toBeNull()
  })

  it('空 URL 返回 null', () => {
    expect(parsePairCodeFromUrl('')).toBeNull()
  })

  it('pair 为空值返回 null', () => {
    expect(parsePairCodeFromUrl('?pair=')).toBeNull()
  })

  it('过滤非 6 位数字码（要求恰好 6 位数字）', () => {
    expect(parsePairCodeFromUrl('?pair=12345')).toBeNull()   // 5 位
    expect(parsePairCodeFromUrl('?pair=1234567')).toBeNull() // 7 位
    expect(parsePairCodeFromUrl('?pair=abcdef')).toBeNull()  // 非数字
  })
})

describe('buildPairConsumeMessage 构造配对请求', () => {
  it('包含 type=pair.consume, deviceId, code, deviceKey', () => {
    const msg = buildPairConsumeMessage('phone-1', '123456', 'keyABC=')
    expect(msg.type).toBe('pair.consume')
    expect(msg.deviceId).toBe('phone-1')
    expect(msg.code).toBe('123456')
    expect(msg.deviceKey).toBe('keyABC=')
  })

  it('每次结构稳定（纯数据对象）', () => {
    const msg = buildPairConsumeMessage('p', '111222', 'k')
    expect(Object.keys(msg).sort()).toEqual(['code', 'deviceId', 'deviceKey', 'type'])
  })
})

describe('isPairSuccess / extractPairSuccess 识别成功响应', () => {
  it('pair.success 且 payload 含 desktopId + deviceKey 视为成功', () => {
    const resp = { type: 'pair.success', payload: { desktopId: 'desk-1', deviceKey: 'dk=' } }
    expect(isPairSuccess(resp)).toBe(true)
    expect(extractPairSuccess(resp)).toEqual({ desktopId: 'desk-1', desktopKey: 'dk=' })
  })

  it('非 pair.success 类型不是成功', () => {
    expect(isPairSuccess({ type: 'error', payload: {} })).toBe(false)
  })

  it('payload 缺字段视为非成功', () => {
    expect(isPairSuccess({ type: 'pair.success', payload: { desktopId: 'd' } })).toBe(false)
    expect(isPairSuccess({ type: 'pair.success', payload: {} })).toBe(false)
    expect(isPairSuccess({ type: 'pair.success' })).toBe(false)
  })

  it('extractPairSuccess 对非法输入返回 null', () => {
    expect(extractPairSuccess({ type: 'error' })).toBeNull()
  })
})

describe('isPairError 识别失败响应', () => {
  it('type=error 视为失败', () => {
    expect(isPairError({ type: 'error', payload: { code: 'bad_pair_code' } })).toBe(true)
  })

  it('bad_pair_code 错误码可识别', () => {
    const resp = { type: 'error', payload: { code: 'bad_pair_code' } }
    expect(isPairError(resp)).toBe(true)
  })

  it('非 error 类型不是失败', () => {
    expect(isPairError({ type: 'pair.success', payload: {} })).toBe(false)
  })
})

describe('设备身份生成', () => {
  it('generateDeviceId 返回带前缀的非空字符串', () => {
    const id = generateDeviceId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(id.startsWith('m-')).toBe(true) // m- 前缀表 mobile
  })

  it('generateDeviceId 每次不同（随机）', () => {
    expect(generateDeviceId()).not.toBe(generateDeviceId())
  })

  it('generateDeviceKey 返回合法 base64 字符串', () => {
    const key = generateDeviceKey()
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
    // base64 字符集
    expect(key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })

  it('generateDeviceKey 长度足够（>=32 字节解码后）', () => {
    const key = generateDeviceKey()
    const bin = atob(key)
    expect(bin.length).toBeGreaterThanOrEqual(32)
  })

  it('generateDeviceKey 每次不同', () => {
    expect(generateDeviceKey()).not.toBe(generateDeviceKey())
  })
})

describe('本地存储读写（设备身份 + 桌面身份）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saveDeviceIdentity / loadDeviceIdentity 往返一致', () => {
    saveDeviceIdentity('phone-1', 'keyABC=')
    expect(loadDeviceIdentity()).toEqual({ deviceId: 'phone-1', deviceKey: 'keyABC=' })
  })

  it('未存储时 loadDeviceIdentity 返回 null', () => {
    expect(loadDeviceIdentity()).toBeNull()
  })

  it('saveDesktopIdentity / loadDesktopIdentity 往返一致', () => {
    saveDesktopIdentity('desk-1', 'deskKey=')
    expect(loadDesktopIdentity()).toEqual({ desktopId: 'desk-1', desktopKey: 'deskKey=' })
  })

  it('未存储时 loadDesktopIdentity 返回 null', () => {
    expect(loadDesktopIdentity()).toBeNull()
  })

  it('clearPairingStorage 清空身份键', () => {
    saveDeviceIdentity('p', 'k')
    saveDesktopIdentity('d', 'k2')
    clearPairingStorage()
    expect(loadDeviceIdentity()).toBeNull()
    expect(loadDesktopIdentity()).toBeNull()
  })

  it('saveDeviceIdentity 保留未知 localStorage key（深合并/仅动受管字段）', () => {
    localStorage.setItem('unrelated', 'keep-me')
    saveDeviceIdentity('p', 'k')
    expect(localStorage.getItem('unrelated')).toBe('keep-me')
  })
})
