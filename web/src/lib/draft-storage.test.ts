import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadDraft, saveDraft, clearDraft } from './draft-storage'

// jsdom 提供真实 localStorage,每个用例前清空避免污染
beforeEach(() => {
  localStorage.clear()
})

describe('draft-storage', () => {
  it('saveDraft + loadDraft 往返一致', () => {
    saveDraft('s1', '我在写的东西')
    expect(loadDraft('s1')).toBe('我在写的东西')
  })

  it('不同会话的草稿独立(按 localSessionId 隔离)', () => {
    saveDraft('s1', '会话1的草稿')
    saveDraft('s2', '会话2的草稿')
    expect(loadDraft('s1')).toBe('会话1的草稿')
    expect(loadDraft('s2')).toBe('会话2的草稿')
  })

  it('saveDraft 空文本 → 删除该 key(loadDraft 返回空串)', () => {
    saveDraft('s1', '有内容')
    saveDraft('s1', '')  // 清空
    expect(loadDraft('s1')).toBe('')
  })

  it('loadDraft 不存在的会话 → 空串', () => {
    expect(loadDraft('never-exists')).toBe('')
  })

  it('clearDraft → loadDraft 返回空串', () => {
    saveDraft('s1', '待清除')
    clearDraft('s1')
    expect(loadDraft('s1')).toBe('')
  })

  it('localStorage 抛错时(隐私模式)函数静默不崩', () => {
    // jsdom 下直接赋值 localStorage.setItem 无法拦截内部调用,
    // 改用 spyOn Storage.prototype 模拟隐私模式/容量满抛错。
    // setItem 抛错:saveDraft 静默且不写入
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveDraft('s1', 'x')).not.toThrow()
    expect(loadDraft('s1')).toBe('')  // 抛错时未写入,返回空串
    setSpy.mockRestore()

    // getItem 抛错:loadDraft 静默返回空串
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => loadDraft('s1')).not.toThrow()
    expect(loadDraft('s1')).toBe('')
    getSpy.mockRestore()
  })
})
