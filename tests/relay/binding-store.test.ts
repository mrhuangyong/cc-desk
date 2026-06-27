import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm, writeFile, mkdir } from 'fs/promises'

describe('binding-store', () => {
  let file: string
  beforeEach(() => { file = join(tmpdir(), `bind-${Math.random().toString(36).slice(2)}.json`) })
  afterEach(async () => { await rm(file, { force: true }) })

  it('addBinding 双向绑定，getPeer 能互查', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    await store.addBinding('D', 'M')
    expect(store.getPeer('D')).toBe('M')
    expect(store.getPeer('M')).toBe('D')
  })

  it('removeBinding 删除双向绑定', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    await store.addBinding('D', 'M')
    await store.removeBinding('D')
    expect(store.getPeer('D')).toBeUndefined()
    expect(store.getPeer('M')).toBeUndefined()
  })

  it('持久化：重新打开文件能读到已有绑定', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    await (await import('../../relay/binding-store')).createBindingStore(file).addBinding('D', 'M')
    const store2 = createBindingStore(file)
    expect(store2.getPeer('D')).toBe('M')
  })

  it('has：已绑定返回 true，未绑定返回 false', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    await store.addBinding('D', 'M')
    expect(store.has('D')).toBe(true)
    expect(store.has('M')).toBe(true)
    expect(store.has('X')).toBe(false)
  })

  it('loadBindings 直接调用返回绑定 map（数组值）', async () => {
    const { loadBindings } = await import('../../relay/binding-store')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify({ A: ['B'], B: ['A'] }), 'utf-8')
    const map = await loadBindings(file)
    expect(map).toEqual({ A: ['B'], B: ['A'] })
  })

  it('saveBindings 写入后能被 loadBindings 读回', async () => {
    const { saveBindings, loadBindings } = await import('../../relay/binding-store')
    await saveBindings(file, { X: ['Y'], Y: ['X'] })
    const map = await loadBindings(file)
    expect(map).toEqual({ X: ['Y'], Y: ['X'] })
  })

  it('loadBindings 边界：文件内容是 JSON 数组时返回 {}', async () => {
    const { loadBindings } = await import('../../relay/binding-store')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify([1, 2, 3]), 'utf-8')
    const map = await loadBindings(file)
    expect(map).toEqual({})
  })

  // === 一对多（1 桌面 ↔ N 手机）===
  it('getPeers：桌面绑多个手机，返回全部对端集合', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    await store.addBinding('D', 'M1')
    await store.addBinding('D', 'M2')
    await store.addBinding('D', 'M3')
    expect(store.getPeers('D')).toEqual(new Set(['M1', 'M2', 'M3']))
    // 每个手机的对端集合都只有桌面（手机→桌面一对一）
    expect(store.getPeers('M1')).toEqual(new Set(['D']))
    expect(store.getPeers('M2')).toEqual(new Set(['D']))
  })

  it('getPeers：幂等 addBinding 同一对不重复', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    await store.addBinding('D', 'M1')
    await store.addBinding('D', 'M1') // 重复
    expect(store.getPeers('D')).toEqual(new Set(['M1']))
  })

  it('getPeers：未绑定返回空集合', async () => {
    const { createBindingStore } = await import('../../relay/binding-store')
    const store = createBindingStore(file)
    expect(store.getPeers('X')).toEqual(new Set())
  })

  it('一对多持久化：重新打开文件能读到全部绑定', async () => {
    const mod = await import('../../relay/binding-store')
    const store1 = mod.createBindingStore(file)
    await store1.addBinding('D', 'M1')
    await store1.addBinding('D', 'M2')
    const store2 = mod.createBindingStore(file)
    expect(store2.getPeers('D')).toEqual(new Set(['M1', 'M2']))
  })

  it('迁移：读旧版单值格式 bindings.json（向下一对多兼容）', async () => {
    // 旧格式：{ "D":"M1", "M1":"D" }（单值，桌面被覆盖前可能还有别的手机但被丢了）
    // 这里模拟「桌面只绑一个手机」的旧格式，新代码应能读出
    const { createBindingStore } = await import('../../relay/binding-store')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify({ D: 'M1', M1: 'D' }), 'utf-8')
    const store = createBindingStore(file)
    expect(store.getPeers('D')).toEqual(new Set(['M1']))
    expect(store.getPeers('M1')).toEqual(new Set(['D']))
    expect(store.has('D')).toBe(true)
  })

  it('迁移：读旧版「桌面绑多手机但被覆盖」格式，对称化补全后桌面恢复全部手机', async () => {
    // 旧单值格式：桌面被覆盖成只记得 M3，但 M1/M2/M3 都指向桌面。
    // 启动时对称化补全：从 M1/M2/M3 → D 反推出 D 应绑定 M1/M2/M3。
    const { createBindingStore } = await import('../../relay/binding-store')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify({ D: 'M3', M1: 'D', M2: 'D', M3: 'D' }), 'utf-8')
    const store = createBindingStore(file)
    // 桌面 D 现在应恢复全部 3 个手机（修复根因：广播路由需要完整 peers）
    expect(store.getPeers('D')).toEqual(new Set(['M1', 'M2', 'M3']))
    expect(store.getPeers('M1')).toEqual(new Set(['D']))
    // 落盘（fire-and-forget）后重新打开仍完整
    await new Promise((r) => setTimeout(r, 50))
    const store2 = createBindingStore(file)
    expect(store2.getPeers('D')).toEqual(new Set(['M1', 'M2', 'M3']))
  })
})
