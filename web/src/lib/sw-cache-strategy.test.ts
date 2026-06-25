// web/src/lib/sw-cache-strategy.test.ts
// Service Worker 缓存策略的单元测试。
// 验证：哪些请求进缓存、哪些放行、离线导航如何回退。
// 这些是「PWA 能用且不破坏远程控制」的关键不变量。

import { describe, it, expect } from 'vitest'
import {
  decideStrategy,
  PRECACHE_URLS,
  CACHE_NAME,
} from './sw-cache-strategy'

const SAME_ORIGIN = 'https://ccdesk.mrhua.top'
const asset = (path: string) => `${SAME_ORIGIN}${path}`

describe('decideStrategy', () => {
  describe('BYPASS（永不缓存）', () => {
    it('非 GET 方法一律放行（POST 批准绝不缓存）', () => {
      expect(decideStrategy({ url: asset('/api/dialog/respond'), method: 'POST', sameOrigin: true })).toBe('BYPASS')
      expect(decideStrategy({ url: asset('/'), method: 'PUT', sameOrigin: true })).toBe('BYPASS')
    })

    it('WebSocket 请求一律放行（拦截即断连）', () => {
      expect(decideStrategy({ url: 'wss://ccdesk.mrhua.top/ws', method: 'GET', sameOrigin: true })).toBe('BYPASS')
      expect(decideStrategy({ url: 'ws://ccdesk.mrhua.top/pair', method: 'GET', sameOrigin: true })).toBe('BYPASS')
    })

    it('跨源请求放行（CDN 字体等）', () => {
      expect(decideStrategy({ url: 'https://fonts.googleapis.com/css?family=Inter', method: 'GET', sameOrigin: false })).toBe('BYPASS')
      expect(decideStrategy({ url: 'https://unpkg.com/react', method: 'GET', sameOrigin: false })).toBe('BYPASS')
    })

    it('同源 /api/ 路径放行（避免缓存旧配对码）', () => {
      expect(decideStrategy({ url: asset('/api/pair/code'), method: 'GET', sameOrigin: true })).toBe('BYPASS')
      expect(decideStrategy({ url: asset('/api/sessions'), method: 'GET', sameOrigin: true })).toBe('BYPASS')
    })

    it('非法 URL 放行', () => {
      expect(decideStrategy({ url: 'not-a-url', method: 'GET', sameOrigin: true })).toBe('BYPASS')
    })
  })

  describe('NAVIGATION（网络优先 + 离线回退壳）', () => {
    it('页面导航用 NAVIGATION', () => {
      expect(decideStrategy({ url: asset('/'), method: 'GET', sameOrigin: true, mode: 'navigate' })).toBe('NAVIGATION')
      expect(decideStrategy({ url: asset('/some/deep/path'), method: 'GET', sameOrigin: true, mode: 'navigate' })).toBe('NAVIGATION')
    })

    it('导航但跨源仍放行', () => {
      expect(decideStrategy({ url: 'https://other.com/page', method: 'GET', sameOrigin: false, mode: 'navigate' })).toBe('BYPASS')
    })
  })

  describe('SAME_ORIGIN_ASSET（stale-while-revalidate）', () => {
    it('hashed JS bundle 进 SWR 缓存', () => {
      expect(decideStrategy({ url: asset('/assets/index-DscojYRB.js'), method: 'GET', sameOrigin: true })).toBe('SAME_ORIGIN_ASSET')
    })
    it('hashed CSS 进 SWR 缓存', () => {
      expect(decideStrategy({ url: asset('/assets/index-DnRiNW1W.css'), method: 'GET', sameOrigin: true })).toBe('SAME_ORIGIN_ASSET')
    })
    it('manifest 进缓存', () => {
      expect(decideStrategy({ url: asset('/manifest.webmanifest'), method: 'GET', sameOrigin: true })).toBe('SAME_ORIGIN_ASSET')
    })
    it('图标资源进缓存', () => {
      expect(decideStrategy({ url: asset('/icons/icon-192.png'), method: 'GET', sameOrigin: true })).toBe('SAME_ORIGIN_ASSET')
      expect(decideStrategy({ url: asset('/icons/icon-maskable-512.png'), method: 'GET', sameOrigin: true })).toBe('SAME_ORIGIN_ASSET')
    })
    it('非导航的根路径 index.html（fetch 子资源）也进 SWR', () => {
      expect(decideStrategy({ url: asset('/index.html'), method: 'GET', sameOrigin: true })).toBe('SAME_ORIGIN_ASSET')
    })
  })
})

describe('PRECACHE_URLS（app shell 预缓存）', () => {
  it('只预缓存名固定的壳资源', () => {
    expect([...PRECACHE_URLS]).toEqual(['/', '/index.html', '/manifest.webmanifest'])
  })
})

describe('CACHE_NAME', () => {
  it('带版本号，便于 activate 时清理旧版本', () => {
    expect(CACHE_NAME).toMatch(/^cc-desk-shell-v\d+$/)
  })
})
