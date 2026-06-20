import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock 掉 shell-env，避免真跑 login shell（不稳定且污染）。
vi.mock('shell-env', () => ({
  shellEnvSync: vi.fn(),
}))

import { shellEnvSync } from 'shell-env'
import { mergePath, fixEnvSync } from '../src/main/fix-env'

const mockedShellEnvSync = vi.mocked(shellEnvSync)

describe('mergePath', () => {
  it('primary 优先出现，fallback 去重后兜底追加', () => {
    const r = mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/bin')
    expect(r).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })

  it('primary 缺省时只返回 fallback', () => {
    expect(mergePath(undefined, '/usr/bin:/bin')).toBe('/usr/bin:/bin')
  })

  it('两者都缺省返回空串', () => {
    expect(mergePath(undefined, undefined)).toBe('')
  })

  it('跨 primary/fallback 去重', () => {
    const r = mergePath('/a:/b:/c', '/b:/d')
    expect(r).toBe('/a:/b:/c:/d')
  })

  it('忽略空段', () => {
    expect(mergePath(':/a::', '/b')).toBe('/a:/b')
  })
})

describe('fixEnvSync', () => {
  const savedPath = process.env.PATH
  const savedFoo = process.env.MY_FIXENV_TEST_VAR

  beforeEach(() => {
    mockedShellEnvSync.mockReset()
    process.env.PATH = '/usr/bin:/bin'
    delete process.env.MY_FIXENV_TEST_VAR
  })

  afterEach(() => {
    process.env.PATH = savedPath
    if (savedFoo === undefined) delete process.env.MY_FIXENV_TEST_VAR
    else process.env.MY_FIXENV_TEST_VAR = savedFoo
  })

  it('把 shell 环境合并进 process.env，PATH 去重且 shell 优先', () => {
    mockedShellEnvSync.mockReturnValue({
      PATH: '/opt/homebrew/bin:/Users/x/.nvm/versions/node/v22/bin:/usr/bin',
      MY_FIXENV_TEST_VAR: 'bar',
      SHELL: '/bin/zsh',
    })

    fixEnvSync()

    expect(process.env.PATH).toBe(
      '/opt/homebrew/bin:/Users/x/.nvm/versions/node/v22/bin:/usr/bin:/bin',
    )
    expect(process.env.MY_FIXENV_TEST_VAR).toBe('bar')
    expect(process.env.SHELL).toBe('/bin/zsh')
  })

  it('shellEnvSync 抛错时静默回退，process.env 不变且不抛', () => {
    mockedShellEnvSync.mockImplementation(() => {
      throw new Error('spawn ENOENT')
    })
    expect(() => fixEnvSync()).not.toThrow()
    expect(process.env.PATH).toBe('/usr/bin:/bin')
    expect(process.env.MY_FIXENV_TEST_VAR).toBeUndefined()
  })

  it('shellEnvSync 返回空对象时 PATH 回退为原值', () => {
    mockedShellEnvSync.mockReturnValue({} as Record<string, string>)
    fixEnvSync()
    expect(process.env.PATH).toBe('/usr/bin:/bin')
  })
})
