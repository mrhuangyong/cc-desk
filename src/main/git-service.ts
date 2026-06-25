// src/main/git-service.ts
// 纯 git 操作层：封装 git status/diff/写操作，execFileAsync 调真实 git 二进制。
// 不依赖 Electron（纯 Node），方便单测。cwd 始终是激活项目路径。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { relative, resolve, sep } from 'node:path'

const execFileAsync = promisify(execFile)

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
export type DiffScope = 'HEAD' | 'cached' | 'workdir'

export interface GitFileStatus {
  path: string
  indexStatus: GitChangeKind | null
  workdirStatus: GitChangeKind | null
}

export type GitErrorCode = 'NOT_A_REPO' | 'GIT_NOT_FOUND' | 'CONFLICT' | 'AUTH_FAILED' | 'NOTHING_TO_COMMIT' | 'GIT_ERROR'

export class GitServiceError extends Error {
  code: GitErrorCode
  stderr: string
  constructor(code: GitErrorCode, message: string, stderr = '') {
    super(message)
    this.name = 'GitServiceError'
    this.code = code
    this.stderr = stderr
  }
}

// 统一 git 命令执行：固定 env、超时、maxBuffer；非零退出码归一化为 GitServiceError。
async function git(cwd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (err: any) {
    const stderr: string = err.stderr ?? ''
    const msg: string = err.message ?? String(err)
    // git 二进制不存在（打包版 PATH 坑）
    if (err.code === 'ENOENT') throw new GitServiceError('GIT_NOT_FOUND', '未找到 git，请检查 PATH', stderr)
    // 非 git 仓库
    if (/not a git repository|did not match any file/i.test(stderr)) {
      throw new GitServiceError('NOT_A_REPO', '当前项目不是 git 仓库', stderr)
    }
    // 冲突
    if (/CONFLICT|merge conflict/i.test(stderr)) throw new GitServiceError('CONFLICT', '存在合并冲突', stderr)
    // 凭证失败
    if (/Authentication failed|could not read Username|403|Forbidden/i.test(stderr)) {
      throw new GitServiceError('AUTH_FAILED', '远程凭证失败', stderr)
    }
    // 无可提交
    if (/nothing to commit|no changes added/i.test(stderr)) {
      throw new GitServiceError('NOTHING_TO_COMMIT', '没有可提交的改动', stderr)
    }
    throw new GitServiceError('GIT_ERROR', msg, stderr)
  }
}

// --porcelain v1 -z 单字符状态码 → GitChangeKind
function mapStatusCode(c: string): GitChangeKind | null {
  switch (c) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'renamed'   // copy 归入 renamed（都涉及原路径，UI 同色）
    case '?': return 'untracked'
    case '!': return null         // ignored，不展示
    case 'U': return 'conflicted'
    default: return c === ' ' ? null : 'modified'
  }
}

export async function status(cwd: string): Promise<GitFileStatus[]> {
  // 先确认是 git 仓库（空目录 status 不报错但返回空，会误判 NOT_A_REPO；用 rev-parse 兜底）
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new GitServiceError('NOT_A_REPO', '当前项目不是 git 仓库')
  }
  const out = await git(cwd, ['status', '--porcelain=v1', '-z'])
  if (!out) return []
  // -z：每条以 NUL 分隔。XY 两字符 + 空格 + path，重命名/复制是 path1 NUL path2
  const tokens = out.split('\0').filter(t => t !== '')
  const result: GitFileStatus[] = []
  for (const tok of tokens) {
    if (tok.length < 3) continue
    const x = tok[0]
    const y = tok[1]
    const rest = tok.slice(3)
    // 处理 rename：rest 是 "old -> new"（porcelain 用 -> 分隔），取 new
    const filePath = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest
    result.push({
      path: filePath,
      indexStatus: mapStatusCode(x),
      workdirStatus: mapStatusCode(y),
    })
  }
  return result
}

export async function diff(cwd: string, scope: DiffScope, filePath?: string): Promise<string> {
  const args = ['diff']
  if (scope === 'HEAD') args.push('HEAD')
  else if (scope === 'cached') args.push('--cached')
  // workdir: 不加额外 flag
  if (filePath) {
    args.push('--')
    args.push(filePath)
  }
  // diff 对无改动文件返回空串、退出码 0，不抛错
  return git(cwd, args)
}

// 供主进程其他模块校验 paths 用（Task 2 写操作依赖）
export function assertPathsInside(cwd: string, paths: string[]): void {
  for (const p of paths) {
    const abs = resolve(cwd, p)
    const rel = relative(cwd, abs)
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
      throw new GitServiceError('GIT_ERROR', `路径越界: ${p}`)
    }
  }
}
