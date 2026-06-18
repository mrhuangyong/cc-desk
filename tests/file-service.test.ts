import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileContent } from '../src/main/file-service'
import { mkdtemp, rm, readFile, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('writeFileContent', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ccdesk-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('写入新内容到不存在的文件', async () => {
    const f = join(dir, 'a.txt')
    await writeFileContent(f, 'hello')
    expect(await readFile(f, 'utf-8')).toBe('hello')
  })

  it('覆盖已有文件内容', async () => {
    const f = join(dir, 'b.txt')
    await writeFileContent(f, 'old')
    await writeFileContent(f, 'new')
    expect(await readFile(f, 'utf-8')).toBe('new')
  })

  it('写入后不留 tmp 残留文件', async () => {
    const f = join(dir, 'c.txt')
    await writeFileContent(f, 'x')
    await expect(stat(f + '.ccdesk-tmp')).rejects.toThrow()
  })

  it('目标目录不存在时抛错，且不产生 tmp 残留', async () => {
    const f = join(dir, 'nodir', 'd.txt')
    await expect(writeFileContent(f, 'x')).rejects.toThrow()
    // dir 下不应有 ccdesk-tmp 残留
    await expect(stat(join(dir, 'nodir'))).rejects.toThrow()
  })
})
