// src/main/projects-store.ts
// 工作区项目的独立持久化存储（projects.json），与 settings 的 electron-store 隔离。
// 渲染进程通过 IPC（projects:get / projects:save）读写整张工作区快照。
import Store from 'electron-store'
import type { Project, Tab } from '../renderer/types'
import { computeLastSeq } from './seq-utils'
import { CC_DESK_DIR } from './paths'

// 持久化的工作区快照：只含需要恢复的稳定字段。
// 刻意排除 streamingBySession / draft / theme / currentView / settings 等临时态或已有独立存储的字段。
export interface ProjectsSnapshot {
  projects: Project[]
  activeSessionId: string
  tabsBySession: Record<string, Tab[]>
  activeTabIdBySession: Record<string, string | null>
  claudeSessionMap: Record<string, string>
  // idCounter 持久化：恢复后避免与已恢复的 ID（p1/p2/s1...）冲突
  lastSeq: number
  savedAt: number
}

const EMPTY: ProjectsSnapshot = {
  projects: [],
  activeSessionId: '',
  tabsBySession: {},
  activeTabIdBySession: {},
  claudeSessionMap: {},
  lastSeq: 0,
  savedAt: 0,
}

// 独立文件名 projects.json（electron-store 默认 config.json）
// 固定写入 ~/.cc-desk/projects.json
function createStore(): Store<{ snapshot: ProjectsSnapshot }> {
  return new Store<{ snapshot: ProjectsSnapshot }>({
    name: 'projects',
    cwd: CC_DESK_DIR,
    defaults: { snapshot: EMPTY },
  })
}

let store = createStore()

export function getProjectsSnapshot(): ProjectsSnapshot {
  const snap = store.get('snapshot', EMPTY)
  // 旧格式兼容：早期消息的 content 是 string（新格式为 ContentBlock[]）。
  // 直接渲染旧格式会导致崩溃——发现即清空该 session 的历史消息。
  for (const p of snap.projects) {
    for (const s of p.sessions) {
      if (s.messages.some((m: any) => typeof m.content === 'string')) {
        s.messages = []
      }
    }
  }
  return snap
}

// 整体覆盖写。lastSeq 在写入前由 computeLastSeq 回填，保证恢复后 ID 不冲突。
export function saveProjectsSnapshot(snap: Omit<ProjectsSnapshot, 'lastSeq' | 'savedAt'>): void {
  const lastSeq = computeLastSeq(snap)
  store.set('snapshot', { ...snap, lastSeq, savedAt: Date.now() })
}

/**
 * 在工作区中指定项目下新建一个空会话（远程控制 session.create 用）。
 * 主进程无 reducer NEW_SESSION；这里直接操作 projects-store 的持久化快照。
 * 返回 { sessionId, cwd }：sessionId 是新会话 ID，cwd 是项目路径（作为会话工作目录）。
 * 注：不通知渲染端（远程会话的 live 态由 forwarder 转发的事件流驱动）。
 */
export function addSessionToProject(projectId: string): { sessionId: string; cwd?: string } | null {
  const snap = getProjectsSnapshot()
  const p = snap.projects.find((p) => p.id === projectId)
  if (!p) return null
  const id = `remote-s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const newSession = {
    id,
    title: '新会话',
    messages: [],
    updatedAt: Date.now(),
  }
  p.sessions.push(newSession as any)
  saveProjectsSnapshot(snap)
  return { sessionId: id, cwd: p.path }
}

/**
 * 归档指定会话（远程控制 session.archive 用）：标记 archived=true 并落盘。
 * 与渲染端 reducer 的 ARCHIVE_SESSION 语义一致（软删除，桌面保留记录可恢复）。
 * buildSessionListPayload 会过滤 archived 会话，归档后自动从远程列表消失。
 * 不可变更新：仅置 archived/archivedAt，保留会话其余字段（含未知字段，深合并约定）。
 * 找不到会话时静默（不报错），调用方负责后续 closeSession/clearBySession。
 */
export function archiveSessionInStore(localSessionId: string): void {
  const snap = getProjectsSnapshot()
  let found = false
  for (const p of snap.projects) {
    const idx = p.sessions.findIndex((s) => s.id === localSessionId)
    if (idx >= 0) {
      const sess: any = p.sessions[idx]
      // 不可变替换：保留原对象其余字段，仅覆盖 archived/archivedAt
      p.sessions[idx] = { ...sess, archived: true, archivedAt: Date.now() }
      found = true
      break
    }
  }
  if (found) saveProjectsSnapshot(snap)
}
