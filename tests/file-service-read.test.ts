// file-service 读操作测试：readDirTree / readFileContent / searchFiles。
// 用真实临时目录树验证递归、depth 控制、IGNORE 过滤、gitignore 尊重、大文件拒绝。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { rmSync } from 'fs'
import { readDirTree, readFileContent, searchFiles } from '../src/main/file-service'

describe('file-service 读操作', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cc-fs-'))
    // 构造目录树：
    //   root/
    //     a.txt
    //     sub/
    //       b.md
    //       deep/
    //         c.ts
    //     node_modules/   ← 应被忽略
    //     .git/           ← 应被忽略
    //     .gitignore      ← 忽略 *.log
    //     skip.log        ← searchFiles 应忽略
    await writeFile(join(root, 'a.txt'), 'aaa')
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'sub', 'b.md'), '# b')
    await mkdir(join(root, 'sub', 'deep'))
    await writeFile(join(root, 'sub', 'deep', 'c.ts'), 'export const c = 1')
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', 'pkg.js'), 'pkg')
    await mkdir(join(root, '.git'))
    await writeFile(join(root, '.git', 'config'), 'git')
    await writeFile(join(root, '.gitignore'), '*.log\n')
    await writeFile(join(root, 'skip.log'), 'log')
  })
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* noop */ } })

  it('readDirTree：递归读取，忽略 node_modules/.git，目录排序优先', async () => {
    const tree = await readDirTree(root, 3)
    const names = tree.map(n => n.name)
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
    expect(names).toContain('a.txt')
    expect(names).toContain('sub')
    // .gitignore 非目录，readDirTree 不过滤它（只过滤 IGNORE 集合）
    expect(names).toContain('.gitignore')
    // 目录排在文件前
    const subIdx = names.indexOf('sub')
    const aIdx = names.indexOf('a.txt')
    expect(subIdx).toBeLessThan(aIdx)
    // 递归到 deep/c.ts
    const sub = tree.find(n => n.name === 'sub')!
    expect(sub.isDir).toBe(true)
    const deep = sub.children!.find(n => n.name === 'deep')!
    expect(deep.children!.find(n => n.name === 'c.ts')).toBeTruthy()
  })

  it('readDirTree：depth=1 不递归子目录（children 为空数组）', async () => {
    const tree = await readDirTree(root, 1)
    const sub = tree.find(n => n.name === 'sub')!
    expect(sub.isDir).toBe(true)
    expect(sub.children).toEqual([])  // depth 到顶，不再下钻
  })

  it('readDirTree：depth=0 返回空', async () => {
    const tree = await readDirTree(root, 0)
    expect(tree).toEqual([])
  })

  it('readFileContent：正常读 UTF-8 文本', async () => {
    const txt = await readFileContent(join(root, 'a.txt'))
    expect(txt).toBe('aaa')
    const ts = await readFileContent(join(root, 'sub', 'deep', 'c.ts'))
    expect(ts).toContain('export const c')
  })

  it('readFileContent：>200KB 抛错', async () => {
    const big = join(root, 'big.txt')
    await writeFile(big, 'x'.repeat(1024 * 200 + 1))
    await expect(readFileContent(big)).rejects.toThrow(/过大/)
  })

  it('searchFiles：返回扁平文件列表，尊重 .gitignore（*.log）与 IGNORE（node_modules/.git）', async () => {
    const files = await searchFiles(root)
    expect(files).toEqual(expect.arrayContaining(['a.txt', 'sub/b.md', 'sub/deep/c.ts']))
    expect(files.some(f => f.includes('node_modules'))).toBe(false)
    expect(files.some(f => f.includes('.git/'))).toBe(false)
    expect(files).not.toContain('skip.log')  // 被 *.gitignore 忽略
  })
})
