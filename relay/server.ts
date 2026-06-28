// relay/server.ts
// 中继服务入口：HTTP（托管 PWA 静态资源）+ WebSocket（/pair 配对、/ws 转发）。
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { join, resolve as pathResolve } from 'path'
import { readFile } from 'fs/promises'
import { createBindingStore } from './binding-store'
import { createKeyStore } from './key-store'
import { createPairingStore } from './pairing'
import { createRouter } from './router'
import { createTokenStore } from './token-store'
import { verifySig, type Envelope } from '../src/shared/remote-protocol'

export interface RelayHandle {
  close(): Promise<void>
  port?: number
  /** 累计连接计数（可观测性）：配对 /pair 与转发 /ws 的 ws 接入次数。
   *  用于运维监控与连接活跃度回归测试（如 client 重连是否真的发生）。 */
  stats: {
    pairConnections: number
    wsConnections: number
  }
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
  // deviceKey 注册表（Important-3 持久化）：落盘到 dataDir/keys.json。
  //   原为纯内存 Map，中继重启后密钥全丢，已配对设备 bind 必 bad_sig、永久失联、须重新配对。
  //   持久化后重启可读盘恢复，已配对设备仍能验签 bind。
  //   密钥的唯一信任入口仍是配对流程（Task 5 安全决策不变）：
  //   - pair.code：桌面带 deviceKey 来，首次登记（已存在不覆盖，防重放覆盖）。
  //   - pair.consume：手机带 deviceKey 来，配对成功（信任点）时首次登记。
  //   - bind 握手：不信任/登记上报的密钥，只用此表已登记密钥验签身份。
  const keyRegistry = createKeyStore(join(opts.dataDir, 'keys.json'))
  // 分享链接 token 存储（Task 2）：桌面经 /pair token.create 生成分享 token，
  // 手机带 token 经 /ws bind 认证（token → desktopId 映射），无需走完整配对。
  // 落盘到 dataDir/tokens.json，重启可恢复（与 keys.json/bindings.json 同范式）。
  const tokenStore = createTokenStore({ filePath: join(opts.dataDir, 'tokens.json') })
  const router = createRouter(bindings, (id) => keyRegistry.get(id))

  // PWA 静态资源 MIME 映射（Task 15）。
  // 为什么必须显式设 Content-Type：浏览器对 Service Worker 注册有严格 MIME 校验——
  // 若 /sw.js 不以 text/javascript（或 application/javascript）返回，navigator.serviceWorker.register
  // 会失败（"MIME type ('text/plain') is not a supported stylesheet/script MIME type"）。
  // 之前 res.writeHead(200) 无 headers，依赖浏览器嗅探，SW 与 manifest 无法可靠注册。
  // 这里按扩展名补全；未知类型回落 application/octet-stream（触发下载而非执行，安全默认）。
  const MIME_BY_EXT: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
  }
  const contentTypeFor = (absPath: string): string => {
    const ext = absPath.slice(absPath.lastIndexOf('.')).toLowerCase()
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
  }

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
        res.writeHead(200, { 'Content-Type': contentTypeFor(abs) })
        res.end(data)
      } catch {
        // SPA fallback（fallback 目标同样在 staticDir 内，天然安全）
        try {
          const indexPath = join(staticRoot, 'index.html')
          const index = await readFile(indexPath)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(index)
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

  // 可观测性计数器：connection 事件累计自增（含重连）。
  const stats = { pairConnections: 0, wsConnections: 0 }

  httpServer.on('upgrade', (req, socket, head) => {
    const { url } = req
    if (url === '/pair') pairWss.handleUpgrade(req, socket, head, (ws) => pairWss.emit('connection', ws, req))
    else if (url === '/ws') wsWss.handleUpgrade(req, socket, head, (ws) => wsWss.emit('connection', ws, req))
    else socket.destroy()
  })

  // C1：从 upgrade 请求拿客户端 IP，用于 pair.consume 的 IP 维度限频。
  //   只用 req.socket.remoteAddress，不信 x-forwarded-for：
  //   只有确定前面挂了可信反代（剥掉客户端伪造的 xff）才能信 xff，否则攻击者可伪造头绕过限频。
  //   直连/裸中继场景 remoteAddress 即真实客户端 IP。
  function clientIpOf(req: any): string {
    return (req?.socket?.remoteAddress as string) || 'unknown'
  }

  pairWss.on('connection', (ws, req) => {
    stats.pairConnections++
    const ip = clientIpOf(req)
    ws.on('message', (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === 'pair.code' && msg.deviceId && msg.deviceKey) {
        const { code, expiresAt } = pairing.issueCode(msg.deviceId)
        keyRegistry.register(msg.deviceId, msg.deviceKey) // 首次登记桌面密钥（已存在不覆盖）
        console.log(`[pair] code issued for ${msg.deviceId}`)
        ws.send(JSON.stringify({ type: 'pair.code', payload: { code, expiresAt } }))
      } else if (msg.type === 'pair.consume' && msg.deviceId && msg.code) {
        console.log(`[pair] consume from ${msg.deviceId} code=${msg.code} hasKey=${!!msg.deviceKey}`)
        // C1：consume 走 IP 维度限频 + 失败锁定（consumeAttempt）。
        //   限频/锁定命中时也统一回 bad_pair_code：不向攻击者泄露「码错了」还是「被限频了」，
        //   减少信息侧信道（攻击者无法据响应区分限频状态）。
        const r = pairing.consumeAttempt(ip, msg.code, msg.deviceId)
        if (r.ok) {
          // 配对成功是手机端的信任确认点：登记手机密钥（首次，不覆盖）。
          keyRegistry.register(msg.deviceId, msg.deviceKey)
          const desktopKey = keyRegistry.get(r.desktopId)
          ws.send(JSON.stringify({
            type: 'pair.success',
            payload: { desktopId: r.desktopId, deviceKey: desktopKey }, // 下发桌面密钥给手机（全程 TLS）
          }))
        } else {
          // bad_code / rate_limited / locked 均对外表现为 bad_pair_code（不泄露限频细节）
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_pair_code' } }))
        }
      }
      // 分享链接 token 管理（Task 2）：桌面经 /pair 生成/撤销分享 token。
      // 信任入口：桌面身份 = keyRegistry 已登记的密钥（与 pair.code 同源）。
      // 未登记/密钥不符 → bad_auth，不泄露「deviceId 是否存在」给攻击者侧信道。
      if (msg.type === 'token.create' && msg.deviceId && msg.deviceKey) {
        const key = keyRegistry.get(msg.deviceId)
        if (!key || key !== msg.deviceKey) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_auth' } })); return
        }
        const expiresInDays = typeof msg.expiresInDays === 'number' ? msg.expiresInDays : 7
        const { token, expiresAt } = tokenStore.createToken(msg.deviceId, expiresInDays)
        console.log(`[pair] token created for ${msg.deviceId} expires=${expiresAt}`)
        ws.send(JSON.stringify({ type: 'token.created', payload: { token, expiresAt } }))
        return
      }
      if (msg.type === 'token.revoke' && msg.deviceId && msg.deviceKey && msg.token) {
        const key = keyRegistry.get(msg.deviceId)
        if (!key || key !== msg.deviceKey) {
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_auth' } })); return
        }
        tokenStore.revokeToken(msg.token)
        ws.send(JSON.stringify({ type: 'token.revoked', payload: { token: msg.token } }))
        return
      }
    })
  })

  wsWss.on('connection', (ws) => {
    stats.wsConnections++
    let boundDeviceId: string | null = null
    let boundSend: ((e: any) => void) | null = null
    console.log(`[ws] connection opened (total=${stats.wsConnections})`)
    ws.on('message', (raw) => {
      let env: Envelope
      try { env = JSON.parse(raw.toString()) } catch { console.log('[ws] unparseable message'); return }
      // bind 握手：第一条消息。
      if (env.type === 'bind' && !boundDeviceId) {
        // 新（Task 2）：token 认证（分享链接模式）。手机带 token 连接，无需走完整配对。
        // token → desktopId 映射由 tokenStore 维护；token 持有者即以桌面身份接入。
        // 注意：Envelope 类型无 token 字段（签名机制不同），这里放宽读取。
        const tok = (env as any).token
        if (typeof tok === 'string' && tok.length > 0) {
          const entry = tokenStore.getToken(tok)
          if (!entry) {
            console.log(`[ws] bind invalid_token`)
            ws.send(JSON.stringify({ type: 'error', payload: { code: 'invalid_token' } })); return
          }
          // Task 2-fix：token 手机以虚拟 id `share:xxx` register，而非桌面真实 id。
          //   旧缺陷：boundDeviceId = entry.desktopId（桌面 id），导致 token 手机与真桌面
          //   用同一 desktopId register → conns 互相覆盖；且 getPeers(desktopId) 返回配对手机。
          //   修复：生成虚拟 id，register 时带 { tokenPeer: 桌面真实 id } 建立 tokenPeers 双向映射。
          //   virtualId 同时作为 boundDeviceId（后续消息据此识别连接身份）。
          const virtualId = 'share:' + tok.slice(0, 8)
          boundDeviceId = virtualId
          router.register(virtualId, (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)) }, { tokenPeer: entry.desktopId })
          ws.send(JSON.stringify({ type: 'bind.ok' }))
          console.log(`[ws] bind.ok (token) virtual=${virtualId} desk=${entry.desktopId}`)
          return
        }
        // 旧：deviceId + 签名认证（向后兼容已配对设备）
        const bound = bindings.has(env.deviceId)
        const key = bound ? keyRegistry.get(env.deviceId) : null
        console.log(`[ws] bind from ${env.deviceId} bound=${bound} hasKey=${!!key}`)
        if (!bound) { ws.send(JSON.stringify({ type: 'error', payload: { code: 'unbound' } })); return }
        if (!key || !verifySig(key, env)) {
          console.log(`[ws] bind bad_sig device=${env.deviceId} hasKey=${!!key}`)
          ws.send(JSON.stringify({ type: 'error', payload: { code: 'bad_sig' } })); return
        }
        boundDeviceId = env.deviceId
        // send 闭包存为变量，ws close 时按引用 unregister（多端连接：只删当前连接，不删同 deviceId 的其他连接）
        boundSend = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)) }
        router.register(env.deviceId, boundSend)
        ws.send(JSON.stringify({ type: 'bind.ok' }))
        console.log(`[ws] bind.ok device=${env.deviceId}`)
        return
      }
      if (!boundDeviceId) { console.log(`[ws] msg before bind: type=${env.type}`); return } // 未 bind 拒收
      // Task 2-fix：token 连接的客户端不知道自己的虚拟 id（share:xxx），发出的消息
      //   env.deviceId 是任意值。server 在 route 前把它替换为 boundDeviceId：
      //   - token 连接：boundDeviceId = virtualId（share:xxx），route 据此走 token 放行分支；
      //   - 旧配对连接：boundDeviceId = env.deviceId（已验签），替换为自身是无操作。
      //   这也防止 token 手机伪造 env.deviceId 冒充桌面/其它设备（身份由 bind 握手钉死）。
      if (env.deviceId !== boundDeviceId) env.deviceId = boundDeviceId
      const r = router.route(env) // 转发或拒绝
      console.log(`[ws] route type=${env.type} from=${env.deviceId} ok=${r.ok} delivered=${r.delivered} reason=${r.reason ?? '-'}`)
    })
    ws.on('close', () => { if (boundDeviceId) router.unregister(boundDeviceId, boundSend ?? undefined); console.log(`[ws] closed device=${boundDeviceId ?? 'unbound'}`) })
  })

  return new Promise((resolve) => {
    httpServer.listen(opts.port, () => {
      const addr = httpServer.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      resolve({
        port,
        stats,
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
