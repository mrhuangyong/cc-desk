// 主窗口 preload：原型阶段暂留空导出。
// webview 通信走 window.postMessage（guest 页面 → 宿主 window 的 message 事件），
// 不需要专门的 webview preload。
export {}
