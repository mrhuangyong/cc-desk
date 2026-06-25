// web/vite.config.ts
// PWA 构建配置。
// - path mapping '@shared/*' → 根目录 src/shared/*，单一真相源复用协议类型。
//   web 端只引用 remote-protocol-types.ts（纯类型+常量，无 node:crypto），
//   签名实现用 web/src/lib/sign.ts 的 Web Crypto 版本（浏览器无 node:crypto）。
// - 构建输出到 ../relay/public/（Task 15 处理部署，此处先设好 outDir 让产物就位）。
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const webDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(webDir, '../src/shared'),
    },
  },
  build: {
    outDir: resolve(webDir, '../relay/public'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
