// web/src/App.tsx
// PWA 根组件。
//
// Task 12 占位实现：渲染最小可用壳子，接入 useRelay 显示连接状态。
// 后续任务（Task 13-14）会在此之上叠加配对 UI / 会话列表 / 对话流。
import { useState } from 'react'
import { useRelay } from './hooks/useRelay'

export default function App() {
  // 占位：实际 deviceId/deviceKey 来自配对流程（Task 13）；先用本地存储兜底。
  const [deviceId] = useState(() => localStorage.getItem('deviceId') || '')
  const [deviceKey] = useState(() => localStorage.getItem('deviceKey') || '')
  const relayUrl = import.meta.env.VITE_RELAY_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

  const relay = useRelay({ relayUrl, deviceId, deviceKey })

  return (
    <div className="app">
      <header className="app-header">
        <h1>cc-desk</h1>
        <span className={`status ${relay.connected ? 'on' : 'off'}`}>
          {relay.connected ? '已连接' : '未连接'}
        </span>
      </header>
      <main className="app-body">
        {!deviceId || !deviceKey ? (
          <p className="hint">尚未配对。请打开桌面端 cc-desk 的远程控制，扫描配对码。</p>
        ) : (
          <p className="hint">已配对设备：{deviceId.slice(0, 8)}…</p>
        )}
      </main>
    </div>
  )
}
