// bump-version.mjs 版本推断纯函数测试。
// 覆盖 Conventional Commits 三种级别、混合提交取最高、非法版本号兜底。
import { describe, it, expect } from 'vitest'

// bump-version.mjs 是 ESM 脚本（tsconfig 不含 scripts/，无类型）；vitest 经 vite 处理 .mjs，静态 import 即可。
// @ts-expect-error mjs 无类型声明——运行时由 vite 解析，仅抑制 tsc 的类型查找报错。
import { determineBumpLevel, bumpVersion } from '../scripts/bump-version.mjs'

describe('determineBumpLevel（Conventional Commits 级别推断）', () => {
  it('feat! 语法触发 major', () => {
    expect(determineBumpLevel(['feat!: drop legacy api'])).toBe('major')
    expect(determineBumpLevel(['refactor!: rewrite core'])).toBe('major')
  })

  it('BREAKING CHANGE 正文触发 major', () => {
    expect(determineBumpLevel(['fix: a\n\nBREAKING CHANGE: removed'])).toBe('major')
    expect(determineBumpLevel(['fix: a\n\nBREAKING-CHANGE: removed'])).toBe('major')
  })

  it('feat 触发 minor', () => {
    expect(determineBumpLevel(['feat: add shortcuts'])).toBe('minor')
    expect(determineBumpLevel(['feature: add shortcuts'])).toBe('minor')
  })

  it('fix/perf/chore 等 触发 patch', () => {
    expect(determineBumpLevel(['fix: crash'])).toBe('patch')
    expect(determineBumpLevel(['perf: speed up'])).toBe('patch')
    expect(determineBumpLevel(['chore: deps'])).toBe('patch')
  })

  it('无规范提交默认 patch', () => {
    expect(determineBumpLevel(['just a message'])).toBe('patch')
  })

  it('多条混合提交取最高级别（major 优先）', () => {
    expect(determineBumpLevel(['feat: a', 'fix: b', 'feat!: c'])).toBe('major')
  })

  it('feat 与 fix 混合取 minor', () => {
    expect(determineBumpLevel(['fix: a', 'feat: b'])).toBe('minor')
  })
})

describe('bumpVersion（版本号计算）', () => {
  it('patch 递增', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
  })

  it('minor 递增并清零 patch', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
  })

  it('major 递增并清零 minor/patch', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('容忍首尾空格', () => {
    expect(bumpVersion('  1.0.0  ', 'patch')).toBe('1.0.1')
  })

  it('非法版本号抛错', () => {
    expect(() => bumpVersion('1.2', 'patch')).toThrow()
    expect(() => bumpVersion('v1.2.3', 'patch')).toThrow()
  })
})
