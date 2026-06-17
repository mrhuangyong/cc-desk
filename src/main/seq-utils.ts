// src/main/seq-utils.ts
// 从工作区快照里推断 reducer 模块级 idCounter 的安全起点。
// 纯函数，无 electron 依赖，便于单元测试。
// 匹配 reducer nextId 生成的 id 形态：前缀 p(项目)/s(会话)/m(消息)/t(Tab) + 数字。

const ID_RE = /^(?:p|s|m|t)(\d+)$/

// 递归扫描快照内所有对象的 `id` 字段，返回最大数字序号；无匹配时返回 0。
export function computeLastSeq(snap: { projects?: any[]; tabsBySession?: Record<string, any> }): number {
  let max = 0
  const visit = (val: any) => {
    if (val == null) return
    if (Array.isArray(val)) {
      val.forEach(visit)
    } else if (typeof val === 'object') {
      if (typeof val.id === 'string') {
        const m = ID_RE.exec(val.id)
        if (m) max = Math.max(max, Number(m[1]))
      }
      for (const k in val) visit(val[k])
    }
  }
  visit(snap.projects)
  visit(snap.tabsBySession)
  return max
}
