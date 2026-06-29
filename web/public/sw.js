// web/public/sw.js
// cc-desk PWA Service Worker。
//
// 单一真相源说明：
// 缓存策略的纯函数实现 + 测试在 web/src/lib/sw-cache-strategy.ts。
// Service Worker 运行在独立的 ServiceWorkerGlobalScope，不能 import 项目模块，
// 所以这里把策略逻辑「内联」，并保持与 sw-cache-strategy.ts 完全一致
// （改一处务必同步另一处，已用注释标出 SYNC-WITH）。
//
// 策略三类（详见 sw-cache-strategy.ts）：
//   - SAME_ORIGIN_ASSET：同源静态资源 → stale-while-revalidate（懒缓存）
//   - NAVIGATION：HTML 导航 → 网络优先，失败回退缓存的 app shell（离线打开）
//   - BYPASS：跨源 / WebSocket / API / 非 GET → 永不缓存，直接放行
//     关键：远程控制的中继 /pair /ws 是 WebSocket，一旦被拦截就断连，必须放行。
//
// 注册范围：scope = '/'（与 index.html 同源根，见 index.html 的注册）。

const CACHE_NAME = 'cc-desk-shell-v5' // SYNC-WITH sw-cache-strategy.ts CACHE_NAME
// v5 变更：移除排队下拉框 + 模型固定可见 + 水平溢出修复 + 弹窗按会话过滤。强制清旧缓存。
// 升版本号触发 activate 清掉 v1 缓存。

// 预缓存的 app shell：名固定（bundle 带 hash，运行时 SWR 懒缓存）。
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest'] // SYNC-WITH sw-cache-strategy.ts PRECACHE_URLS

// ---- install：预缓存壳，立即激活（skipWaiting）----
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // allSettled：单个资源失败不阻塞整个 SW 安装（弱网下图标可能 404）。
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
      await self.skipWaiting()
    })(),
  )
})

// ---- activate：清掉旧版本 cache，立即接管客户端----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

// ---- decideStrategy（内联，与 sw-cache-strategy.ts 一致）----
function decideStrategy(input) {
  const { method, sameOrigin, mode } = input
  if (method !== 'GET') return 'BYPASS'
  let u
  try {
    u = new URL(input.url)
  } catch {
    return 'BYPASS'
  }
  if (u.protocol === 'ws:' || u.protocol === 'wss:') return 'BYPASS'
  if (!sameOrigin) return 'BYPASS'
  if (mode === 'navigate') return 'NAVIGATION'
  if (u.pathname.startsWith('/api/')) return 'BYPASS'
  return 'SAME_ORIGIN_ASSET'
}

// ---- fetch：按策略分发----
self.addEventListener('fetch', (event) => {
  const req = event.request
  // 只处理 GET（POST 批准等绝不缓存）。
  if (req.method !== 'GET') return

  let sameOrigin = true
  try {
    sameOrigin = new URL(req.url).origin === self.location.origin
  } catch {
    return
  }

  const strategy = decideStrategy({
    url: req.url,
    method: req.method,
    sameOrigin,
    mode: req.mode,
  })

  if (strategy === 'BYPASS') return // 放行，浏览器默认处理

  if (strategy === 'NAVIGATION') {
    // 网络优先：在线拿最新 HTML；失败（离线）回退缓存的 app shell。
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(CACHE_NAME)
          cache.put('/', fresh.clone()).catch(() => {})
          return fresh
        } catch {
          const cache = await caches.open(CACHE_NAME)
          const shell = (await cache.match('/')) || (await cache.match('/index.html'))
          if (shell) return shell
          // 兜底：壳也没缓存（首次离线安装的极端情况）。
          return new Response('<h1>Offline</h1>', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
      })(),
    )
    return
  }

  // SAME_ORIGIN_ASSET：网络优先（v2 改动）。
  // 在线时永远拿最新 bundle（部署后刷新即生效），仅离线才回退缓存。
  // 原先的 stale-while-revalidate 会让手机刷新继续用旧 JS，新版本「下次」才生效，
  // 导致用户以为没部署成功。
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        const fresh = await fetch(req)
        // 只缓存成功的同源响应。
        if (fresh && fresh.ok && fresh.type === 'basic') {
          cache.put(req, fresh.clone()).catch(() => {})
        }
        return fresh
      } catch {
        // 离线：回退缓存。
        const cached = await cache.match(req)
        if (cached) return cached
        return new Response('offline', { status: 503 })
      }
    })(),
  )
})
