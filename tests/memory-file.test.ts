// 主进程 memory-file 读写测试：隔离到 os.tmpdir()，不触碰真实 ~/.cc-desk/claude。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'

// 隔离 CLAUDE_CONFIG_DIR 的工厂：返回动态导入的 memory-file 模块，路径指向临时目录。
async function withFakeConfigDir() {
  const fakeDir = join(tmpdir(), `cc-mem-${Math.random().toString(36).slice(2)}-${Date.now()}`)
  await mkdir(fakeDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = fakeDir
  vi.resetModules()
  const mod = await import('../src/main/memory-file')
  return { mod, fakeDir }
}

describe('memory-file 读写', () => {
  let origDir: string | undefined
  beforeEach(() => { origDir = process.env.CLAUDE_CONFIG_DIR })
  afterEach(() => {
    if (origDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = origDir
    vi.resetModules()
  })

  it('文件不存在时 getMemoryFile 返回空串', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    expect(existsSync(join(fakeDir, 'CLAUDE.md'))).toBe(false)
    const content = await mod.getMemoryFile()
    expect(content).toBe('')
  })

  it('saveMemoryFile 写入后 getMemoryFile 读回一致', async () => {
    const { mod, fakeDir } = await withFakeConfigDir()
    const text = '# 记忆\n\n- 这是全局指令\n- 中文内容'
    await mod.saveMemoryFile(text)
    const onDisk = await readFile(join(fakeDir, 'CLAUDE.md'), 'utf-8')
    expect(onDisk).toBe(text)
    const back = await mod.getMemoryFile()
    expect(back).toBe(text)
  })
})
