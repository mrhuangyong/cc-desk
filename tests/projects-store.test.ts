// tests/projects-store.test.ts
// projects-store 落盘与覆盖竞态测试。
// 用 CC_DESK_DIR 隔离到 tmp，绝不落真机 ~/.cc-desk（参考 CLAUDE.md 测试约定）。
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

let tmpDir = ''
let origCcd: string | undefined
beforeEach(() => {
  vi.resetModules()
  tmpDir = path.join(os.tmpdir(), `cc-desk-proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  origCcd = process.env.CC_DESK_DIR
  process.env.CC_DESK_DIR = tmpDir
})
afterAll(() => {
  if (origCcd === undefined) delete process.env.CC_DESK_DIR
  else process.env.CC_DESK_DIR = origCcd
})

describe('projects-store 远程会话与覆盖竞态', () => {
  it('addSessionToProject 落盘的会话，不会被 renderer 的旧快照整体覆盖写丢（bug3 根因）', async () => {
    const { getProjectsSnapshot, saveProjectsSnapshot, addSessionToProject } = await import('../src/main/projects-store')

    // 初始：一个项目 p1，无会话
    saveProjectsSnapshot({
      projects: [{ id: 'p1', name: 'demo', path: '/code/demo', sessions: [] as any[] }],
      activeSessionId: '', tabsBySession: {}, activeTabIdBySession: {}, claudeSessionMap: {},
    } as any)

    // 模拟 renderer 内存里还停留在「无会话」的旧快照（HYDRATE 尚未把新会话同步进来）
    const staleRendererSnap = getProjectsSnapshot()

    // 手机远程新建会话：主进程直接落盘（含新会话）
    const r = addSessionToProject('p1')
    expect(r?.sessionId).toBeTruthy()
    const newSessionId = r!.sessionId

    // 此时主进程磁盘快照确实有新会话
    expect(getProjectsSnapshot().projects[0].sessions.some((s: any) => s.id === newSessionId)).toBe(true)

    // ★ bug3 竞态：renderer 的防抖 SAVE 用「旧内存」（不知道新会话）整体覆盖写
    saveProjectsSnapshot({
      projects: staleRendererSnap.projects,
      activeSessionId: staleRendererSnap.activeSessionId,
      tabsBySession: staleRendererSnap.tabsBySession,
      activeTabIdBySession: staleRendererSnap.activeTabIdBySession,
      claudeSessionMap: staleRendererSnap.claudeSessionMap,
    } as any)

    // 期望：主进程侧新增的远程会话不应被 renderer 的覆盖写丢掉
    // （saveProjectsSnapshot 应合并保留磁盘上已有、但 renderer 快照里缺失的远程会话）
    const final = getProjectsSnapshot()
    const stillThere = final.projects[0].sessions.some((s: any) => s.id === newSessionId)
    expect(stillThere).toBe(true)
  })
})
