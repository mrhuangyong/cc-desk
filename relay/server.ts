// relay/server.ts
// 中继服务入口：HTTP（托管 PWA 静态资源）+ WebSocket（/pair 配对、/ws 转发）。
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { join, resolve as pathResolve } from 'path'
import { readFile } from 'fs/promises'
import { createBindingStore } from './binding-store'
import { createPairingStore } from './pairing'
import { createRouter } from './router'
import { verifySig, type Envelope } from '../src/shared/remote-protocol'

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
  // deviceKey 注册表：密钥的唯一信任入口是配对流程。
  //   - pair.code：桌面带 deviceKey 来，首次登记（已存在不覆盖，防重放覆盖）。
  //   - pair.consume：手机带 deviceKey 来，配对成功（信任点）时首次登记。
  //   - bind 握手：不再信任/登记上报的密钥，只用 keyRegistry 已有密钥验签身份。
  const keyRegistry = new Map<string, string>()
  /** 首次登记语义：仅当该 deviceId 尚无密钥时写入，已存在则保持原值（信任首次）。 */
  const registerKey = (deviceId: string, key: string | undefined) => {
    if (key && !keyRegistry.has(deviceId)) keyRegistry.set(deviceId, key)
  }
  const router = createRouter(bindings, (id) => keyRegistry.get(id))

  const httpServer = createServer((req, res) => {
    // 托管 PWA 静态资源（v1：单页，SPA fallback 到 index.html）
    void (async () => {
      if (!opts.staticDir) { res.writeHead(404); res.end(); return }
      // 路径穿越防护：解析绝对路径后必须仍在 staticDir 内，
      // 否则 /../etc/passwd 之类可越权读外部文件。
      const staticRoot = pathResolve(opts.staticDir)
      const reqUrl = (req.url ?? '/').split('?')[0]
      const file = reqUrl === '/' ? '/index.html' : reqUrl
      const abs = pathResolve(staticRoot, '.' + file!) // '.' 前缀保证相对 staticRoot
      const isSafe = abs === staticRoot || abs.startsWith(staticRoot + '/')
      if (!isSafe) { res.writeHead(403); res.end('forbidden'); return }
      try {
        const data = await readFile(abs)
        res.writeHead(200)
        res.end(data)
      } catch {
        // SPA fallback（fallback 目标同样在 staticDir 内，天然安全）
        try {
          const index = await readFile(join(staticRoot, 'index.html'))
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
        registerKey(msg.deviceId, msg.deviceKey) // 首次登记桌面密钥（已存在不覆盖）
        ws.send(JSON.stringify({ type: 'pair.code', payload: { code, expiresAt } }))
      } else if (msg.type === 'pair.consume' && msg.deviceId && msg.code) {
        const r = pairing.consume(msg.code, msg.deviceId)
        if (r) {
          // 配对成功是手机端的信任确认点：登记手机密钥（首次，不覆盖）。
          registerKey(msg.deviceId, msg.deviceKey)
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
      // bind 握手：第一条消息。
      //   安全要点：bind 不再信任/登记客户端上报的 deviceKey。
      //   身份证明 = 用 keyRegistry 里配对阶段已登记的密钥，验签这条 bind 信封本身。
      //   - 未绑定 → unbound
      //   - 密钥未登记（理论上不该发生，除非中继重启丢内存态）→ bad_sig
      //   - 验签失败 → bad_sig
      if (env.type === 'bind' && !boundDeviceId) {
        if (!bindings.has(env.deviceId)) { ws.send(JSON.stringify({ type: 'error', payload: { code: 'unbound' } })); return }
        const key = keyRegistry.get(env.deviceId)
        if (!key || !verifySig(key, env)) { ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_sig' } })); return }
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
          // 主动关闭所有已建立的 ws 连接，避免 httpServer.close 等待 keep-alive 卡死。
          for (const c of pairWss.clients) c.terminate()
          for (const c of wsWss.clients) c.terminate()
          pairWss.close(); wsWss.close(); httpServer.close(() => res())
        }),
      })
    })
  })
}
