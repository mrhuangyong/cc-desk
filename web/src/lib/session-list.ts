// web/src/lib/session-list.ts
// session.list 信封 payload 解析与状态映射（Task 14）。
//
// 设计（Musk Algorithm：把信封 payload 解析从 UI 拆出来单测）：
// - 桌面 session.list payload 形如 { sessions: [{localSessionId,title,status}] }
//   （参考 src/main/remote-bridge.ts 的 forwarder，title/status 可缺失，半结构容错）。
// - 解析只做「容错 + 字段回退」，不做语义校验：未知 status 原样保留（append-only 思想）。
// - 状态标签是渲染关注点，集中在此便于 i18n 扩展（当前仅中文，与 PairPage 一致）。

/** 单条会话（手机端视图）。projectId/projectName 来自桌面端 buildSessionListPayload。 */
export interface SessionListItem {
  localSessionId: string
  title: string
  status: string
  projectId: string
  projectName: string
  updatedAt?: number // 会话最后活动时间戳（ms），桌面端下发
}

/** 项目元信息（桌面端 projectsMeta，含路径）。 */
export interface ProjectMeta {
  projectId: string
  projectName: string
  projectPath?: string
}

/** session.list 完整解析结果。 */
export interface SessionListData {
  sessions: SessionListItem[]
  projectsMeta: ProjectMeta[]
}

/** 任意结构 → 合法会话列表（过滤非法条目，回退缺失字段）。 */
export function parseSessionListPayload(payload: any): SessionListItem[] {
  return parseSessionListFull(payload).sessions
}

/** 完整解析：会话列表 + 项目元信息。 */
export function parseSessionListFull(payload: any): SessionListData {
  if (!payload || !Array.isArray(payload.sessions)) return { sessions: [], projectsMeta: [] }
  const sessions: SessionListItem[] = []
  for (const raw of payload.sessions) {
    if (!raw || typeof raw !== 'object') continue
    const localSessionId = raw.localSessionId
    if (typeof localSessionId !== 'string' || !localSessionId) continue
    sessions.push({
      localSessionId,
      title: typeof raw.title === 'string' ? raw.title : '',
      status: typeof raw.status === 'string' ? raw.status : 'idle',
      projectId: typeof raw.projectId === 'string' ? raw.projectId : '',
      projectName: typeof raw.projectName === 'string' ? raw.projectName : '',
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
    })
  }
  const projectsMeta: ProjectMeta[] = Array.isArray(payload.projectsMeta)
    ? payload.projectsMeta
        .filter((m: any) => m && typeof m.projectId === 'string')
        .map((m: any) => ({
          projectId: m.projectId,
          projectName: typeof m.projectName === 'string' ? m.projectName : '',
          projectPath: typeof m.projectPath === 'string' ? m.projectPath : undefined,
        }))
    : []
  return { sessions, projectsMeta }
}

/** 项目分组（手机端两级页面用）。sessions 保留项目内顺序。 */
export interface ProjectGroup {
  projectId: string
  projectName: string
  projectPath?: string
  sessions: SessionListItem[]
}

/** 把扁平会话列表按 projectId 分组，保留项目首次出现的顺序。
 *  projectsMeta 提供项目路径（可选，桌面端下发），并补出「有项目元信息但暂无会话」的空项目
 *  （桌面新加的工作目录）——这类项目也要显示，否则用户在移动端看不到新工作目录、无法建会话。
 *  projectId 为空的会话归到 projectName='未分组' 的特殊项目。 */
export function groupByProject(sessions: SessionListItem[], projectsMeta: ProjectMeta[] = []): ProjectGroup[] {
  // 路径 + 项目名查表（projectsMeta 是项目元信息的真相源）
  const pathOf = new Map(projectsMeta.map((m) => [m.projectId, m.projectPath]))
  const nameOf = new Map(projectsMeta.map((m) => [m.projectId, m.projectName]))
  const groups: ProjectGroup[] = []
  const index = new Map<string, number>() // projectId → groups 下标
  for (const s of sessions) {
    const key = s.projectId || ''
    let idx = index.get(key)
    if (idx === undefined) {
      idx = groups.length
      groups.push({
        projectId: key,
        projectName: key === '' ? '未分组' : (s.projectName || nameOf.get(key) || '未命名项目'),
        projectPath: pathOf.get(key),
        sessions: [],
      })
      index.set(key, idx)
    }
    groups[idx].sessions.push(s)
  }
  // 补出 projectsMeta 里有、但 sessions 里没有的空项目（桌面新加的工作目录，暂无会话）。
  // 按 projectsMeta 的顺序追加，让空项目出现在它该在的位置之后。
  for (const m of projectsMeta) {
    if (m.projectId && !index.has(m.projectId)) {
      index.set(m.projectId, groups.length)
      groups.push({
        projectId: m.projectId,
        projectName: m.projectName || '未命名项目',
        projectPath: m.projectPath,
        sessions: [],
      })
    }
  }
  return groups
}

/** status → 中文标签（未知/空回退到「空闲」）。 */
export function sessionStatusToLabel(status: string): string {
  if (!status) return '空闲'
  switch (status) {
    case 'running':
      return '进行中'
    case 'completed':
      return '已完成'
    case 'error':
      return '出错'
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

/** 时间戳 → 「N 天前 / N 小时前 / 刚刚」相对时间。 */
export function relativeTime(ts: number | undefined, now: number = Date.now()): string {
  if (!ts) return ''
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  const days = Math.floor(diff / 86_400_000)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

/** 截断长路径（如 /Users/mrhua/projects/a...）。保留末尾项目名，中间用 … 替代。 */
export function shortPath(p: string | undefined): string {
  if (!p) return ''
  const parts = p.split('/').filter(Boolean)
  if (parts.length <= 3) return '~/' + parts.slice(-2).join('/')
  return '~/' + parts[0] + '/…/' + parts.slice(-2).join('/')
}
