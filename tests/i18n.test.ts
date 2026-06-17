import { describe, it, expect } from 'vitest'
import { translate, SUPPORTED_LANGS } from '../src/renderer/i18n'

describe('i18n 翻译', () => {
  it('zh-CN 返回中文', () => {
    expect(translate('zh-CN', 'settings.general')).toBe('常规')
    expect(translate('zh-CN', 'chat.empty')).toBe('开始新的对话')
  })
  it('en 返回英文', () => {
    expect(translate('en', 'settings.general')).toBe('General')
    expect(translate('en', 'chat.empty')).toBe('Start a new conversation')
  })
  it('缺失 key 回落到 zh-CN 再到 key 本身', () => {
    expect(translate('en', '不存在的key')).toBe('不存在的key')
  })
  it('支持的语言包含 zh-CN 与 en', () => {
    expect(SUPPORTED_LANGS.map(l => l.id)).toEqual(['zh-CN', 'en'])
  })
})
