// web/src/lib/sw-cache-strategy.ts
// Service Worker 缓存策略的纯函数核心。
//
// 为什么单独抽出来（TDD）：
// sw.js 里的 fetch/install/activate 事件处理器依赖 ServiceWorkerGlobalScope，
// 在 jsdom/node 里无法直接执行。但「这个请求该不该缓存、命中哪类策略」
// 是纯逻辑，抽成函数就能单元测试——避免 SW 行为只在浏览器里才能验证。
//
// 三类策略（最小特权，与远程控制场景匹配）：
//  - SAME_ORIGIN_ASSET：同源静态资源（JS/CSS/index.html/图标/manifest）→ stale-while-revalidate
//  - NAVIGATION：HTML 导航 → 网络优先，失败回退缓存的 app shell（离线打开）
//  - BYPASS：跨源请求 / WebSocket / API → 永不缓存，直接放行
//    关键：WebSocket（远程控制的命脉，配对/转发都走 ws）一旦被 SW 拦截会断连，
//    所以 ws/wss 必须显式 BYPASS；同理中继 HTTP API 也不缓存。

export type CacheStrategy = 'SAME_ORIGIN_ASSET' | 'NAVIGATION' | 'BYPASS'

export interface StrategyInput {
  url: string
  /** 请求方法（GET 才考虑缓存）。 */
  method: string
  /** 该请求是否与 SW 注册同源（决定是否缓存静态壳）。 */
  sameOrigin: boolean
  /** request.mode：'navigate' 表示页面跳转。 */
  mode?: RequestMode | 'navigate' | string
}

/**
 * 判定一个请求应使用的缓存策略。
 * 输出确定、无副作用，便于回归测试。
 */
export function decideStrategy(input: StrategyInput): CacheStrategy {
  const { method, sameOrigin, mode } = input
  // 只缓存 GET（POST/PUT 等绝不缓存——远程批准是 POST，缓存即灾难）。
  if (method !== 'GET') return 'BYPASS'

  let u: URL
  try {
    u = new URL(input.url)
  } catch {
    // 相对路径或非法 URL，按同源静态资源处理（fetch 事件里拿到的都是绝对 URL，这里兜底）。
    return 'BYPASS'
  }

  // WebSocket 协议（ws/wss）绝不进入 SW 缓存。
  // 远程控制的中继 /pair 与 /ws 都是 WebSocket，拦截即断连。
  if (u.protocol === 'ws:' || u.protocol === 'wss:') return 'BYPASS'

  // 跨源请求一律放行（中继域名之外的所有请求，如 CDN 字体）。
  if (!sameOrigin) return 'BYPASS'

  // 页面导航（用户打开/刷新 PWA）→ 网络优先 + 离线回退壳。
  if (mode === 'navigate') return 'NAVIGATION'

  // 中继的 API 端点（未来可能扩展 /pair 的 HTTP 形态）不缓存，
  // 避免缓存到旧的配对码。当前中继 API 路径约定加 /api/ 前缀便于区分。
  if (u.pathname.startsWith('/api/')) return 'BYPASS'

  // 其余同源 GET（hashed assets / index.html / manifest / 图标 / sw.js 自身）→ SWR。
  return 'SAME_ORIGIN_ASSET'
}

/**
 * SW install 阶段要预缓存（precache）的 app shell 资源列表。
 * 只缓存「打开 PWA 必须」的壳：index.html + manifest。
 *
 * 为什么不预缓存 JS/CSS bundle：
 *  bundle 文件名带 hash（index-AbC123.js），构建后才知道具体名，
 *  SW 是静态文件无法在构建时注入 hash 列表。改为运行时 SWR 懒缓存：
 *  首次加载后这些资源自动进缓存，下次离线即可用。
 *  index.html 本身名固定，预缓存它保证离线能打开壳（壳里再引用 bundle，
 *  bundle 已被上次 SWR 缓存），形成完整的离线闭环。
 */
export const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest'] as const

/**
 * 需要从旧缓存清理（activate 阶段）时，判断某个 cache key 是否仍属有效版本。
 * 当前用单一 CACHE 名，activate 时直接清掉所有非当前版本的 cache。
 * 这里返回当前版本名，便于测试断言。
 */
export const CACHE_VERSION = 'cc-desk-shell-v1'
export const CACHE_NAME = CACHE_VERSION
