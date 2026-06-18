import { describe, it, expect } from 'vitest'
import { BUILTIN_COMMANDS, PERMISSION_MODE_MAP, getPermissionMode } from '../src/main/builtin-commands'

describe('BUILTIN_COMMANDS', () => {
  it('包含 17 条命令，每条有 id/name/desc/builtinAction', () => {
    expect(BUILTIN_COMMANDS).toHaveLength(17)
    for (const c of BUILTIN_COMMANDS) {
      expect(c.kind).toBe('builtin')
      expect(c.id).toBeTruthy()
      expect(c.name).toMatch(/^\//)
      expect(c.desc).toBeTruthy()
      expect(c.builtinAction).toBeDefined()
      expect(c.builtinAction!.type).toBeTruthy()
    }
  })
  it('name 全部唯一', () => {
    const names = BUILTIN_COMMANDS.map(c => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
  it('id 全部唯一', () => {
    const ids = BUILTIN_COMMANDS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('PERMISSION_MODE_MAP', () => {
  it('四个中文标签映射到合法 SDK permissionMode', () => {
    expect(PERMISSION_MODE_MAP['变更前确认']).toBe('default')
    expect(PERMISSION_MODE_MAP['自动编辑']).toBe('acceptEdits')
    expect(PERMISSION_MODE_MAP['计划模式']).toBe('plan')
    expect(PERMISSION_MODE_MAP['完全访问']).toBe('bypassPermissions')
  })
  it('getPermissionMode 未知值/空/null 回退 default', () => {
    expect(getPermissionMode('不存在的')).toBe('default')
    expect(getPermissionMode(undefined)).toBe('default')
    expect(getPermissionMode('')).toBe('default')
    expect(getPermissionMode(null as any)).toBe('default')
  })
})
