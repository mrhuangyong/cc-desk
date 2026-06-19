import '@testing-library/jest-dom/vitest'

// jsdom 未实现 clipboard 命令查询 API；monaco-editor 在模块加载阶段会调用它，
// 任何间接 import 到 monaco 的组件测试都会因此失败，故在此全局 polyfill。
if (typeof document.queryCommandSupported !== 'function') {
  ;(document as any).queryCommandSupported = () => false
}
