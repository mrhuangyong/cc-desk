import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// 真机 e2e 专用配置：jsdom 不适用（需 node 环境，且不排除 e2e-real-model.test.ts）
// 每个 e2e 测试文件内部用 `// @vitest-environment node` 声明 node 环境。
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: './tests/setup.ts',
    include: ['tests/e2e-real-model.test.ts'],
  },
})
