// src/main/projects-store.ts
// 工作区项目的独立持久化存储（projects.json），与 settings 的 electron-store 隔离。
// 渲染进程通过 IPC（projects:get / projects:save）读写整张工作区快照。
import Store from 'electron-store'
import type { Project, Tab } from '../renderer/types'
import { computeLastSeq } from './seq-utils'

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
function createStore(): Store<{ snapshot: ProjectsSnapshot }> {
  return new Store<{ snapshot: ProjectsSnapshot }>({
    name: 'projects',
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
