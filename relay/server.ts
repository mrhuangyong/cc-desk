// relay/server.ts
// 中继服务入口：HTTP（托管 PWA 静态资源）+ WebSocket（/pair 配对、/ws 转发）。
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { createBindingStore } from './binding-store'
import { createPairingStore } from './pairing'
import { createRouter } from './router'
import type { Envelope } from '../src/shared/remote-protocol'

export interface RelayHandle {
  close(): Promise<void>
  port?: number
}

export async function startRelayServer(opts: {
  port: number
  dataDir: string
  staticDir?: string
}): Promise<RelayHandle> {
  const bindings = createBindingStore(join(opts.dataDir, 'bindings.json'))
  // 已知项（Task 3 遗留）：createPairingStore.consume 内部用
  // `void bindings.addBinding(...)` fire-and-forget 落盘，失败被静默吞掉，
  // server 层无法外部 catch（promise 不外露）。需 Task 3 自身改成可观测。
  const pairing = createPairingStore(bindings)
  // deviceKey 注册表：bind 握手时上报，供 router 验签。
  const keyRegistry = new Map<string, string>()
  const router = createRouter(bindings, (id) => keyRegistry.get(id))

  const httpServer = createServer((req, res) => {
    // 托管 PWA 静态资源（v1：单页，SPA fallback 到 index.html）
    void (async () => {
      if (!opts.staticDir) { res.writeHead(404); res.end(); return }
      try {
        const file = req.url === '/' ? '/index.html' : req.url
        const data = await readFile(join(opts.staticDir, file!))
        res.writeHead(200)
        res.end(data)
      } catch {
        // SPA fallback
        try {
          const index = await readFile(join(opts.staticDir, 'index.html'))
          res.writeHead(200); res.end(index)
        } catch {
          res.writeHead(404); res.end('not found')
        }
      }
    })()
  })

  // 用 noServer 模式：多个 WebSocketServer 共享同一个 httpServer 时，
  // 必须手动按路径分发 upgrade，否则每个 wss 都会注册 'upgrade' 监听器，
  // 路径不匹配的 wss 也会错误接管连接，导致 "RSV1 must be clear" 等帧解析错误。
  const pairWss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  const wsWss = new WebSocketServer({ noServer: true, perMessageDeflate: false })

  httpServer.on('upgrade', (req, socket, head) => {
    const { url } = req
    if (url === '/pair') pairWss.handleUpgrade(req, socket, head, (ws) => pairWss.emit('connection', ws, req))
    else if (url === '/ws') wsWss.handleUpgrade(req, socket, head, (ws) => wsWss.emit('connection', ws, req))
    else socket.destroy()
  })

  pairWss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === 'pair.code' && msg.deviceId && msg.deviceKey) {
        const { code, expiresAt } = pairing.issueCode(msg.deviceId)
        keyRegistry.set(msg.deviceId, msg.deviceKey) // 记下桌面密钥
        ws.send(JSON.stringify({ type: 'pair.code', payload: { code, expiresAt } }))
      } else if (msg.type === 'pair.consume' && msg.deviceId && msg.code) {
        const r = pairing.consume(msg.code, msg.deviceId)
        if (r) {
          const desktopKey = keyRegistry.get(r.desktopId)
          ws.send(JSON.stringify({
            type: 'pair.success',
            payload: { desktopId: r.desktopId, deviceKey: desktopKey }, // 下发桌面密钥给手机（全程 TLS）
          }))
        } else {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_pair_code' } }))
        }
      }
    })
  })

  wsWss.on('connection', (ws) => {
    let boundDeviceId: string | null = null
    ws.on('message', (raw) => {
      let env: Envelope
      try { env = JSON.parse(raw.toString()) } catch { return }
      // bind 握手：第一条消息，上报 deviceId + deviceKey
      if (env.type === 'bind' && !boundDeviceId) {
        if (!bindings.has(env.deviceId)) { ws.send(JSON.stringify({ type: 'error', payload: { code: 'unbound' } })); return }
        keyRegistry.set(env.deviceId, (env as any).payload?.deviceKey)
        boundDeviceId = env.deviceId
        router.register(env.deviceId, (e) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(e)))
        ws.send(JSON.stringify({ type: 'bind.ok' }))
        return
      }
      if (!boundDeviceId) return // 未 bind 拒收
      router.route(env) // 转发或拒绝
    })
    ws.on('close', () => { if (boundDeviceId) router.unregister(boundDeviceId) })
  })

  return new Promise((resolve) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolve({
        port,
        close: () => new Promise<void>((res) => {
          pairWss.close(); wsWss.close(); httpServer.close(() => res())
        }),
      })
    })
  })
}
