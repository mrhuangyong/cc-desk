// tests/relay/server.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { startRelayServer } from '../../relay/server'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises'
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
/** 走 raw TCP socket 发手工 HTTP 请求行，返回 status、headers、body。
 *  与 rawHttp 同源（避开 fetch 对 URL 的规范化），但额外解析响应头，
 *  用于 MIME 校验等需要读 Content-Type 的场景。 */
function rawHttpFull(port: number, requestLine: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
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
      const headBody = text.split('\r\n\r\n')
      const head = headBody[0] ?? ''
      const body = headBody.slice(1).join('\r\n\r\n')
      const headers: Record<string, string> = {}
      for (const line of head.split('\r\n').slice(1)) { // 跳过状态行
        const idx = line.indexOf(':')
        if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
      }
      resolve({ status, headers, body })
    })
  })
}

function rawHttp(port: number, requestLine: string): Promise<{ status: number; body: string }> {
  return rawHttpFull(port, requestLine).then(({ status, body }) => ({ status, body }))
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

  it('Important-3：中继重启后 keyRegistry 从盘恢复，已配对设备仍能 bind（不须重新配对）', async () => {
    // 原 keyRegistry 是纯内存 Map，中继重启后密钥全丢，已配对设备 bind 必 bad_sig、永久失联。
    // 持久化到 dataDir/keys.json 后，重启读盘恢复，bind 验签仍能通过。
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const desktopKey = 'ZGVza3RvcC1rZXk='
    const mobileKey = 'bW9iaWxlLWtleQ=='

    // 第一段：起中继，走完整配对（登记双方密钥 + 落 binding），然后关闭
    let s = await startRelayServer({ port: 0, dataDir })
    servers.push(s)
    const port1 = s.port!
    await pair(port1, desktopKey, mobileKey)
    // 等 pairing.consume 的 fire-and-forget 落盘（bindings + keys）完成
    await new Promise(r => setTimeout(r, 150))
    await s.close()
    servers = servers.filter(x => x !== s)

    // 断言 keys.json 确实落盘（不信任实现，验证契约）
    const keysRaw = await readFile(join(dataDir, 'keys.json'), 'utf-8')
    const keys = JSON.parse(keysRaw)
    expect(keys.D).toBe(desktopKey)
    expect(keys.M).toBe(mobileKey)

    // 第二段：同 dataDir 重启中继（新端口），用旧密钥 bind 应成功
    s = await startRelayServer({ port: 0, dataDir })
    servers.push(s)
    const port2 = s.port!
    const ws = await connect(port2, '/ws')
    const env = makeEnvelope(mobileKey, 'bind', 'M', { desktopId: 'D' })
    ws.send(JSON.stringify(env))
    const msg: any = await nextMsg(ws)
    expect(msg.type).toBe('bind.ok') // 关键：重启后密钥仍在，验签通过
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

  it('Task 15 MIME：静态资源按扩展名返回正确 Content-Type（sw.js / manifest / 未知）', async () => {
    // 回归：浏览器对 Service Worker 注册有严格 MIME 校验——
    // /sw.js 必须以 text/javascript 返回，否则 navigator.serviceWorker.register 失败；
    // /manifest.webmanifest 必须是 application/manifest+json；未知扩展名回落 octet-stream。
    // 之前 res.writeHead(200) 不带 headers，依赖浏览器嗅探，SW/manifest 无法可靠注册。
    const staticDir = await mkdtemp(join(tmpdirPath(), 'relay-mime-'))
    await writeFile(join(staticDir, 'sw.js'), "self.addEventListener('install',()=>{})")
    await writeFile(join(staticDir, 'manifest.webmanifest'), '{}')
    await writeFile(join(staticDir, 'foo.xyz'), 'binary-ish')
    // index.html 兜底，避免 SPA fallback 干扰
    await writeFile(join(staticDir, 'index.html'), '<html></html>')
    const dataDir = join(tmpdir(), `relay-${Math.random().toString(36).slice(2)}`)
    const s = await startRelayServer({ port: 0, dataDir, staticDir })
    servers.push(s)
    const port = s.port!

    const sw = await rawHttpFull(port, 'GET /sw.js HTTP/1.1')
    expect(sw.status).toBe(200)
    expect(sw.headers['content-type']).toContain('text/javascript')

    const manifest = await rawHttpFull(port, 'GET /manifest.webmanifest HTTP/1.1')
    expect(manifest.status).toBe(200)
    expect(manifest.headers['content-type']).toContain('application/manifest+json')

    const unknown = await rawHttpFull(port, 'GET /foo.xyz HTTP/1.1')
    expect(unknown.status).toBe(200)
    expect(unknown.headers['content-type']).toBe('application/octet-stream')

    await rm(dataDir, { recursive: true, force: true })
    await rm(staticDir, { recursive: true, force: true })
  })
})
