// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as gitService from '../src/main/git-service'
import { assertPathsInside, GitServiceError } from '../src/main/git-service'

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

  it('rename 解析：-z 模式下正确取 new path', async () => {
    await initRepo(repo)
    await exec('git', ['mv', 'README.md', 'NEW.md'], { cwd: repo })
    const status = await gitService.status(repo)
    const renamed = status.find(s => s.indexStatus === 'renamed')!
    expect(renamed).toBeDefined()
    expect(renamed.path).toBe('NEW.md')
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

describe('assertPathsInside', () => {
  it('合法子路径不抛', () => {
    expect(() => assertPathsInside(repo, ['subdir/file.txt'])).not.toThrow()
  })

  it('路径越界抛 GitServiceError', () => {
    expect(() => assertPathsInside(repo, ['../etc/passwd'])).toThrow(GitServiceError)
    try {
      assertPathsInside(repo, ['../etc/passwd'])
    } catch (e: any) {
      expect(e.code).toBe('GIT_ERROR')
    }
  })
})

describe('git-service 写操作', () => {
  beforeEach(async () => { await initRepo(repo) })

  it('add 暂存文件', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(st.stdout.trim()).toBe('A  a.txt')
  })

  it('restore --staged 取消暂存', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await exec('git', ['add', 'a.txt'], { cwd: repo })
    await gitService.restore(repo, ['a.txt'], { staged: true })
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(st.stdout.trim()).toBe('?? a.txt')
  })

  it('restore（非 staged）丢弃工作区改动', async () => {
    await writeFile(join(repo, 'README.md'), 'dirty\n')
    await gitService.restore(repo, ['README.md'], { staged: false })
    const content = await import('node:fs/promises').then(m => m.readFile(join(repo, 'README.md'), 'utf-8'))
    expect(content).toBe('init\n')
  })

  it('commit 返回 sha', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    const { sha } = await gitService.commit(repo, 'add a')
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/)
    const log = await exec('git', ['log', '--oneline', '-1'], { cwd: repo })
    expect(log.stdout).toContain('add a')
  })

  it('commit 空消息多行用多个 -m', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    await gitService.commit(repo, '标题\n\n正文详情')
    const log = await exec('git', ['log', '-1', '--format=%B'], { cwd: repo })
    expect(log.stdout).toContain('标题')
    expect(log.stdout).toContain('正文详情')
  })

  it('无暂存改动 commit 抛 NOTHING_TO_COMMIT', async () => {
    await expect(gitService.commit(repo, 'noop')).rejects.toMatchObject({ code: 'NOTHING_TO_COMMIT' })
  })

  it('resetHard 丢弃所有改动', async () => {
    await writeFile(join(repo, 'README.md'), 'dirty\n')
    await writeFile(join(repo, 'b.txt'), 'new\n')
    await gitService.resetHard(repo)
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(st.stdout.trim()).toBe('')
  })

  it('路径越界拒绝', async () => {
    await expect(gitService.add(repo, ['../../../etc/passwd'])).rejects.toMatchObject({ code: 'GIT_ERROR' })
  })

  it('commit message 不触发 shell 注入（含特殊字符）', async () => {
    await writeFile(join(repo, 'a.txt'), 'x\n')
    await gitService.add(repo, ['a.txt'])
    await gitService.commit(repo, 'feat: `rm -rf /` & $(whoami)')
    const log = await exec('git', ['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('feat: `rm -rf /` & $(whoami)')
  })

  it('同 cwd 写操作串行（不交叉）', async () => {
    // 并发发起 3 个 add，最终都应成功且无脏数据
    await writeFile(join(repo, 'a.txt'), '1\n')
    await writeFile(join(repo, 'b.txt'), '2\n')
    await writeFile(join(repo, 'c.txt'), '3\n')
    await Promise.all([
      gitService.add(repo, ['a.txt']),
      gitService.add(repo, ['b.txt']),
      gitService.add(repo, ['c.txt']),
    ])
    const st = await exec('git', ['status', '--porcelain'], { cwd: repo })
    const lines = st.stdout.trim().split('\n').sort()
    expect(lines).toEqual(['A  a.txt', 'A  b.txt', 'A  c.txt'])
  })
})
