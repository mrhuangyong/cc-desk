import { describe, it, expect } from 'vitest'
import { fileKindOf, toFileUrl } from '../src/renderer/components/fileKind'

describe('fileKindOf', () => {
  it('图片扩展名 → image', () => {
    expect(fileKindOf('/a/b.png')).toBe('image')
    expect(fileKindOf('/a/b.JPG')).toBe('image')          // 大小写不敏感
    expect(fileKindOf('/a/b.svg')).toBe('image')
    expect(fileKindOf('/a/b.webp')).toBe('image')
  })

  it('二进制扩展名 → binary', () => {
    expect(fileKindOf('/a/x.zip')).toBe('binary')
    expect(fileKindOf('/a/x.DMG')).toBe('binary')
    expect(fileKindOf('/a/x.pdf')).toBe('binary')
    expect(fileKindOf('/a/x.woff2')).toBe('binary')
    expect(fileKindOf('/a/x.exe')).toBe('binary')
  })

  it('文本扩展名 / 无扩展名 → text', () => {
    expect(fileKindOf('/a/c.ts')).toBe('text')
    expect(fileKindOf('/a/c.md')).toBe('text')
    expect(fileKindOf('/a/c.json')).toBe('text')
    expect(fileKindOf('/a/c.rs')).toBe('text')            // 陌生源码后缀也算文本
    expect(fileKindOf('/a/Makefile')).toBe('text')        // 无扩展名 → text
    expect(fileKindOf('/a/.gitignore')).toBe('text')      // 点文件无常规扩展名 → text
  })
})

describe('toFileUrl', () => {
  it('posix 绝对路径', () => {
    expect(toFileUrl('/a/b.png')).toBe('file:///a/b.png')
  })
  it('Windows 盘符路径', () => {
    expect(toFileUrl('C:\\a\\b.png')).toBe('file:///C:/a/b.png')
  })
})
