import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readImageAsAttachment } from './read-image'

// jsdom 不实现 FileReader 的真实读取,这里 mock:实例化后存引用,测试手动触发 onload
class MockFileReader {
  result: string | ArrayBuffer | null = null
  error: any = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(_file: File) { /* 测试手动调 onload 前设置 this.result */ }
}
let mockReader: MockFileReader
beforeEach(() => {
  mockReader = new MockFileReader()
  vi.stubGlobal('FileReader', function () { return mockReader })
})

describe('readImageAsAttachment', () => {
  it('图片文件 → {mediaType, data(纯base64无前缀), name}', async () => {
    const file = new File(['blob'], 'x.png', { type: 'image/png' })
    const p = readImageAsAttachment(file)
    // 手动触发 onload,设置 data URL 结果
    mockReader.result = 'data:image/png;base64,iVBORw0KGgo='
    mockReader.onload!()
    const r = await p
    expect(r.mediaType).toBe('image/png')
    expect(r.data).toBe('iVBORw0KGgo=') // 去掉 data URL 前缀,纯 base64
    expect(r.name).toBe('x.png')
  })

  it('非图片文件 → reject', async () => {
    const file = new File(['text'], 'a.txt', { type: 'text/plain' })
    await expect(readImageAsAttachment(file)).rejects.toThrow(/非图片/)
  })
})
