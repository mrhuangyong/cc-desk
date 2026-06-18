import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/store'
import './index.css'
import 'katex/dist/katex.min.css'

// StrictMode 已移除：TipTap v3（ProseMirror）的 plugin views 在 React 18 StrictMode
// 的 double-mount 周期里会触发 isEditable of undefined 竞态（viewport plugin +
// suggestion Plugin.apply 在 editor 未就绪时 dispatch）。StrictMode 仅 dev 诊断用，
// 对有副作用的 DOM-heavy 库不兼容。
createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>
)
