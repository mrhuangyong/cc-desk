// web/src/pages/ProjectListPage.tsx
// PWA 项目列表页（两级页面：项目 → 会话）。
//
// 布局参考桌面端 ZCode 远程控制：
//   - 顶部 header：应用名 + 连接状态副标题 + 主题切换
//   - 说明卡片：本次连接的能力边界
//   - 列表标题栏：「当前设备上的项目和会话」+ 统计
//   - 项目卡：📁名称 + 本地标签 + 会话数 + 路径 + 展开箭头；展开后会话行（标题+状态+时间）
//   - 会话行：左侧状态色条（运行=绿，完成=灰，错误=红）+ 等宽标题 + 状态标签 + 相对时间
import React, { useMemo, useState } from 'react'
import {
  type SessionListItem,
  type ProjectMeta,
  groupByProject,
  sessionStatusToLabel,
  relativeTime,
  shortPath,
} from '../lib/session-list'

export interface ProjectListPageProps {
  /** 中继是否已连接（bind 握手完成）。 */
  connected: boolean
  /** 会话清单（已从 session.list 信封 parse）。 */
  sessions: SessionListItem[]
  /** 项目元信息（含路径，桌面端 projectsMeta）。 */
  projectsMeta: ProjectMeta[]
  /** 点击某会话（→ session.attach）。 */
  onAttach: (localSessionId: string) => void
  /** 在某项目内新建会话（→ session.create with projectId）。 */
  onCreateInProject: (projectId: string) => void
  /** 归档某会话（→ session.archive）。会话行右侧垃圾桶按钮触发（二次确认）。 */
  onArchive?: (localSessionId: string) => void
  /** header 右侧额外控件（主题切换等）。 */
  headerExtra?: React.ReactNode
}

export default function ProjectListPage(props: ProjectListPageProps) {
  const { connected, sessions, projectsMeta, onAttach, onCreateInProject, onArchive, headerExtra } = props
  const groups = useMemo(() => groupByProject(sessions, projectsMeta), [sessions, projectsMeta])

  // 默认展开首个项目
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return new Set(groups.length > 0 ? [groups[0].projectId] : [])
  })
  // 归档二次确认态：记录哪个会话正在「待确认归档」（点一次进入确认，再点执行）
  const [pendingArchive, setPendingArchive] = useState<string | null>(null)

  const toggle = (projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  // 统计：项目数 + 会话数
  const projectCount = groups.length
  const sessionCount = sessions.length

  return (
    <div className="app project-list-page">
      <header className="app-header">
        <div className="header-title">
          <h1>cc-desk</h1>
          <span className={`status ${connected ? 'on' : 'off'}`}>
            {connected ? '已连接到桌面' : '连接中…'}
          </span>
        </div>
        <div className="header-actions">
          {headerExtra}
        </div>
      </header>

      <main className="project-list-body">
        {/* 说明卡片 */}
        <div className="info-card">
          本次连接可以查看当前设备上已打开的项目和会话，发送消息与批准请求。
        </div>

        {/* 列表标题栏 */}
        <div className="list-section-head">
          <div className="list-section-title">
            当前设备上的项目
            {projectCount > 0 && (
              <span className="list-section-stat">
                {projectCount} 个项目 · {sessionCount} 个会话
              </span>
            )}
          </div>
        </div>

        {/* 空状态 */}
        {connected && groups.length === 0 && (
          <p className="hint empty-hint">桌面暂无可远程的会话</p>
        )}
        {!connected && <p className="hint empty-hint">正在连接桌面…</p>}

        {/* 项目卡片列表 */}
        <div className="project-cards">
          {groups.map((g) => {
            const isOpen = expanded.has(g.projectId)
            const runningCount = g.sessions.filter((s) => s.status === 'running').length
            return (
              <section key={g.projectId || '__ungrouped__'} className="project-card">
                {/* 项目头 */}
                <div className="project-card-head">
                  <button
                    className="project-head-main"
                    onClick={() => toggle(g.projectId)}
                    aria-expanded={isOpen}
                  >
                    <span className="project-icon">📁</span>
                    <div className="project-info">
                      <div className="project-name-row">
                        <span className="project-name">{g.projectName}</span>
                      </div>
                      {g.projectPath && (
                        <div className="project-path mono">{shortPath(g.projectPath)}</div>
                      )}
                    </div>
                    <span className="project-count-pill">
                      {g.sessions.length}{runningCount > 0 && <em className="running-dot">·{runningCount}运行</em>}
                    </span>
                    <span className={`caret ${isOpen ? 'open' : ''}`}>›</span>
                  </button>
                  <button
                    className="project-add-btn"
                    onClick={() => onCreateInProject(g.projectId)}
                    disabled={!connected}
                    aria-label="新建会话"
                  >
                    ＋
                  </button>
                </div>

                {/* 展开后的会话列表 */}
                {isOpen && (
                  <ul className="session-list">
                    {g.sessions.map((s) => (
                      <li key={s.localSessionId} className="session-row">
                        <button
                          className={`session-item status-${s.status || 'idle'}`}
                          onClick={() => onAttach(s.localSessionId)}
                        >
                          <span className="session-bar" />
                          <div className="session-content">
                            <div className="session-title-row">
                              <span className="session-title">{s.title || '未命名会话'}</span>
                              <span className={`session-status-tag ${s.status || 'idle'}`}>
                                {sessionStatusToLabel(s.status)}
                              </span>
                            </div>
                            {s.updatedAt && (
                              <div className="session-time">{relativeTime(s.updatedAt)}</div>
                            )}
                          </div>
                          <span className="chevron-right">›</span>
                        </button>
                        {onArchive && (
                          <button
                            className={`session-archive-btn${pendingArchive === s.localSessionId ? ' confirm' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation() // 防止冒泡触发 attach
                              if (pendingArchive === s.localSessionId) {
                                onArchive(s.localSessionId)
                                setPendingArchive(null)
                              } else {
                                setPendingArchive(s.localSessionId)
                              }
                            }}
                            aria-label="归档"
                            aria-expanded={pendingArchive === s.localSessionId}
                          >
                            {pendingArchive === s.localSessionId ? '确认删除' : '🗑'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </main>
    </div>
  )
}
