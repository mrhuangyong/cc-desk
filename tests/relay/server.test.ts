// tests/relay/server.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { startRelayServer } from '../../relay/server'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'

let servers: Array<{ close(): Promise<void> }> = []
afterEach(async () => { await Promise.all(servers.map(s => s.close())); servers = [] })

async function connect(port: number, path: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    ws.on('open', () => resolve(ws))
  })
}

describe('relay server 集成', () => {
  it('配对码流程：桌面 issue → 手机 consume → 双向绑定建立', async () => {
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const s = await startRelayServer({ port: 0, dataDir })
    servers.push(s)
    const port = s.port!
    const key = 'dGVzdA=='
    // issue code（HTTP 或 ws，这里用 ws /pair）
    const wsD = await connect(port, '/pair')
    wsD.send(JSON.stringify({ type: 'pair.code', deviceId: 'D', deviceKey: key }))
    const codeMsg: any = await new Promise(r => wsD.once('message', d => r(JSON.parse(d.toString()))))
    expect(codeMsg.type).toBe('pair.code')
    const code = codeMsg.payload.code
    // 手机 consume
    const wsM = await connect(port, '/pair')
    wsM.send(JSON.stringify({ type: 'pair.consume', deviceId: 'M', code }))
    const okMsg: any = await new Promise(r => wsM.once('message', d => r(JSON.parse(d.toString()))))
    expect(okMsg.type).toBe('pair.success')
    wsD.close(); wsM.close()
    await rm(dataDir, { recursive: true, force: true })
  })
})
