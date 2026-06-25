// tests/remote-bridge.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { startRelayServer } from '../relay/server'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'
import { makeEnvelope, type Envelope } from '../src/shared/remote-protocol'

let servers: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(servers.map(s => s.close()))
  servers = []
}, 20000)

/** 等待 ws 的下一条消息并解析为对象。 */
function nextMsg(ws: WebSocket): Promise<any> {
  return new Promise((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))))
}

function connect(port: number, path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/**
 * 走完整配对流程建立 D↔M 绑定，并登记桌面密钥到中继 keyRegistry。
 * 为什么不直接预置 bindings：Task 5 的设计里配对是唯一信任入口，
 * keyRegistry 是内存态（不暴露），密钥只能通过 pair.code/pair.consume 首次登记。
 * 所以测试必须用真实配对流程建立绑定 + 密钥，remote-bridge 才能 bind 成功。
 */
async function pairDesktopAndMobile(port: number, desktopKey: string, mobileKey: string): Promise<void> {
  // 桌面 issue 配对码（同时登记桌面密钥）
  const wsD = await connect(port, '/pair')
  wsD.send(JSON.stringify({ type: 'pair.code', deviceId: 'D', deviceKey: desktopKey }))
  const codeMsg: any = await nextMsg(wsD)
  const code = codeMsg.payload.code
  // 手机 consume（同时登记手机密钥）
  const wsM = await connect(port, '/pair')
  wsM.send(JSON.stringify({ type: 'pair.consume', deviceId: 'M', deviceKey: mobileKey, code }))
  await nextMsg(wsM) // pair.success
  wsD.close(); wsM.close()
}

/** 轮询条件成立，最多等 timeoutMs。用于等异步握手完成。 */
async function waitFor(cond: () => boolean, timeoutMs = 2000, interval = 30): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return true
    await new Promise(r => setTimeout(r, interval))
  }
  return cond()
}

describe('remote-bridge 连接与 bind 握手', () => {
  it('bind 握手成功后 isConnected 为 true', async () => {
    const dataDir = join(tmpdir(), `rb-${Math.random().toString(36).slice(2)}`)
    const relay = await startRelayServer({ port: 0, dataDir })
    servers.push(relay)
    const port = relay.port!
    const desktopKey = 'ZGVza3RvcC1rZXk='
    const mobileKey = 'bW9iaWxlLWtleQ=='
    // 预置绑定 + 密钥：用完整配对流程（Task 5 的唯一信任入口）
    await pairDesktopAndMobile(port, desktopKey, mobileKey)

    const { createRemoteBridge } = await import('../src/main/remote-bridge')
    const bridge = createRemoteBridge({
      relayUrl: `ws://127.0.0.1:${port}`,
      deviceId: 'D',
      deviceKey: desktopKey,
      onInbound: () => {},
    })
    await bridge.start()
    // 等握手完成（bind.ok 到达后置 connected）
    expect(await waitFor(() => bridge.isConnected())).toBe(true)
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('未配对（无绑定/无密钥）时 bind 失败，isConnected 保持 false', async () => {
    const dataDir = join(tmpdir(), `rb-${Math.random().toString(36).slice(2)}`)
    const relay = await startRelayServer({ port: 0, dataDir })
    servers.push(relay)
    const port = relay.port!

    const { createRemoteBridge } = await import('../src/main/remote-bridge')
    const bridge = createRemoteBridge({
      relayUrl: `ws://127.0.0.1:${port}`,
      deviceId: 'UNKNOWN', // 未配对，bindings/keyRegistry 都没有
      deviceKey: 'dGVzdA==',
      onInbound: () => {},
    })
    await bridge.start()
    // 给握手 + error 回包留时间，确认不会误置 connected
    await new Promise(r => setTimeout(r, 300))
    expect(bridge.isConnected()).toBe(false)
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('stop 后不再重连，连接关闭', async () => {
    const dataDir = join(tmpdir(), `rb-${Math.random().toString(36).slice(2)}`)
    const relay = await startRelayServer({ port: 0, dataDir })
    servers.push(relay)
    const port = relay.port!
    const desktopKey = 'ZGVza3RvcC1rZXk='
    const mobileKey = 'bW9iaWxlLWtleQ=='
    await pairDesktopAndMobile(port, desktopKey, mobileKey)

    const { createRemoteBridge } = await import('../src/main/remote-bridge')
    const bridge = createRemoteBridge({
      relayUrl: `ws://127.0.0.1:${port}`,
      deviceId: 'D',
      deviceKey: desktopKey,
      onInbound: () => {},
    })
    await bridge.start()
    expect(await waitFor(() => bridge.isConnected())).toBe(true)
    await bridge.stop()
    expect(bridge.isConnected()).toBe(false)
    // stop 后即使等一会也不该重连成功
    await new Promise(r => setTimeout(r, 200))
    expect(bridge.isConnected()).toBe(false)
    await rm(dataDir, { recursive: true, force: true })
  })

  it('收到 server 下发的 error 信封后主动重连（不再死锁）', async () => {
    // Important-1 回归测试：server 在 bind 失败（unbound/bad_sig）时只发 error 不关连接，
    // 旧实现 message 分支收到 error 后仅置 connected=false 并 return，不触发 scheduleReconnect，
    // 导致 ws.on('close') 永不触发、退避重连链路死锁。
    // 修复后：error 分支主动 terminate 连接（触发 close → scheduleReconnect）。
    //
    // 确定性验证：用 server.stats.wsConnections 观测重连是否真的发生。
    // 未配对 bridge 每次重连都会新建 ws 到 /ws → stats.wsConnections 累加。
    const dataDir = join(tmpdir(), `rb-${Math.random().toString(36).slice(2)}`)
    const relay = await startRelayServer({ port: 0, dataDir })
    servers.push(relay)
    const port = relay.port!

    const { createRemoteBridge } = await import('../src/main/remote-bridge')
    const bridge = createRemoteBridge({
      relayUrl: `ws://127.0.0.1:${port}`,
      deviceId: 'UNKNOWN', // 未配对 → server 必回 error(unbound)，且不关连接
      deviceKey: 'dGVzdA==',
      onInbound: () => {},
    })
    await bridge.start()
    // 第一次连接 + bind → error。等握手往返。
    await waitFor(() => relay.stats!.wsConnections >= 1)
    expect(bridge.isConnected()).toBe(false)

    // 若 Important-1 bug 存在（error 不重连），stats.wsConnections 会停在 1 永不增长。
    // 退避序列 1s→2s；等 2.5s 应至少再经历 1 次重连（新增一次 /ws 连接）。
    expect(await waitFor(() => relay.stats!.wsConnections >= 2, 4000)).toBe(true)
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  }, 12000)

  it('连接断开后自动重连成功（指数退避，密钥持久化后 bind 仍可验签）', async () => {
    // Important-2 重写：旧断言 `send 不抛错` 恒为真（send 未连接时静默丢弃），
    // 是假阳性。真正验证：断连触发重连 → 退避后重连 → bind 握手再次成功 → isConnected 回到 true。
    // 前提：Important-3 把 keyRegistry 持久化到 dataDir，中继重启后密钥不丢，
    // 否则重连 bind 必因 bad_sig 失败，无法断言 connected 回到 true。
    const dataDir = join(tmpdir(), `rb-${Math.random().toString(36).slice(2)}`)
    let relay = await startRelayServer({ port: 0, dataDir })
    servers.push(relay)
    const port = relay.port!
    const desktopKey = 'ZGVza3RvcC1rZXk='
    const mobileKey = 'bW9iaWxlLWtleQ=='
    await pairDesktopAndMobile(port, desktopKey, mobileKey)

    const { createRemoteBridge } = await import('../src/main/remote-bridge')
    const bridge = createRemoteBridge({
      relayUrl: `ws://127.0.0.1:${port}`,
      deviceId: 'D',
      deviceKey: desktopKey,
      onInbound: () => {},
    })
    await bridge.start()
    expect(await waitFor(() => bridge.isConnected())).toBe(true)

    // 关掉中继触发断连（keyRegistry 已持久化到 dataDir/keys.json）
    await relay.close()
    servers = servers.filter(s => s !== relay)
    expect(await waitFor(() => !bridge.isConnected())).toBe(true)

    // 重启中继（同端口、同 dataDir）—— bindings 和 keys 都从盘恢复
    relay = await startRelayServer({ port, dataDir })
    servers.push(relay)
    // 退避后 bridge 自动重连，bind 握手因密钥仍在而成功
    expect(await waitFor(() => bridge.isConnected(), 6000)).toBe(true)
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  }, 15000)

  it('收到对端信封时调用 onInbound', async () => {
    const dataDir = join(tmpdir(), `rb-${Math.random().toString(36).slice(2)}`)
    const relay = await startRelayServer({ port: 0, dataDir })
    servers.push(relay)
    const port = relay.port!
    const desktopKey = 'ZGVza3RvcC1rZXk='
    const mobileKey = 'bW9iaWxlLWtleQ=='
    await pairDesktopAndMobile(port, desktopKey, mobileKey)

    const received: Envelope[] = []
    const { createRemoteBridge } = await import('../src/main/remote-bridge')
    const bridge = createRemoteBridge({
      relayUrl: `ws://127.0.0.1:${port}`,
      deviceId: 'D',
      deviceKey: desktopKey,
      onInbound: (env) => { received.push(env) },
    })
    await bridge.start()
    expect(await waitFor(() => bridge.isConnected())).toBe(true)

    // 用手机身份 bind 并发一条消息给桌面（D）
    const wsM = await connect(port, '/ws')
    wsM.send(JSON.stringify(makeEnvelope(mobileKey, 'bind', 'M', { desktopId: 'D' })))
    expect((await nextMsg(wsM)).type).toBe('bind.ok')
    const inbound = makeEnvelope(mobileKey, 'session.message', 'M', { text: 'hello from mobile' })
    wsM.send(JSON.stringify(inbound))

    expect(await waitFor(() => received.length > 0)).toBe(true)
    expect(received[0].type).toBe('session.message')
    expect((received[0].payload as any).text).toBe('hello from mobile')
    wsM.close()
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  })
})
