// web/src/App.tsx
// PWA 根组件。
//
// Task 13：未配对 → PairPage（扫码/输码）；已配对 → 占位会话列表（Task 14 实现）。
// 配对状态以本地存储的桌面身份为准（PairPage 配对成功后会写入）。
import { useEffect, useState } from 'react'
import { loadDesktopIdentity } from './lib/pair'
import PairPage from './pages/PairPage'

export default function App() {
  // 已配对的桌面身份；配对页成功后会落盘并触发重新读取。
  const [desktop, setDesktop] = useState(() => loadDesktopIdentity())

  // 配对成功回调：刷新身份态，触发视图切换。
  // PairPage 卸载时已落盘，这里只需重读。
  const handlePaired = () => {
    setDesktop(loadDesktopIdentity())
  }

  // 跨 Tab / 多窗口场景：localStorage 变化时同步配对态。
  useEffect(() => {
    const onStorage = () => setDesktop(loadDesktopIdentity())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (!desktop) {
    return <PairPage onPaired={handlePaired} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>cc-desk</h1>
        <span className="status on">已配对</span>
      </header>
      <main className="app-body">
        <p className="hint">
          已配对桌面：{desktop.desktopId.slice(0, 12)}…
        </p>
        <p className="hint">（会话列表页待 Task 14 实现）</p>
      </main>
    </div>
  )
}
