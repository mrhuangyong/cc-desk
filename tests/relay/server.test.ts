// tests/relay/server.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { startRelayServer } from '../../relay/server'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir as tmpdirPath } from 'os'
import { connect as netConnect } from 'net'
import { makeEnvelope } from '../../src/shared/remote-protocol'

let servers: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(servers.map(s => s.close()))
  servers = []
}, 20000)

async function connect(port: number, path: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    ws.on('open', () => resolve(ws))
  })
}

/** 等待下一条 ws 消息并解析为对象。 */
function nextMsg(ws: WebSocket): Promise<any> {
  return new Promise((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))))
}

/**
 * 用 raw TCP socket 发送一条手工拼出的 HTTP 请求行。
 * 为什么不用 fetch / http.request：它们会在客户端规范化 URL（把 /../ 折叠成 /），
 * 无法把真实的穿越路径 .. 送到服务端。raw socket 直接写字节，还原真实攻击向量。
 * 返回 { status, body }。
 */
function rawHttp(port: number, requestLine: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ port, host: '127.0.0.1' })
    const chunks: Buffer[] = []
    sock.on('connect', () => sock.write(`${requestLine}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`))
    sock.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
    sock.on('error', reject)
    sock.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf-8')
      const m = text.match(/^HTTP\/[\d.]+\s+(\d+)/)
      const status = m ? Number(m[1]) : 0
      const body = text.split('\r\n\r\n').slice(1).join('\r\n\r\n')
      resolve({ status, body })
    })
  })
}

/** 走完整配对流程，建立 D↔M 绑定，并登记双方密钥。返回双方 deviceKey。 */
async function pair(port: number, desktopKey: string, mobileKey: string): Promise<void> {
  const wsD = await connect(port, '/pair')
  wsD.send(JSON.stringify({ type: 'pair.code', deviceId: 'D', deviceKey: desktopKey }))
  const codeMsg: any = await nextMsg(wsD)
  const code = codeMsg.payload.code
  const wsM = await connect(port, '/pair')
  wsM.send(JSON.stringify({ type: 'pair.consume', deviceId: 'M', deviceKey: mobileKey, code }))
  await nextMsg(wsM) // pair.success
  wsD.close(); wsM.close()
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
    // 手机 consume（向后兼容：无 deviceKey 也能 consume，只是中继拿不到 mobile 密钥）
    const wsM = await connect(port, '/pair')
    wsM.send(JSON.stringify({ type: 'pair.consume', deviceId: 'M', code }))
    const okMsg: any = await new Promise(r => wsM.once('message', d => r(JSON.parse(d.toString()))))
    expect(okMsg.type).toBe('pair.success')
    wsD.close(); wsM.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('bind 握手：用正确 deviceKey 签名的 bind 消息通过验签，返回 bind.ok', async () => {
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const s = await startRelayServer({ port: 0, dataDir })
    servers.push(s)
    const port = s.port!
    const desktopKey = 'ZGVza3RvcC1rZXk='
    const mobileKey = 'bW9iaWxlLWtleQ=='
    await pair(port, desktopKey, mobileKey)

    // 手机用自己登记过的 mobileKey 签名 bind 信封
    const ws = await connect(port, '/ws')
    const env = makeEnvelope(mobileKey, 'bind', 'M', { desktopId: 'D' })
    ws.send(JSON.stringify(env))
    const msg: any = await nextMsg(ws)
    expect(msg.type).toBe('bind.ok')
    await rm(dataDir, { recursive: true, force: true })
  })

  it('bind 握手：用错误密钥签名应被拒（验签失败，返回 error bad_sig）', async () => {
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const s = await startRelayServer({ port: 0, dataDir })
    servers.push(s)
    const port = s.port!
    const desktopKey = 'ZGVza3RvcC1rZXk='
    const mobileKey = 'bW9iaWxlLWtleQ=='
    await pair(port, desktopKey, mobileKey)

    const ws = await connect(port, '/ws')
    // 用一个错误密钥签名（keyRegistry 里 M 的密钥是 mobileKey）
    const wrongKey = 'd3Jvbmcta2V5'
    const env = makeEnvelope(wrongKey, 'bind', 'M', { desktopId: 'D' })
    ws.send(JSON.stringify(env))
    const msg: any = await nextMsg(ws)
    expect(msg.type).toBe('error')
    expect(msg.payload?.code).toBe('bad_sig')
    await rm(dataDir, { recursive: true, force: true })
  })

  it('bind 握手：未在 keyRegistry 登记的 deviceId 应被拒', async () => {
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const s = await startRelayServer({ port: 0, dataDir })
    servers.push(s)
    const port = s.port!
    // 不走配对，直接伪造一个未登记 deviceId 的 bind
    const ws = await connect(port, '/ws')
    const env = makeEnvelope('YXNkZg==', 'bind', 'UNKNOWN', { desktopId: 'D' })
    ws.send(JSON.stringify(env))
    const msg: any = await nextMsg(ws)
    // 未绑定 → unbound；或密钥未登记 → bad_sig；总之不能是 bind.ok
    expect(msg.type).toBe('error')
    expect(['unbound', 'bad_sig']).toContain(msg.payload?.code)
    await rm(dataDir, { recursive: true, force: true })
  })

  it('静态文件 .. 路径穿越返回 403/404，不读到外部文件', async () => {
    const staticDir = await mkdtemp(join(tmpdirPath(), 'relay-static-'))
    await mkdir(join(staticDir, 'pwa'))
    await writeFile(join(staticDir, 'index.html'), '<html>pwa</html>')
    await writeFile(join(staticDir, 'pwa', 'app.html'), '<html>app</html>')
    // 在 staticDir 的父目录放一个 secret，验证穿越读不到
    const secretPath = join(staticDir, '..', 'relay-secret.txt')
    await writeFile(secretPath, 'TOPSECRET')
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const s = await startRelayServer({ port: 0, dataDir, staticDir })
    servers.push(s)
    const port = s.port!

    const res1 = await rawHttp(port, 'GET /../relay-secret.txt HTTP/1.1')
    expect([403, 404]).toContain(res1.status)
    expect(res1.body).not.toContain('TOPSECRET')

    // /pwa/../../relay-secret.txt 规范化后为 /../relay-secret.txt，逃出 staticDir
    const res2 = await rawHttp(port, 'GET /pwa/../../relay-secret.txt HTTP/1.1')
    expect([403, 404]).toContain(res2.status)
    expect(res2.body).not.toContain('TOPSECRET')

    await rm(dataDir, { recursive: true, force: true })
    await rm(staticDir, { recursive: true, force: true })
    await rm(secretPath, { force: true })
  })
})
