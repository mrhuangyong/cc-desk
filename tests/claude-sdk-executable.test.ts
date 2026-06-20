import { describe, expect, it } from 'vitest'
import { join } from 'path'

describe('Claude SDK 原生二进制路径解析', () => {
  it('打包态 app.asar 内路径必须改写到 app.asar.unpacked，供 spawn 真实执行', async () => {
    const { toAsarUnpackedPath } = await import('../src/main/claude-sdk-executable')
    const packed = join('/Applications/cc-desk.app/Contents/Resources', 'app.asar', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude')

    expect(toAsarUnpackedPath(packed)).toBe(
      join('/Applications/cc-desk.app/Contents/Resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude'),
    )
  })

  it('开发态普通 node_modules 路径保持不变', async () => {
    const { toAsarUnpackedPath } = await import('../src/main/claude-sdk-executable')
    const devPath = join('/repo', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude')

    expect(toAsarUnpackedPath(devPath)).toBe(devPath)
  })
})
