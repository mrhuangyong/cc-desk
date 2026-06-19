import { describe, it, expect } from 'vitest'
import { tokenizeLinks, splitLine, resolvePath } from '../src/renderer/utils/links'

describe('tokenizeLinks', () => {
  it('识别相对路径', () => {
    const tokens = tokenizeLinks('请看 src/renderer/App.tsx 的实现')
    const paths = tokens.filter(t => t.kind === 'path')
    expect(paths).toHaveLength(1)
    expect(paths[0].path).toBe('src/renderer/App.tsx')
  })

  it('识别绝对路径', () => {
    const tokens = tokenizeLinks('绝对路径：/Users/mrhua/projects/app.tsx')
    const paths = tokens.filter(t => t.kind === 'path')
    expect(paths).toHaveLength(1)
    expect(paths[0].path).toBe('/Users/mrhua/projects/app.tsx')
  })

  it('识别带行号的路径', () => {
    const tokens = tokenizeLinks('见 src/foo.ts:42 这里')
    const paths = tokens.filter(t => t.kind === 'path')
    expect(paths).toHaveLength(1)
    expect(paths[0].path).toBe('src/foo.ts')
    expect(paths[0].line).toBe(42)
  })

  it('识别裸 URL', () => {
    const tokens = tokenizeLinks('访问 https://example.com/path 看看')
    const urls = tokens.filter(t => t.kind === 'url')
    expect(urls).toHaveLength(1)
    expect(urls[0].href).toBe('https://example.com/path')
  })

  it('URL 与路径混合识别', () => {
    const tokens = tokenizeLinks('访问 https://example.com 并打开 ./config.json')
    const kinds = tokens.map(t => t.kind)
    expect(kinds).toEqual(expect.arrayContaining(['url', 'path']))
  })

  it('不误判普通文本为路径', () => {
    const tokens = tokenizeLinks('这是 hello world 普通文本')
    expect(tokens.every(t => t.kind === 'text')).toBe(true)
  })

  it('不误判邮箱为路径', () => {
    const tokens = tokenizeLinks('邮箱 mrhua@test.com 不是路径')
    expect(tokens.every(t => t.kind === 'text')).toBe(true)
  })

  it('不误判 IP 地址为路径', () => {
    const tokens = tokenizeLinks('IP 192.168.1.1 不是路径')
    expect(tokens.every(t => t.kind === 'text')).toBe(true)
  })

  it('中文标点边界正确修剪', () => {
    const tokens = tokenizeLinks('打开 src/foo.ts，然后')
    const paths = tokens.filter(t => t.kind === 'path')
    expect(paths[0].path).toBe('src/foo.ts')
  })

  it('识别多个路径', () => {
    const tokens = tokenizeLinks('src/a.ts 和 src/b.ts 一起')
    const paths = tokens.filter(t => t.kind === 'path')
    expect(paths).toHaveLength(2)
  })
})

describe('splitLine', () => {
  it('无行号返回纯路径', () => {
    expect(splitLine('src/foo.ts')).toEqual({ path: 'src/foo.ts' })
  })
  it('带行号', () => {
    expect(splitLine('src/foo.ts:42')).toEqual({ path: 'src/foo.ts', line: 42 })
  })
  it('带行号列号', () => {
    expect(splitLine('src/foo.ts:12:8')).toEqual({ path: 'src/foo.ts', line: 12 })
  })
})

describe('resolvePath', () => {
  it('绝对路径原样返回', () => {
    expect(resolvePath('/Users/x/foo.ts', '/cwd')).toBe('/Users/x/foo.ts')
  })
  it('相对路径基于 cwd 解析', () => {
    expect(resolvePath('src/foo.ts', '/Users/proj')).toBe('/Users/proj/src/foo.ts')
  })
  it('./ 前缀解析', () => {
    expect(resolvePath('./config.json', '/Users/proj')).toBe('/Users/proj/config.json')
  })
  it('../ 上溯', () => {
    // /Users/proj/sub 的上级是 /Users/proj，再接 parent → /Users/proj/parent
    expect(resolvePath('../parent/file.md', '/Users/proj/sub')).toBe('/Users/proj/parent/file.md')
  })
})
