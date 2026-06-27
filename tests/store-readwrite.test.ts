// settings-store + projects-store 真实读写测试。
// 隔离到临时 HOME（~/.cc-desk/）验证 electron-store 真实落盘 + 默认值合并 + 旧格式兼容。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

async function withFakeHome() {
  const fakeHome = join(tmpdir(), `cc-store-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(join(fakeHome, '.cc-desk'), { recursive: true })
  process.env.HOME = fakeHome
  vi.resetModules()
  return { fakeHome }
}

describe('settings-store 真实读写', () => {
  let orig: string | undefined
  beforeEach(() => { orig = process.env.HOME })
  afterEach(() => { process.env.HOME = orig; vi.resetModules() })

  it('getSettings 首次返回完整默认值', async () => {
    await withFakeHome()
    const { getSettings } = await import('../src/main/settings-store')
    const s = getSettings()
    expect(s.providers.length).toBeGreaterThan(0)
    expect(s.models.length).toBe(3)
    expect(s.modelRoleMap['anthropic:sonnet']).toBe('model-sonnet')
    expect(s.codePreview.showLineNumbers).toBe(true)
    expect(s.lang).toBe('zh-CN')
    // 细粒度通知开关默认全部开启
    expect(s.notifyOnComplete).toBe(true)
    expect(s.notifyOnError).toBe(true)
    expect(s.notifyOnConfirm).toBe(true)
    expect(s.notifyOnPermission).toBe(true)
  })

  it('getSettings 落盘到 ~/.cc-desk/settings.json', async () => {
    const { fakeHome } = await withFakeHome()
    const { getSettings } = await import('../src/main/settings-store')
    getSettings()  // 触发 electron-store 写默认
    const p = join(fakeHome, '.cc-desk', 'settings.json')
    expect(existsSync(p)).toBe(true)
    const data = JSON.parse(await readFile(p, 'utf-8'))
    expect(data.settings.models.length).toBe(3)
  })

  it('saveSettings 合并部分字段并落盘', async () => {
    const { fakeHome } = await withFakeHome()
    const { getSettings, saveSettings } = await import('../src/main/settings-store')
    saveSettings({ theme: 'codex-dark', proxy: 'http://p:8080' })
    const p = join(fakeHome, '.cc-desk', 'settings.json')
    const data = JSON.parse(await readFile(p, 'utf-8'))
    expect(data.settings.theme).toBe('codex-dark')
    expect(data.settings.proxy).toBe('http://p:8080')
    // 其他字段保留默认
    expect(data.settings.lang).toBe('zh-CN')
    expect(data.settings.models.length).toBe(3)
  })

  it('withDefaults：旧数据缺字段时逐项补齐（不丢默认数组/标量）', async () => {
    const { fakeHome } = await withFakeHome()
    // 预置一份残缺旧数据：只有 theme + 一个 provider
    await mkdir(join(fakeHome, '.cc-desk'), { recursive: true })
    await writeFile(
      join(fakeHome, '.cc-desk', 'settings.json'),
      JSON.stringify({ settings: { theme: 'codex-warm', providers: [{ id: 'x', name: 'X', apiKey: '', baseUrl: '', enabled: true }] } }),
    )
    const { getSettings } = await import('../src/main/settings-store')
    const s = getSettings()
    expect(s.theme).toBe('codex-warm')          // 保留用户值
    expect(s.providers.length).toBe(1)           // 非空则保留
    expect(s.models.length).toBe(3)              // 缺失则补默认
    expect(s.lang).toBe('zh-CN')                 // 缺失标量补默认
    expect(s.codePreview.showLineNumbers).toBe(true)
  })

  it('model 回退：model 指向不存在模型时，回退到第一个 enabled 模型', async () => {
    const { fakeHome } = await withFakeHome()
    await mkdir(join(fakeHome, '.cc-desk'), { recursive: true })
    await writeFile(
      join(fakeHome, '.cc-desk', 'settings.json'),
      JSON.stringify({ settings: { model: 'ghost-model' } }),
    )
    const { getSettings } = await import('../src/main/settings-store')
    const s = getSettings()
    expect(s.model).toBe('model-opus')  // 默认 models 第一个 enabled 是 model-opus
  })

  it('saveSettings 保留 false/0/空串等合法 falsy 值', async () => {
    const { fakeHome } = await withFakeHome()
    const { saveSettings, getSettings } = await import('../src/main/settings-store')
    saveSettings({ taskNotify: false, proxy: '' })
    const s = getSettings()
    expect(s.taskNotify).toBe(false)  // 不能被默认 true 覆盖
    expect(s.proxy).toBe('')
  })
})

describe('projects-store 真实读写', () => {
  let orig: string | undefined
  beforeEach(() => { orig = process.env.HOME })
  afterEach(() => { process.env.HOME = orig; vi.resetModules() })

  it('getProjectsSnapshot 空时返回 EMPTY 结构', async () => {
    await withFakeHome()
    const { getProjectsSnapshot } = await import('../src/main/projects-store')
    const snap = getProjectsSnapshot()
    expect(snap.projects).toEqual([])
    expect(snap.activeSessionId).toBe('')
    expect(snap.lastSeq).toBe(0)
  })

  it('saveProjectsSnapshot 写入并回填 lastSeq/savedAt', async () => {
    const { fakeHome } = await withFakeHome()
    const { saveProjectsSnapshot, getProjectsSnapshot } = await import('../src/main/projects-store')
    saveProjectsSnapshot({
      projects: [
        { id: 'p1', name: 'proj1', sessions: [
          { id: 's1', title: '会话1', messages: [] },
        ] },
      ],
      activeSessionId: 's1',
      tabsBySession: {}, activeTabIdBySession: {}, claudeSessionMap: {},
    })
    const data = JSON.parse(await readFile(join(fakeHome, '.cc-desk', 'projects.json'), 'utf-8'))
    expect(data.snapshot.lastSeq).toBeGreaterThan(0)  // computeLastSeq 从 p1/s1 解析
    expect(data.snapshot.savedAt).toBeGreaterThan(0)
    // 读回一致
    const snap = getProjectsSnapshot()
    expect(snap.projects[0].sessions[0].id).toBe('s1')
    expect(snap.lastSeq).toBe(data.snapshot.lastSeq)
  })

  it('旧格式兼容：content 是 string 的消息触发该 session 历史清空（防渲染崩溃）', async () => {
    const { fakeHome } = await withFakeHome()
    await mkdir(join(fakeHome, '.cc-desk'), { recursive: true })
    await writeFile(
      join(fakeHome, '.cc-desk', 'projects.json'),
      JSON.stringify({ snapshot: {
        projects: [
          { id: 'p1', name: 'proj1', sessions: [
            { id: 's1', title: '旧', messages: [
              { id: 'm1', role: 'assistant', content: '我是旧格式 string content' },  // 旧格式
            ] },
            { id: 's2', title: '新', messages: [
              { id: 'm2', role: 'user', content: [{ type: 'text', text: '新格式' }] },  // 新格式
            ] },
          ] },
        ],
        activeSessionId: 's1', tabsBySession: {}, activeTabIdBySession: {}, claudeSessionMap: {},
        lastSeq: 5, savedAt: 1,
      } }),
    )
    const { getProjectsSnapshot } = await import('../src/main/projects-store')
    const snap = getProjectsSnapshot()
    const s1 = snap.projects[0].sessions.find(x => x.id === 's1')
    const s2 = snap.projects[0].sessions.find(x => x.id === 's2')
    expect(s1!.messages).toEqual([])                        // 旧格式 → 清空
    expect(s2!.messages.length).toBe(1)                     // 新格式 → 保留
  })

  it('addSessionToProject 在指定项目下创建空会话并落盘', async () => {
    const { fakeHome } = await withFakeHome()
    const { saveProjectsSnapshot, addSessionToProject, getProjectsSnapshot } = await import('../src/main/projects-store')
    saveProjectsSnapshot({
      projects: [{ id: 'p1', name: 'proj1', path: '/code/x', sessions: [] }],
      activeSessionId: '', tabsBySession: {}, activeTabIdBySession: {}, claudeSessionMap: {},
    })
    const r = addSessionToProject('p1')
    expect(r).not.toBeNull()
    expect(r!.sessionId).toBeTruthy()
    expect(r!.cwd).toBe('/code/x')
    const snap = getProjectsSnapshot()
    expect(snap.projects[0].sessions.length).toBe(1)
    expect(snap.projects[0].sessions[0].id).toBe(r!.sessionId)
  })

  it('archiveSessionInStore 标记指定会话 archived 并落盘，保留其他会话与未知字段', async () => {
    const { fakeHome } = await withFakeHome()
    const { saveProjectsSnapshot, archiveSessionInStore, getProjectsSnapshot } = await import('../src/main/projects-store')
    saveProjectsSnapshot({
      projects: [{ id: 'p1', name: 'proj1', sessions: [
        { id: 's1', title: '会话1', messages: [] },
        { id: 's2', title: '会话2', messages: [], ...( { customField: 'keep-me' } as any ) },  // 未知字段须保留
      ] }],
      activeSessionId: 's2', tabsBySession: {}, activeTabIdBySession: {}, claudeSessionMap: {},
    })
    archiveSessionInStore('s1')
    const snap = getProjectsSnapshot()
    const s1 = snap.projects[0].sessions.find(x => x.id === 's1')
    const s2 = snap.projects[0].sessions.find(x => x.id === 's2')
    expect(s1!.archived).toBe(true)
    expect(s1!.archivedAt).toBeGreaterThan(0)
    expect(s2!.archived).not.toBe(true)                 // 未归档的不受影响
    expect((s2 as any).customField).toBe('keep-me')      // 未知字段保留（深合并约定）
  })

  it('archiveSessionInStore 对不存在的会话不报错（静默）', async () => {
    const { fakeHome } = await withFakeHome()
    const { saveProjectsSnapshot, archiveSessionInStore, getProjectsSnapshot } = await import('../src/main/projects-store')
    saveProjectsSnapshot({
      projects: [{ id: 'p1', name: 'proj1', sessions: [{ id: 's1', title: '会话1', messages: [] }] }],
      activeSessionId: 's1', tabsBySession: {}, activeTabIdBySession: {}, claudeSessionMap: {},
    })
    expect(() => archiveSessionInStore('nope')).not.toThrow()
    const snap = getProjectsSnapshot()
    expect(snap.projects[0].sessions[0].archived).not.toBe(true)  // 不影响已有会话
  })
})

describe('hooks 后端读写', () => {
  let orig: string | undefined
  beforeEach(() => { orig = process.env.HOME })
  afterEach(() => { process.env.HOME = orig; vi.resetModules() })

  it('getHooksFull 空配置返回空数组', async () => {
    await withFakeHome()
    const { getHooksFull } = await import('../src/main/claude-config')
    const d = await getHooksFull()
    expect(d.custom).toEqual([])
    expect(d.plugins).toEqual([])
  })

  it('saveHooks 写入后 getHooksFull 能读到', async () => {
    await withFakeHome()
    const { saveHooks, getHooksFull } = await import('../src/main/claude-config')
    const r = await saveHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo test' }] }] })
    expect(r.success).toBe(true)
    const d = await getHooksFull()
    expect(d.custom.length).toBe(1)
    expect(d.custom[0].eventName).toBe('PreToolUse')
    expect((d.custom[0].matchers[0].hooks[0] as any).command).toBe('echo test')
  })

  it('saveHooks 拒绝未知事件名', async () => {
    await withFakeHome()
    const { saveHooks } = await import('../src/main/claude-config')
    const r = await saveHooks({ FakeEvent: [{ matcher: '', hooks: [{ type: 'command', command: 'x' }] }] })
    expect(r.success).toBe(false)
    expect(r.errors[0]).toContain('未知事件名')
  })

  it('saveHooks 拒绝未知 hook 类型', async () => {
    await withFakeHome()
    const { saveHooks } = await import('../src/main/claude-config')
    const r = await saveHooks({ Stop: [{ matcher: '', hooks: [{ type: 'unknown', command: 'x' }] }] })
    expect(r.success).toBe(false)
    expect(r.errors[0]).toContain('未知 type')
  })

  it('getHooksJson / saveHooksJson 往返一致', async () => {
    await withFakeHome()
    const { saveHooksJson, getHooksJson } = await import('../src/main/claude-config')
    const json = JSON.stringify({ Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo done' }] }] }, null, 2)
    const r = await saveHooksJson(json)
    expect(r.success).toBe(true)
    const readBack = await getHooksJson()
    expect(JSON.parse(readBack)).toEqual(JSON.parse(json))
  })

  it('saveHooksJson 拒绝非法 JSON', async () => {
    await withFakeHome()
    const { saveHooksJson } = await import('../src/main/claude-config')
    const r = await saveHooksJson('{ invalid json }}}')
    expect(r.success).toBe(false)
    expect(r.errors[0]).toContain('JSON 解析失败')
  })
})
