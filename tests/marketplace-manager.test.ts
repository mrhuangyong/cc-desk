import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'

const TMP_DIR = join(tmpdir(), `mkt-${Math.random().toString(36).slice(2)}-${Date.now()}`)
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

describe('parseSource 智能识别', () => {
  it('github owner/repo 简写', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('anthropics/claude-plugins')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('github 完整 HTTPS URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://github.com/anthropics/claude-plugins')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('github SSH URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('git@github.com:anthropics/claude-plugins.git')
    expect(s.source).toBe('github')
    expect((s as any).repo).toBe('anthropics/claude-plugins')
  })
  it('git 非 github URL', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://gitlab.com/team/plugins.git')
    expect(s.source).toBe('git')
    expect((s as any).url).toBe('https://gitlab.com/team/plugins.git')
  })
  it('url 直链 json', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    const s = parseSource('https://example.com/marketplace.json')
    expect(s.source).toBe('url')
    expect((s as any).url).toBe('https://example.com/marketplace.json')
  })
  it('file 本地 json 路径', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    await writeFile(join(TMP_DIR, 'm.json'), '{}')
    const s = parseSource(join(TMP_DIR, 'm.json'))
    expect(s.source).toBe('file')
  })
  it('directory 本地目录路径', async () => {
    const { parseSource } = await import('../src/main/marketplace-manager')
    await mkdir(join(TMP_DIR, 'mydir'), { recursive: true })
    const s = parseSource(join(TMP_DIR, 'mydir'))
    expect(s.source).toBe('directory')
  })
})
