import '@testing-library/jest-dom/vitest'

// jsdom 未实现 clipboard 命令查询 API；monaco-editor 在模块加载阶段会调用它，
// 任何间接 import 到 monaco 的组件测试都会因此失败，故在此全局 polyfill。
// 注意：node 环境（@vitest-environment node）下 document 不存在，
// 必须先 typeof document 判空，否则成员访问会抛 ReferenceError（影响 e2e/node 测试加载）。
if (typeof document !== 'undefined' && typeof document.queryCommandSupported !== 'function') {
  ;(document as any).queryCommandSupported = () => false
}
