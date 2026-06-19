// i18n 字典完整性 + translate 边界测试。
// 防止新增 key 时只在 zh-CN 加而漏掉 en（界面出现中文残留或 key 原文）。
import { describe, it, expect } from 'vitest'
import { translate, dictKeys, SUPPORTED_LANGS } from '../src/renderer/i18n/index'

describe('i18n 字典完整性', () => {
  it('zh-CN 与 en 的 key 集合完全一致（漏译检测）', () => {
    const zh = dictKeys('zh-CN').sort()
    const en = dictKeys('en').sort()
    expect(en).toEqual(zh)
  })

  it('每个语言的 key 数量 ≥ 30（防止字典意外清空）', () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(dictKeys(lang.id).length).toBeGreaterThanOrEqual(30)
    }
  })

  it('所有 key 都有非空翻译值（zh-CN 与 en）', () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const key of dictKeys(lang.id)) {
        const v = translate(lang.id, key)
        expect(v, `${lang.id}.${key} 不应为空`).toBeTruthy()
      }
    }
  })
})

describe('translate 边界行为', () => {
  it('en 缺某 key 时回落到 zh-CN 值（模拟：用未知但 zh-CN 风格 key 验证回落链）', () => {
    // translate 回落链：dict[lang] -> dict['zh-CN'] -> key 本身
    // 取一个 zh-CN 不存在的 key，验证最终回落到 key 原文
    expect(translate('en', '__nonexistent_key__')).toBe('__nonexistent_key__')
    expect(translate('zh-CN', '__nonexistent_key__')).toBe('__nonexistent_key__')
  })

  it('zh-CN 与 en 对同一 key 给出不同翻译（验证 en 确实是英文，非复制中文）', () => {
    // 抽样若干 key，en 值应与 zh-CN 值不同（证明真的翻译了）
    const samples = ['input.send', 'chat.empty', 'settings.general', 'model.addProvider']
    for (const key of samples) {
      expect(translate('zh-CN', key)).not.toBe(translate('en', key))
    }
  })

  it('非法 lang 不抛异常（安全降级）', () => {
    // @ts-expect-error 故意传非法 lang
    expect(translate('ja', 'input.send')).toBe('发送')  // 回落 zh-CN
    // @ts-expect-error 故意传非法 lang
    expect(translate('fr', '__none__')).toBe('__none__')  // 最终回落 key 原文
  })
})
