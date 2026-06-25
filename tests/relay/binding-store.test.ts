import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'

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
})
