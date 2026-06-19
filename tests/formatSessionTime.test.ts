import { describe, it, expect } from 'vitest'
import { formatSessionTime } from '../src/renderer/utils/formatSessionTime'

// 固定"当前时间"为 2026-06-18 14:30 本地，便于稳定测试
const NOW = new Date(2026, 5, 18, 14, 30).getTime()

describe('formatSessionTime', () => {
  it('今天同一天返回 HH:mm', () => {
    const sameDay = new Date(2026, 5, 18, 9, 5).getTime()
    expect(formatSessionTime(sameDay, NOW)).toBe('09:05')
  })

  it('昨天返回"昨天"', () => {
    const yesterday = new Date(2026, 5, 17, 23, 59).getTime()
    expect(formatSessionTime(yesterday, NOW)).toBe('昨天')
  })

  it('2-30 天前返回 n天', () => {
    const threeDaysAgo = new Date(2026, 5, 15, 10, 0).getTime()
    expect(formatSessionTime(threeDaysAgo, NOW)).toBe('3天')
  })

  it('正好 30 天前仍返回 30天', () => {
    // NOW 是 6/18，往前 30 个日历日 = 5/19
    const thirtyDaysAgo = new Date(2026, 4, 19, 14, 30).getTime()
    expect(formatSessionTime(thirtyDaysAgo, NOW)).toBe('30天')
  })

  it('超过 30 天返回 MM-DD', () => {
    // 31 天前 = 5/18
    const thirtyOneDaysAgo = new Date(2026, 4, 18, 14, 30).getTime()
    expect(formatSessionTime(thirtyOneDaysAgo, NOW)).toBe('05-18')
  })

  it('updatedAt 为 0 返回空字符串', () => {
    expect(formatSessionTime(0, NOW)).toBe('')
  })

  it('updatedAt 为 undefined 返回空字符串', () => {
    expect(formatSessionTime(undefined as unknown as number, NOW)).toBe('')
  })
})
