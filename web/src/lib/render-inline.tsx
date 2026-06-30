// web/src/lib/render-inline.ts
// 最简行内 markdown 渲染（粗体 **x** + 行内代码 `x`）。
//
// 不引依赖：手机端首屏体积敏感，复杂 markdown 待后续按需引入（Musk Algorithm）。
// 仅处理行内格式，换行交给 CSS white-space: pre-wrap。
// 抽公共：ChatPage 的消息文本与 PlanSheet 的计划文本共用同一套行内渲染。
import React from 'react'

export function renderInline(text: string): React.ReactNode[] {
  // 先按 ** 拆粗体，再对每段按 ` 拆行内代码。
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  const out: React.ReactNode[] = []
  parts.forEach((seg, i) => {
    if (!seg) return
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      out.push(<strong key={`b${i}`}>{seg.slice(2, -2)}</strong>)
      return
    }
    // 行内代码
    const codeParts = seg.split(/(`[^`]+`)/g)
    codeParts.forEach((c, j) => {
      if (!c) return
      if (c.startsWith('`') && c.endsWith('`') && c.length > 2) {
        out.push(<code key={`c${i}-${j}`}>{c.slice(1, -1)}</code>)
        return
      }
      out.push(<React.Fragment key={`t${i}-${j}`}>{c}</React.Fragment>)
    })
  })
  return out
}
