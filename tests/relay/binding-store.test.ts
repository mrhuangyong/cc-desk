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

  it('loadBindings 直接调用返回绑定 map', async () => {
    const { loadBindings } = await import('../../relay/binding-store')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify({ A: 'B', B: 'A' }), 'utf-8')
    const map = await loadBindings(file)
    expect(map).toEqual({ A: 'B', B: 'A' })
  })

  it('saveBindings 写入后能被 loadBindings 读回', async () => {
    const { saveBindings, loadBindings } = await import('../../relay/binding-store')
    await saveBindings(file, { X: 'Y', Y: 'X' })
    const map = await loadBindings(file)
    expect(map).toEqual({ X: 'Y', Y: 'X' })
  })

  it('loadBindings 边界：文件内容是 JSON 数组时返回 {}', async () => {
    const { loadBindings } = await import('../../relay/binding-store')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify([1, 2, 3]), 'utf-8')
    const map = await loadBindings(file)
    expect(map).toEqual({})
  })
})
