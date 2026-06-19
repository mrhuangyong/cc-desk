// 将时间戳格式化为会话列表显示用字符串。
// now 参数仅用于测试注入，生产环境默认 Date.now()。
export function formatSessionTime(updatedAt: number, now: number = Date.now()): string {
  if (!updatedAt) return ''

  const target = new Date(updatedAt)
  const current = new Date(now)

  // 计算日历日差：用本地日期的 YYYY-MM-DD 比较，避免夏令时等小时级偏差
  const startOfCurrentDay = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
  const startOfTargetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000
  const dayDiff = Math.round((startOfCurrentDay - startOfTargetDay) / dayMs)

  if (dayDiff <= 0) {
    // 同一天：HH:mm（补零）
    const hh = String(target.getHours()).padStart(2, '0')
    const mm = String(target.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }
  if (dayDiff === 1) return '昨天'
  if (dayDiff <= 30) return `${dayDiff}天`

  // 超过 30 天：MM-DD（补零）
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const date = String(target.getDate()).padStart(2, '0')
  return `${month}-${date}`
}
