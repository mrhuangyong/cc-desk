import { useState } from 'react'
import { Folder, FolderOpen, MessageCircle, FolderTree, ChevronDown, ChevronRight, Plus, Loader2, AlertCircle, CircleCheck } from 'lucide-react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { DeleteConfirmIcon } from './DeleteConfirmIcon'
import { formatSessionTime } from '../utils/formatSessionTime'
import { Tooltip } from './Tooltip'

// 会话状态类型：仅在非活跃会话上显示
// - loading: 正在执行任务（streaming 中）
// - warning: 需要用户操作（权限/计划批准/AskUserQuestion 等阻塞式 dialog）
// - success: 任务执行完成（用户不在该会话期间完成）
// - idle: 无状态图标
type SessionStatus = 'loading' | 'warning' | 'success' | 'idle'

function getSessionStatus(
  sessionId: string,
  isActive: boolean,
  state: ReturnType<typeof useStore>['state'],
): SessionStatus {
  // 状态图标仅在非活跃会话上显示
  if (isActive) return 'idle'
  // 优先级: warning > loading > success
  if (state.pendingDialog?.sessionId === sessionId) return 'warning'
  if (state.streamingBySession[sessionId]) return 'loading'
  if (state.completedBySession[sessionId]) return 'success'
  return 'idle'
}

interface Props {
  onOpenFiles: (projectId: string) => void
  expandedProjects: Set<string>
  onToggleExpand: (projectId: string) => void
  treeFilter: string
  sortMode: 'recent' | 'created' | 'title'
  showArchived: boolean
}

const MAX_VISIBLE_SESSIONS = 5

export function ProjectTree({ onOpenFiles, expandedProjects, onToggleExpand, treeFilter, sortMode, showArchived }: Props) {
  const { state, dispatch } = useStore()
  const { t } = useI18n()
  const [hoveredProject, setHoveredProject] = useState<string | null>(null)
  const [hoveredSession, setHoveredSession] = useState<string | null>(null)
  const [expandedSessionCounts, setExpandedSessionCounts] = useState<Set<string>>(new Set())

  const q = treeFilter.trim().toLowerCase()
  const activeSessionId = state.activeSessionId

  const toggleSessionExpand = (projectId: string) => {
    setExpandedSessionCounts(prev => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {state.projects.map(project => {
        const filtered = q
          ? project.sessions.filter(s => (showArchived || !s.archived) && s.title.toLowerCase().includes(q))
          : project.sessions.filter(s => showArchived || !s.archived)
        if (q && filtered.length === 0) return null

        // 排序键随 sortMode 切换：
        // - recent: 按最后活动时间倒序（lastUserSentAt ?? updatedAt）
        // - created: 按创建顺序（id 升序）
        // - title: 按标题字母序
        // 同值回退 id 稳定排列，防 sort 抖。
        const sorted = [...filtered].sort((a, b) => {
          if (sortMode === 'title') {
            const cmp = (a.title || '').localeCompare(b.title || '')
            return cmp !== 0 ? cmp : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          }
          if (sortMode === 'created') {
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
          }
          // recent (default)
          const ta = b.lastUserSentAt ?? b.updatedAt ?? 0
          const tb = a.lastUserSentAt ?? a.updatedAt ?? 0
          if (ta !== tb) return ta - tb
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        })

        const expanded = expandedProjects.has(project.id)
        const sessionExpanded = expandedSessionCounts.has(project.id)
        const total = sorted.length
        const visible = sessionExpanded ? sorted : sorted.slice(0, MAX_VISIBLE_SESSIONS)

        return (
          <div key={project.id}>
            <div
              onMouseEnter={() => setHoveredProject(project.id)}
              onMouseLeave={() => setHoveredProject(null)}
              onClick={() => onToggleExpand(project.id)}
              style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 'var(--font-size)', fontWeight: 550, color: 'var(--text)', cursor: 'pointer',
                background: hoveredProject === project.id ? 'var(--bg-hover)' : 'transparent'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 12, display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                {expanded ? <FolderOpen size={14} /> : <Folder size={14} />} {project.name}
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <Tooltip label="新建会话">
                  <button aria-label="新建会话"
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: 'ADD_SESSION', projectId: project.id }) }}
                    style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none', display: 'inline-flex', alignItems: 'center' }}><Plus size={13} /></button>
                </Tooltip>
                <Tooltip label="项目文件树">
                  <button aria-label="项目文件树"
                    onClick={(e) => { e.stopPropagation(); onOpenFiles(project.id) }}
                    style={{ opacity: hoveredProject === project.id ? 0.85 : 0, transition: 'opacity .1s', pointerEvents: hoveredProject === project.id ? 'auto' : 'none', display: 'inline-flex', alignItems: 'center' }}><FolderTree size={13} /></button>
                </Tooltip>
                <span style={{ opacity: hoveredProject === project.id ? 1 : 0, pointerEvents: hoveredProject === project.id ? 'auto' : 'none', transition: 'opacity .1s', display: 'inline-flex', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                  <DeleteConfirmIcon variant="delete" onConfirm={() => dispatch({ type: 'DELETE_PROJECT', projectId: project.id })} />
                </span>
              </span>
            </div>
            {expanded && visible.map(session => {
              const active = activeSessionId === session.id
              const hovered = hoveredSession === session.id
              const isArchived = !!session.archived
              return (
              <div
                key={session.id}
                data-active={active || undefined}
                onMouseEnter={() => setHoveredSession(session.id)}
                onMouseLeave={() => setHoveredSession(null)}
                onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: session.id })}
                style={{
                  position: 'relative',
                  padding: '6px 12px 6px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 'var(--font-size)',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  background: active || hovered ? 'var(--bg-hover)' : 'transparent',
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', opacity: isArchived ? 0.5 : 1 }}>
                  {(() => {
                    const status = getSessionStatus(session.id, active, state)
                    if (status === 'loading') {
                      return <Loader2 size={13} className="cc-spin" style={{ flexShrink: 0, color: 'var(--accent)' }} />
                    }
                    if (status === 'warning') {
                      return (
                        <Tooltip label={t('left.statusWaiting')}>
                          <AlertCircle size={13} style={{ flexShrink: 0, color: '#ff9500' }} />
                        </Tooltip>
                      )
                    }
                    if (status === 'success') {
                      return (
                        <Tooltip label={t('left.statusDone')}>
                          <CircleCheck size={13} style={{ flexShrink: 0, color: '#34c759' }} />
                        </Tooltip>
                      )
                    }
                    return <MessageCircle size={13} style={{ flexShrink: 0 }} />
                  })()}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
                </span>
                <span style={{ position: 'relative', minWidth: 40, display: 'inline-flex', justifyContent: 'flex-end', flexShrink: 0 }}>
                  <span data-testid="session-time" style={{ fontSize: 11, color: 'var(--text-muted)', opacity: hovered ? 0 : 1, transition: 'opacity .15s' }}>
                    {formatSessionTime(session.updatedAt ?? 0)}
                  </span>
                  <span style={{
                    position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)',
                    opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .15s',
                  }}>
                    <DeleteConfirmIcon onConfirm={() => {
                      dispatch({ type: 'ARCHIVE_SESSION', sessionId: session.id })
                      void window.api.session.archive(session.id)
                    }} />
                  </span>
                </span>
              </div>
              )
            })}
            {expanded && total > MAX_VISIBLE_SESSIONS && (
              <div
                onClick={(e) => { e.stopPropagation(); toggleSessionExpand(project.id) }}
                style={{
                  padding: '4px 12px 4px 30px', fontSize: 11, color: 'var(--text-muted)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                {sessionExpanded ? '收起' : `+ 展开更多 (${total - MAX_VISIBLE_SESSIONS})`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
