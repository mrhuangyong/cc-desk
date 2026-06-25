// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as gitService from '../src/main/git-service'

const exec = promisify(execFile)

// 在 dir 建 git 仓库并初始化一次提交（空仓库 status 行为不同，需有 HEAD）
async function initRepo(dir: string): Promise<void> {
  const run = (args: string[]) => exec('git', args, { cwd: dir })
  await run(['init'])
  await run(['config', 'user.email', 't@t.com'])
  await run(['config', 'user.name', 't'])
  await run(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'README.md'), 'init\n')
  await run(['add', 'README.md'])
  await run(['commit', '-m', 'init'])
}

let repo: string
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'ccdesk-git-'))
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('git-service.status', () => {
  it('解析已修改/新增/未跟踪文件', async () => {
    await initRepo(repo)
    await writeFile(join(repo, 'README.md'), 'changed\n')          // modified (workdir)
    await writeFile(join(repo, 'a.txt'), 'new\n')                  // untracked
    const status = await gitService.status(repo)
    const readme = status.find(s => s.path === 'README.md')!
    expect(readme.workdirStatus).toBe('modified')
    expect(readme.indexStatus).toBeNull()
    const a = status.find(s => s.path === 'a.txt')!
    expect(a.workdirStatus).toBe('untracked')
  })

  it('识别已暂存改动（indexStatus）', async () => {
    await initRepo(repo)
    await writeFile(join(repo, 'README.md'), 'staged\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    const status = await gitService.status(repo)
    const readme = status.find(s => s.path === 'README.md')!
    expect(readme.indexStatus).toBe('modified')
    expect(readme.workdirStatus).toBeNull()
  })

  it('识别 MM（暂存后又改）', async () => {
    await initRepo(repo)
    await writeFile(join(repo, 'README.md'), 'v1\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'v2\n')
    const status = await gitService.status(repo)
    const readme = status.find(s => s.path === 'README.md')!
    expect(readme.indexStatus).toBe('modified')
    expect(readme.workdirStatus).toBe('modified')
  })

  it('非 git 仓库抛 NOT_A_REPO', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ccdesk-empty-'))
    try {
      await expect(gitService.status(empty)).rejects.toMatchObject({ code: 'NOT_A_REPO' })
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

describe('git-service.diff', () => {
  beforeEach(async () => { await initRepo(repo) })

  it('HEAD scope 含未暂存改动', async () => {
    await writeFile(join(repo, 'README.md'), 'changed\n')
    const d = await gitService.diff(repo, 'HEAD')
    expect(d).toContain('-init')
    expect(d).toContain('+changed')
  })

  it('cached scope 仅含暂存改动', async () => {
    await writeFile(join(repo, 'README.md'), 'staged\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    await writeFile(join(repo, 'other.txt'), 'unstaged\n')
    const d = await gitService.diff(repo, 'cached')
    expect(d).toContain('README.md')
    expect(d).not.toContain('other.txt')
  })

  it('workdir scope 含未暂存、不含已暂存', async () => {
    await writeFile(join(repo, 'README.md'), 'v1\n')
    await exec('git', ['add', 'README.md'], { cwd: repo })
    const d = await gitService.diff(repo, 'workdir')
    // 已全部暂存，工作区相对 index 无差异 → 空或不含该文件
    expect(d).not.toContain('README.md')
  })

  it('filePath 限定单文件', async () => {
    await writeFile(join(repo, 'README.md'), 'a\n')
    await writeFile(join(repo, 'b.txt'), 'b\n')
    const d = await gitService.diff(repo, 'HEAD', 'README.md')
    expect(d).toContain('README.md')
    expect(d).not.toContain('b.txt')
  })
})
