#!/usr/bin/env node
// 版本号推断：基于上一个 git tag 与自其以来的提交信息，用 Conventional Commits 规范推断下一版本号。
// 纯逻辑模块，既可被 GitHub Actions 调用（CLI），也可被单测直接 import。
//
// 规则：
//   - 含 BREAKING CHANGE（footer 或 !）或类型为 major 显式 → major
//   - 含 feat → minor
//   - 其余（fix/perf/...）或无规范提交 → patch
//   - 无历史 tag 时，从 package.json 的 version 作为基线（默认 1.0.0）
// 语义化版本号格式：MAJOR.MINOR.PATCH

// ---- 纯函数（供测试 import）----

// 从 commit 标题/正文判定本次变更级别：major | minor | patch
export function determineBumpLevel(commits) {
  for (const msg of commits) {
    const firstLine = msg.split('\n')[0]
    // 1) 破坏性变更：标题 type 后带 `!`（如 `feat!:`、`refactor!:`），或正文含 `BREAKING CHANGE:`
    if (firstLine.includes('!:') || /BREAKING[ -]CHANGE/i.test(msg)) return 'major'
  }
  for (const msg of commits) {
    const firstLine = msg.split('\n')[0]
    // 2) 特性 → minor
    if (/^\s*(feat|feature)\b/i.test(firstLine)) return 'minor'
  }
  // 3) 其余一律 patch（fix/perf/chore 等，甚至无规范提交）
  return 'patch'
}

// 在基线版本上应用 bump 级别，返回新版本号字符串
export function bumpVersion(baseVersion, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(baseVersion.trim())
  if (!m) throw new Error(`非法版本号: ${baseVersion}（应为 x.y.z）`)
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (level === 'major') { major += 1; minor = 0; patch = 0 }
  else if (level === 'minor') { minor += 1; patch = 0 }
  else { patch += 1 }
  return `${major}.${minor}.${patch}`
}

// ---- CLI 入口（GitHub Actions 调用）----
// 输出 JSON 到 stdout：{ from, to, level, commits }，供 workflow 读取。
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

function main() {
  // 读取 package.json 当前版本作为基线（无历史 tag 时从这里起步）
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const currentVersion = pkg.version

  // 找最近一个版本 tag（v 开头的语义化版本，如 v1.2.3）
  let lastTag = ''
  try {
    lastTag = run('git describe --tags --abbrev=0 --match "v[0-9]*" 2>/dev/null || true')
  } catch { lastTag = '' }

  // 收集自上一 tag 以来的提交信息；无 tag 则取最近 1 条保证至少有一次 patch 递增
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD~1..HEAD'
  let commits = []
  try {
    commits = run(`git log --pretty=format:"%B" --no-merges ${range}`)
      .split('\n\n')
      .map(s => s.trim())
      .filter(Boolean)
  } catch { commits = [] }
  // 无提交（如新仓库首次）兜底：至少产生一次 patch
  if (commits.length === 0) commits = ['chore: initial release']

  // 基线版本：有 tag 则取 tag 去掉 v 前缀，否则用 package.json 版本
  const baseVersion = lastTag ? lastTag.replace(/^v/, '') : currentVersion

  const level = determineBumpLevel(commits)
  const to = bumpVersion(baseVersion, level)

  // 输出 JSON 供 workflow 解析；同时设置 step output
  const result = { from: baseVersion, to, level, lastTag, commits: commits.length }
  process.stdout.write(JSON.stringify(result))
}

// 直接运行时执行 CLI；被 import 时不执行（仅暴露纯函数）
const isDirectRun = process.argv[1] && process.argv[1].endsWith('bump-version.mjs')
if (isDirectRun) main()
