import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm, readFile } from "fs/promises"
import { existsSync } from "fs"

const TMP_DIR = join(tmpdir(), `cmd-${Math.random().toString(36).slice(2)}-${Date.now()}`)
let origDir: string | undefined

beforeEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true })
  await mkdir(TMP_DIR, { recursive: true })
  origDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = TMP_DIR
  vi.resetModules()
})
afterEach(async () => {
  if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = origDir
  vi.resetModules()
  await rm(TMP_DIR, { recursive: true, force: true })
})

describe('createCommand', () => {
  it('创建成功：文件存在 + frontmatter 正确', async () => {
    const { createCommand } = await import('../src/main/claude-config')
    const result = await createCommand('my-cmd', '测试命令')
    expect(result.success).toBe(true)
    const content = await readFile(join(TMP_DIR, 'commands', 'my-cmd.md'), 'utf-8')
    expect(content).toContain('description: 测试命令')
  })
  it('重名报错', async () => {
    const { createCommand } = await import('../src/main/claude-config')
    await createCommand('my-cmd', 'first')
    const r2 = await createCommand('my-cmd', 'second')
    expect(r2.success).toBe(false)
    expect(r2.message).toContain('已存在')
  })
  it('非法 name 报错', async () => {
    const { createCommand } = await import('../src/main/claude-config')
    const r = await createCommand('My Command!', 'bad')
    expect(r.success).toBe(false)
    expect(r.message).toContain('格式')
  })
})

describe('getCommandFile', () => {
  it('自定义命令读取成功', async () => {
    const { createCommand, getCommandFile } = await import('../src/main/claude-config')
    await createCommand('read-test', 'desc')
    const content = await getCommandFile('user', 'read-test')
    expect(content).toContain('description: desc')
  })
  it('builtin 返回空串', async () => {
    const { getCommandFile } = await import('../src/main/claude-config')
    const content = await getCommandFile('builtin', 'init')
    expect(content).toBe('')
  })
})

describe('saveCommandFile', () => {
  it('写回成功', async () => {
    const { createCommand, saveCommandFile, getCommandFile } = await import('../src/main/claude-config')
    await createCommand('save-test', 'old')
    await saveCommandFile('save-test', '---\ndescription: new\n---\nNew body')
    const content = await getCommandFile('user', 'save-test')
    expect(content).toContain('New body')
    expect(content).toContain('description: new')
  })
})

describe('deleteCommand', () => {
  it('删除成功', async () => {
    const { createCommand, deleteCommand } = await import('../src/main/claude-config')
    await createCommand('del-test', 'desc')
    const path = join(TMP_DIR, 'commands', 'del-test.md')
    expect(existsSync(path)).toBe(true)
    await deleteCommand('del-test')
    expect(existsSync(path)).toBe(false)
  })
})
