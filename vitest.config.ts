import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts',
    // 默认排除真机 e2e（依赖本地 ai-proxy + 真实模型，耗时 ~50s）；用 pnpm test:e2e 单独跑。
    // 排除 web/ 子项目（PWA）：它有独立 vitest 配置 + @shared 别名，
    // 在根配置下无法解析，由 web/ 自己的 pnpm test 运行。
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e-real-model.test.ts', 'web/**'],
  },
})
