// web/src/lib/session-list.ts
// session.list 信封 payload 解析与状态映射（Task 14）。
//
// 设计（Musk Algorithm：把信封 payload 解析从 UI 拆出来单测）：
// - 桌面 session.list payload 形如 { sessions: [{localSessionId,title,status}] }
//   （参考 src/main/remote-bridge.ts 的 forwarder，title/status 可缺失，半结构容错）。
// - 解析只做「容错 + 字段回退」，不做语义校验：未知 status 原样保留（append-only 思想）。
// - 状态标签是渲染关注点，集中在此便于 i18n 扩展（当前仅中文，与 PairPage 一致）。

/** 单条会话（手机端视图）。 */
export interface SessionListItem {
  localSessionId: string
  title: string
  status: string
}

/** 任意结构 → 合法会话列表（过滤非法条目，回退缺失字段）。 */
export function parseSessionListPayload(payload: any): SessionListItem[] {
  if (!payload || !Array.isArray(payload.sessions)) return []
  const out: SessionListItem[] = []
  for (const raw of payload.sessions) {
    if (!raw || typeof raw !== 'object') continue
    const localSessionId = raw.localSessionId
    if (typeof localSessionId !== 'string' || !localSessionId) continue
    out.push({
      localSessionId,
      title: typeof raw.title === 'string' ? raw.title : '',
      status: typeof raw.status === 'string' ? raw.status : 'idle',
    })
  }
  return out
}

/** status → 中文标签（未知/空回退到「空闲」）。 */
export function sessionStatusToLabel(status: string): string {
  if (!status) return '空闲'
  switch (status) {
    case 'running':
      return '进行中'
    case 'idle':
      return '空闲'
    default:
      return status // 未知原样保留
  }
}

/** 是否可 attach（有 id 即可）。预留扩展：未来某些状态可能禁止 attach。 */
export function isAttachableSession(s: SessionListItem): boolean {
  return !!s.localSessionId
}
