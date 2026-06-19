import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

const TMP_HOME = path.join(os.tmpdir(), `cc-desk-claudedir-test-${Date.now()}-${process.pid}`)
const ORIG_HOME = process.env.HOME
const ORIG_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR

beforeEach(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
  fs.mkdirSync(TMP_HOME, { recursive: true })
  process.env.HOME = TMP_HOME
  delete process.env.CLAUDE_CONFIG_DIR
})

afterEach(() => {
  process.env.HOME = ORIG_HOME
  if (ORIG_CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIG_CLAUDE_CONFIG_DIR
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

describe('Claude config dir isolation', () => {
  it('CLAUDE_CONFIG_DIR 指向 ~/.cc-desk/claude，与 ~/.claude 隔离', async () => {
    const { CLAUDE_CONFIG_DIR, CC_DESK_DIR } = await import('../src/main/paths')
    expect(CLAUDE_CONFIG_DIR).toBe(path.join(TMP_HOME, '.cc-desk', 'claude'))
    expect(CLAUDE_CONFIG_DIR).not.toBe(path.join(TMP_HOME, '.claude'))
    expect(CLAUDE_CONFIG_DIR.startsWith(CC_DESK_DIR)).toBe(true)
  })

  it('ensureClaudeConfigDir 创建目录并写入 process.env.CLAUDE_CONFIG_DIR', async () => {
    const { ensureClaudeConfigDir, CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    expect(fs.existsSync(CLAUDE_CONFIG_DIR)).toBe(false)
    ensureClaudeConfigDir()
    expect(fs.existsSync(CLAUDE_CONFIG_DIR)).toBe(true)
    expect(fs.statSync(CLAUDE_CONFIG_DIR).isDirectory()).toBe(true)
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(CLAUDE_CONFIG_DIR)
  })

  it('ensureClaudeConfigDir 幂等：目录已存在时不报错', async () => {
    const { ensureClaudeConfigDir, CLAUDE_CONFIG_DIR } = await import('../src/main/paths')
    fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true })
    expect(() => ensureClaudeConfigDir()).not.toThrow()
    expect(fs.existsSync(CLAUDE_CONFIG_DIR)).toBe(true)
  })

  it('CLAUDE_CONFIG_DIR 尊重已设置的 env（优先级高于默认推导），便于测试与自定义部署', async () => {
    process.env.CLAUDE_CONFIG_DIR = path.join(TMP_HOME, 'custom-claude-dir')
    vi.resetModules()
    const { CLAUDE_CONFIG_DIR, ensureClaudeConfigDir } = await import('../src/main/paths')
    expect(CLAUDE_CONFIG_DIR).toBe(path.join(TMP_HOME, 'custom-claude-dir'))
    ensureClaudeConfigDir()
    expect(fs.existsSync(CLAUDE_CONFIG_DIR)).toBe(true)
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(path.join(TMP_HOME, 'custom-claude-dir'))
  })
})
