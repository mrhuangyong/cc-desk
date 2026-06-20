import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

let mockState: any
const dispatch = vi.fn()

vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: mockState, dispatch }),
}))

import { CodePreviewSettings } from '../src/renderer/components/settings/CodePreviewSettings'
import { SkillsSettings } from '../src/renderer/components/settings/SkillsSettings'
import { McpSettings } from '../src/renderer/components/settings/McpSettings'
import { PluginSettings } from '../src/renderer/components/settings/PluginSettings'
import { CommandSettings } from '../src/renderer/components/settings/CommandSettings'
import { HooksSettings } from '../src/renderer/components/settings/HooksSettings'
import { SettingsPage } from '../src/renderer/components/settings/SettingsPage'

function baseSettings(overrides: Record<string, any> = {}) {
  return {
    apiKey: '',
    model: 'model-sonnet',
    cwd: '/tmp/project',
    providers: [],
    models: [],
    modelRoleMap: {},
    theme: 'codex-light',
    lang: 'zh-CN',
    zoom: 'normal',
    proxy: '',
    inheritTerminal: true,
    terminalFont: 'mono',
    taskNotify: true,
    notifySound: true,
    queueMode: 'queue',
    showThinking: false,
    showTodo: false,
    showBackendTask: true,
    autoArchive: true,
    archiveDays: '7',
    codePreview: {
      lightTheme: 'GitHub Light',
      darkTheme: 'GitHub Dark',
      showLineNumbers: true,
      wordWrap: false,
      fontSize: 12,
    },
    skills: [],
    mcpServers: [],
    plugins: [],
    commands: [],
    hooks: [],
    ...overrides,
  }
}

function setApi(api: Record<string, any>) {
  ;(window as any).api = api
}

describe('CodePreviewSettings', () => {
  const settingsSave = vi.fn()

  beforeEach(() => {
    dispatch.mockClear()
    settingsSave.mockClear()
    mockState = { settings: baseSettings() }
    setApi({ settings: { save: settingsSave } })
  })

  it('切换浅色主题会保存完整 codePreview 子对象', () => {
    render(<CodePreviewSettings />)
    fireEvent.change(screen.getByDisplayValue('GitHub Light'), { target: { value: 'Solarized Light' } })

    const expected = { ...baseSettings().codePreview, lightTheme: 'Solarized Light' }
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SETTINGS', settings: { codePreview: expected } })
    expect(settingsSave).toHaveBeenCalledWith({ codePreview: expected })
  })

  it('切换显示行号、自动换行、字号都会持久化', () => {
    render(<CodePreviewSettings />)
    fireEvent.click(screen.getByRole('switch', { name: '显示行号' }))
    fireEvent.click(screen.getByRole('switch', { name: '长行自动换行' }))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '16' } })

    expect(settingsSave).toHaveBeenCalledWith({
      codePreview: { ...baseSettings().codePreview, showLineNumbers: false },
    })
    expect(settingsSave).toHaveBeenCalledWith({
      codePreview: { ...baseSettings().codePreview, wordWrap: true },
    })
    expect(settingsSave).toHaveBeenCalledWith({
      codePreview: { ...baseSettings().codePreview, fontSize: 16 },
    })
  })
})

describe('SkillsSettings', () => {
  const skillsGet = vi.fn()

  beforeEach(() => {
    skillsGet.mockClear()
    setApi({ cc: { skills: { get: skillsGet, setEnabled: vi.fn().mockResolvedValue(undefined) } } })
  })

  it('加载技能列表并按名称/描述搜索', async () => {
    skillsGet.mockResolvedValue([
      { id: 's1', name: 'electron', desc: 'desktop automation', enabled: true, scope: '个人', source: 'local' },
      { id: 's2', name: 'docs', desc: 'OpenAI docs helper', enabled: true, scope: '工作区', source: 'plugin' },
    ])

    render(<SkillsSettings />)
    expect(await screen.findByText('electron')).toBeTruthy()
    expect(screen.getByText('docs')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('搜索技能...'), { target: { value: 'OpenAI' } })
    expect(screen.queryByText('electron')).toBeNull()
    expect(screen.getByText('docs')).toBeTruthy()
  })

  it('技能开关触发重新读取真实技能来源', async () => {
    skillsGet.mockResolvedValue([
      { id: 's1', name: 'electron', desc: 'desktop automation', enabled: true, scope: '个人', source: 'local' },
    ])

    render(<SkillsSettings />)
    const sw = await screen.findByRole('switch', { name: '禁用 electron' })
    fireEvent.click(sw)

    await waitFor(() => expect(skillsGet).toHaveBeenCalledTimes(2))
  })
})

describe('PluginSettings', () => {
  const pluginsGet = vi.fn()
  const setEnabled = vi.fn()
  const installFn = vi.fn()
  const uninstallFn = vi.fn()
  const mktGet = vi.fn()
  const mktGetPlugins = vi.fn()
  const mktSearch = vi.fn()
  const mktAdd = vi.fn()
  const mktRemove = vi.fn()
  const mktRefresh = vi.fn()
  const mktRefreshAll = vi.fn()
  const mktSetAutoUpdate = vi.fn()

  beforeEach(() => {
    pluginsGet.mockClear()
    setEnabled.mockClear()
    mktGet.mockResolvedValue([])
    mktSearch.mockResolvedValue([])
    setApi({ cc: { plugins: { get: pluginsGet, setEnabled, install: installFn, uninstall: uninstallFn }, marketplaces: { get: mktGet, getPlugins: mktGetPlugins, search: mktSearch, add: mktAdd, remove: mktRemove, refresh: mktRefresh, refreshAll: mktRefreshAll, setAutoUpdate: mktSetAutoUpdate } } })
  })

  it('插件搜索过滤并显示统计', async () => {
    pluginsGet.mockResolvedValue([
      { id: 'p1@local', name: 'superpowers', version: '1.0.0', desc: 'planning', enabled: true, source: 'local', skills: 2, commands: 3, mcps: 1 },
      { id: 'p2@local', name: 'documents', version: '2.0.0', desc: 'docx pdf', enabled: false, source: 'local', skills: 1, commands: 0, mcps: 0 },
    ])

    render(<PluginSettings />)
    expect(await screen.findByText('superpowers')).toBeTruthy()
    expect(screen.getByText('2 技能 · 3 命令 · 1 MCP')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('搜索已安装插件...'), { target: { value: 'docx' } })
    expect(screen.queryByText('superpowers')).toBeNull()
    expect(screen.getByText('documents')).toBeTruthy()
  })

  it('插件开关写回启用状态后重新加载', async () => {
    pluginsGet.mockResolvedValue([
      { id: 'p1@local', name: 'superpowers', version: '1.0.0', desc: 'planning', enabled: true, source: 'local', skills: 2, commands: 3, mcps: 1 },
    ])
    setEnabled.mockResolvedValue(undefined)

    render(<PluginSettings />)
    fireEvent.click(await screen.findByRole('switch', { name: '停用 superpowers' }))

    expect(setEnabled).toHaveBeenCalledWith('p1@local', false)
    await waitFor(() => expect(pluginsGet).toHaveBeenCalledTimes(2))
  })
})

describe('CommandSettings', () => {
  const commandsGet = vi.fn()

  beforeEach(() => {
    commandsGet.mockClear()
    setApi({ cc: { commands: { get: commandsGet } } })
  })

  it('命令页加载命令并保持只读禁用', async () => {
    commandsGet.mockResolvedValue([
      { id: 'c1', name: '/review', desc: '审查代码', enabled: true },
      { id: 'c2', name: '/compact', desc: '压缩上下文', enabled: false },
    ])

    render(<CommandSettings />)
    expect(await screen.findByText('/review')).toBeTruthy()
    expect(screen.getByText('压缩上下文')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: '启用 /review' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('搜索命令…'), { target: { value: 'compact' } })
    expect(screen.queryByText('/review')).toBeNull()
    expect(screen.getByText('/compact')).toBeTruthy()
  })
})

describe('HooksSettings', () => {
  const hooksGet = vi.fn()
  const setHookEnabled = vi.fn()

  beforeEach(() => {
    hooksGet.mockClear()
    setHookEnabled.mockClear()
    setApi({ cc: { hooks: { get: hooksGet, setEnabled: setHookEnabled } } })
  })

  it('hooks 开关写回并 reload', async () => {
    hooksGet.mockResolvedValue([
      { id: 'h1', name: 'PreToolUse', desc: '工具前', enabled: true },
      { id: 'h2', name: 'PostToolUse', desc: '工具后', enabled: false },
    ])
    setHookEnabled.mockResolvedValue(undefined)

    render(<HooksSettings />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '启用 PreToolUse' }))

    expect(setHookEnabled).toHaveBeenCalledWith('PreToolUse', false)
    await waitFor(() => expect(hooksGet).toHaveBeenCalledTimes(2))
  })
})

describe('McpSettings', () => {
  const mcpGet = vi.fn()
  const mcpSave = vi.fn()

  const servers = [
    { id: 'playwright', name: 'playwright', transport: 'stdio', command: 'npx', args: '-y @playwright/mcp', env: 'TOKEN=1', headers: '', enabled: true, scope: '用户' },
    { id: 'reader', name: 'reader', transport: 'http', command: 'https://example.com/mcp', args: '', env: '', headers: '', enabled: true, scope: '用户' },
  ]

  beforeEach(() => {
    mcpGet.mockClear()
    mcpSave.mockClear()
    mcpGet.mockResolvedValue(servers)
    setApi({ cc: { mcp: { get: mcpGet, save: mcpSave } } })
  })

  async function loaded() {
    await screen.findByText('playwright')
  }

  function lastSave() {
    const calls = mcpSave.mock.calls
    return calls[calls.length - 1][0]
  }

  it('加载、搜索 MCP 列表并展示传输类型', async () => {
    render(<McpSettings />)
    await loaded()
    expect(screen.getByText('stdio')).toBeTruthy()
    expect(screen.getByText('http')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('搜索 MCP 服务器...'), { target: { value: 'reader' } })
    expect(screen.queryByText('playwright')).toBeNull()
    expect(screen.getByText('reader')).toBeTruthy()
  })

  it('切换 MCP 启用状态会整体保存', async () => {
    render(<McpSettings />)
    await loaded()
    fireEvent.click(screen.getByRole('switch', { name: '禁用 playwright' }))

    expect(lastSave().find((s: any) => s.id === 'playwright').enabled).toBe(false)
  })

  it('添加 MCP 只打开编辑弹窗，保存前不写入占位项', async () => {
    render(<McpSettings />)
    await loaded()
    fireEvent.click(screen.getByLabelText('添加'))

    expect(mcpSave).not.toHaveBeenCalled()
    expect(screen.getByText('编辑 MCP 服务器')).toBeTruthy()
  })

  it('取消新增 MCP 会丢弃本地占位项', async () => {
    render(<McpSettings />)
    await loaded()
    fireEvent.click(screen.getByLabelText('添加'))
    fireEvent.click(screen.getByText('取消'))

    expect(mcpSave).not.toHaveBeenCalled()
    expect(screen.queryByText('new-mcp-3')).toBeNull()
  })

  it('保存新增 MCP 用编辑后的名称作为持久化配置名', async () => {
    render(<McpSettings />)
    await loaded()
    fireEvent.click(screen.getByLabelText('添加'))

    fireEvent.change(screen.getByDisplayValue('new-mcp-3'), { target: { value: 'local-e2e' } })
    fireEvent.change(screen.getByPlaceholderText('npx'), { target: { value: 'node' } })
    fireEvent.change(screen.getByPlaceholderText('-y @playwright/mcp@latest'), { target: { value: '/tmp/server.js --flag value' } })
    fireEvent.click(screen.getByText('保存'))

    expect(lastSave()).toHaveLength(3)
    expect(lastSave()[2]).toMatchObject({
      id: expect.stringMatching(/^mcp-/),
      name: 'local-e2e',
      transport: 'stdio',
      command: 'node',
      args: '/tmp/server.js --flag value',
      enabled: true,
    })
  })

  it('删除 MCP 需要二次确认，确认后保存剩余列表', async () => {
    render(<McpSettings />)
    await loaded()
    const row = screen.getByText('playwright').closest('div')!.parentElement!
    fireEvent.click(within(row).getByLabelText('删除'))
    fireEvent.click(within(row).getByText('确认？'))

    expect(lastSave().map((s: any) => s.id)).toEqual(['reader'])
  })

  it('表单编辑 MCP 保存 name/transport/command/args/env/scope', async () => {
    render(<McpSettings />)
    await loaded()
    const row = screen.getByText('playwright').closest('div')!.parentElement!
    fireEvent.click(within(row).getByLabelText('编辑'))

    fireEvent.change(screen.getByDisplayValue('playwright'), { target: { value: 'local-playwright' } })
    fireEvent.change(screen.getByDisplayValue('用户'), { target: { value: '工作区' } })
    // 保持 stdio，测命令/参数/环境变量（http headers 另行覆盖）
    fireEvent.change(screen.getByPlaceholderText('npx'), { target: { value: 'node' } })
    fireEvent.change(screen.getByPlaceholderText(/-y @playwright/), { target: { value: 'server.js' } })
    fireEvent.click(screen.getByText(/环境变量/))
    fireEvent.change(screen.getByPlaceholderText(/KEY=VALUE/), { target: { value: 'A=B' } })
    fireEvent.click(screen.getByText('保存'))

    expect(lastSave()[0]).toMatchObject({
      name: 'local-playwright',
      transport: 'stdio',
      command: 'node',
      args: 'server.js',
      env: 'A=B',
      scope: '工作区',
    })
  })

  it('JSON 编辑 MCP 保存解析后的字段，非法 JSON 不保存', async () => {
    render(<McpSettings />)
    await loaded()
    const row = screen.getByText('reader').closest('div')!.parentElement!
    fireEvent.click(within(row).getByLabelText('编辑'))
    // 弹窗 JSON tab（与列表页视图按钮同名，取弹窗内最后一个）
    fireEvent.click(screen.getAllByText('JSON').pop()!)

    const textarea = screen.getByDisplayValue(new RegExp('https://example\\.com/mcp'))
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({ mcpServers: { 'json-reader': { type: 'http', url: 'https://new.example/mcp' } } }),
      },
    })
    fireEvent.click(screen.getByText('保存'))
    expect(lastSave()[1]).toMatchObject({ name: 'json-reader', transport: 'http', command: 'https://new.example/mcp' })

    mcpSave.mockClear()
    const row2 = screen.getByText('json-reader').closest('div')!.parentElement!
    fireEvent.click(within(row2).getByLabelText('编辑'))
    fireEvent.click(screen.getAllByText('JSON').pop()!)
    fireEvent.change(screen.getByDisplayValue(new RegExp('https://new\\.example/mcp')), { target: { value: '{bad json' } })
    fireEvent.click(screen.getByText('保存'))
    expect(mcpSave).not.toHaveBeenCalled()
  })

  it('JSON 视图展示标准格式并可整段保存', async () => {
    render(<McpSettings />)
    await loaded()
    // 切到 JSON 视图
    fireEvent.click(screen.getByText('JSON'))
    const ta = screen.getByRole('textbox')
    // 标准格式含 mcpServers 外层 + args 数组 + env 对象
    const text = (ta as HTMLTextAreaElement).value
    expect(text).toContain('mcpServers')
    expect(text).toContain('"args"')
    expect(text).toContain('"env"')

    // 整段替换为标准配置并保存
    fireEvent.change(ta, {
      target: {
        value: JSON.stringify({
          mcpServers: {
            'new-srv': { command: 'node', args: ['app.js'], env: { K: 'V' } },
          },
        }),
      },
    })
    fireEvent.click(screen.getByText('保存'))
    expect(mcpSave).toHaveBeenCalled()
    const saved = mcpSave.mock.calls[mcpSave.mock.calls.length - 1][0]
    expect(saved[0]).toMatchObject({ name: 'new-srv', transport: 'stdio', command: 'node', args: 'app.js', env: 'K=V' })
  })

  it('JSON 视图非法 JSON 不保存并提示', async () => {
    render(<McpSettings />)
    await loaded()
    fireEvent.click(screen.getByText('JSON'))
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: '{bad json' } })
    fireEvent.click(screen.getByText('保存'))
    expect(mcpSave).not.toHaveBeenCalled()
    expect(screen.getByText(/JSON 格式错误/)).toBeTruthy()
  })
})

describe('SettingsPage routing', () => {
  beforeEach(() => {
    dispatch.mockClear()
    mockState = {
      settings: baseSettings(),
      activeSettingsSection: 'commands',
      projects: [],
    }
    setApi({ cc: { commands: { get: vi.fn().mockResolvedValue([]) } } })
  })

  it('根据 activeSettingsSection 渲染对应设置子页', async () => {
    render(<SettingsPage />)
    expect(await screen.findByRole('heading', { name: '命令' })).toBeTruthy()
    expect(screen.getByPlaceholderText('搜索命令…')).toBeTruthy()
  })

  it('返回工作区按钮 dispatch SET_VIEW', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByText('← 返回工作区'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_VIEW', view: 'workspace' })
  })
})
