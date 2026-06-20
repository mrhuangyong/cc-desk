// ModelSettings 测试：多供应商/模型配置 CRUD（settings 子页模板普适性验证）。
// provider 名在按钮内含圆点 span，getByText 易因节点拆分失败，故用 placeholder/title/role 定位交互，
// 用 textContent 验证存在性。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../src/renderer/state/store', () => ({
  useStore: () => ({ state: { settings: { lang: 'zh-CN' } }, dispatch: () => {} }),
}))
vi.mock('../src/renderer/i18n/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, lang: 'zh-CN' }),
}))

import { ModelSettings } from '../src/renderer/components/settings/ModelSettings'

describe('ModelSettings 多供应商配置', () => {
  const modelGet = vi.fn()
  const modelSave = vi.fn()

  beforeEach(() => {
    modelGet.mockClear(); modelSave.mockClear()
    ;(window as any).api = { ccDesk: { model: { get: modelGet, save: modelSave } } }
  })

  function baseCfg() {
    return {
      providers: [
        { id: 'p1', name: 'Provider1', apiKey: 'sk-old', baseUrl: 'http://old', enabled: true },
        { id: 'p2', name: 'Provider2', apiKey: '', baseUrl: '', enabled: false },
      ],
      models: [
        { id: 'm1', name: 'M1', providerId: 'p1', sdkModelId: 'glm-5.2', contextLength: '200000', enabled: true },
        { id: 'm2', name: 'M2', providerId: 'p2', sdkModelId: 'qwen', contextLength: '200000', enabled: true },
      ],
      modelRoleMap: {}, activeModelId: 'm1',
    }
  }

  // 等 cfg 加载完成（第一个 provider 的 apiKey 输入框出现）
  async function loaded() {
    await waitFor(() => expect(screen.getByPlaceholderText('sk-...')).toBeTruthy(), { timeout: 3000 })
  }
  function lastSave() {
    const calls = modelSave.mock.calls
    return calls[calls.length - 1][0]
  }

  it('挂载加载配置，渲染 provider 列表', async () => {
    modelGet.mockResolvedValue(baseCfg())
    const { container } = render(<ModelSettings />)
    await loaded()
    expect(container.textContent).toContain('Provider1')
    expect(container.textContent).toContain('Provider2')
  })

  it('编辑选中 provider 的 apiKey → save', async () => {
    modelGet.mockResolvedValue(baseCfg())
    render(<ModelSettings />)
    await loaded()
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-new' } })
    expect(lastSave().providers.find((p: any) => p.id === 'p1').apiKey).toBe('sk-new')
  })

  it('编辑 baseUrl → save', async () => {
    modelGet.mockResolvedValue(baseCfg())
    render(<ModelSettings />)
    await loaded()
    fireEvent.change(screen.getByPlaceholderText('http://...'), { target: { value: 'http://new-endpoint' } })
    expect(lastSave().providers.find((p: any) => p.id === 'p1').baseUrl).toBe('http://new-endpoint')
  })

  it('添加 provider → save({ providers: 含新增 })', async () => {
    modelGet.mockResolvedValue(baseCfg())
    render(<ModelSettings />)
    await loaded()
    // addProvider 按钮：含 'model.addProvider' 文本（可能有 Plus 图标拆分，用 textContent 容错）
    const addBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('model.addProvider'))!
    fireEvent.click(addBtn)
    expect(lastSave().providers.length).toBe(3)
    expect(lastSave().providers[2].name).toBe('model.newProvider')
    expect(lastSave().providers[2].enabled).toBe(true)
  })

  it('enabled toggle：禁用 provider → save({enabled:false})', async () => {
    modelGet.mockResolvedValue(baseCfg())
    render(<ModelSettings />)
    await loaded()
    // enabled=true 时按钮文本是 model.enabled（点它切换为禁用）
    const disableBtn = screen.getAllByRole('button').find(b => b.textContent?.trim() === 'model.enabled')!
    fireEvent.click(disableBtn)
    expect(lastSave().providers.find((p: any) => p.id === 'p1').enabled).toBe(false)
  })

  it('添加 model → save({ models: 含新增，归属当前 provider })', async () => {
    modelGet.mockResolvedValue(baseCfg())
    render(<ModelSettings />)
    await loaded()
    const addModelBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('model.addModel'))!
    fireEvent.click(addModelBtn)
    expect(lastSave().models.length).toBe(3)
    expect(lastSave().models[2].providerId).toBe('p1')
    expect(lastSave().models[2].contextLength).toBe('200000')
  })

  it('删除 provider → 级联删除其 models', async () => {
    modelGet.mockResolvedValue(baseCfg())
    render(<ModelSettings />)
    await loaded()
    // provider 的删除按钮在 model 删除按钮之前
    fireEvent.click(screen.getAllByLabelText('删除')[0])      // 进入确认
    fireEvent.click(screen.getByText('model.confirmDelete')) // 确认
    const last = lastSave()
    expect(last.providers.find((p: any) => p.id === 'p1')).toBeUndefined()
    expect(last.models.find((m: any) => m.id === 'm1')).toBeUndefined()  // p1 的 model 级联删
    expect(last.models.find((m: any) => m.id === 'm2')).toBeTruthy()     // p2 的 model 保留
  })

  it('get 失败 → 显示错误态', async () => {
    modelGet.mockRejectedValue(new Error('boom'))
    render(<ModelSettings />)
    await waitFor(() => expect(screen.getByText(/读取配置失败/)).toBeTruthy())
  })
})
