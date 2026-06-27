// relay/main.ts
// 中继服务独立运行入口（供 Docker / pm2 / node 直接启动）。
// 读环境变量配置，调 startRelayServer。
//
// 环境变量：
//   RELAY_PORT     监听端口（容器内），默认 8080
//   RELAY_DATA_DIR 绑定关系 + 密钥持久化目录，默认 ./data
//   RELAY_STATIC_DIR PWA 静态资源目录，默认 ./public（空则不托管静态，仅做消息转发）
import { startRelayServer } from './server'
import { mkdir } from 'fs/promises'
import { resolve } from 'path'

async function main() {
  const port = Number(process.env.RELAY_PORT ?? '8080')
  const dataDir = resolve(process.env.RELAY_DATA_DIR ?? './data')
  const staticDir = process.env.RELAY_STATIC_DIR
    ? resolve(process.env.RELAY_STATIC_DIR)
    : resolve('./public')

  await mkdir(dataDir, { recursive: true })

  const handle = await startRelayServer({ port, dataDir, staticDir })
  console.log(`[cc-relay] listening on :${handle.port} (data=${dataDir}, static=${staticDir})`)

  // 优雅关闭：收到信号时 terminate 所有 ws + 关 http
  const shutdown = async (sig: string) => {
    console.log(`[cc-relay] received ${sig}, shutting down...`)
    try { await handle.close() } catch (e) { console.error('[cc-relay] close error', e) }
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[cc-relay] fatal:', err)
  process.exit(1)
})
