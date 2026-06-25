// web/src/App.tsx
// PWA 根组件（Task 14 完成接入）。
//
// 视图分派：
//   未配对 → PairPage（Task 13）
//   已配对 → 中继连接 + 业务路由：
//     - list 视图：SessionListPage（session.list 渲染、attach/create）
//     - chat 视图：ChatPage（流式对话、批准卡片）
//
// useRelay 收到的业务信封按 type 分发：
//   session.list → 会话列表；session.delta/blocks/result → useSessionChat.onInbound；
//   dialog.request → useDialogQueue.onInbound。
// 发送：session.attach/create/message/interrupt/dialog.response 经 relay.send。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadDesktopIdentity, loadDeviceIdentity, clearPairingStorage } from './lib/pair'
import PairPage from './pages/PairPage'
import SessionListPage from './pages/SessionListPage'
import ChatPage from './pages/ChatPage'
import { useRelay } from './hooks/useRelay'
import { useSessionChat } from './hooks/useSessionChat'
import { useDialogQueue } from './hooks/useDialogQueue'
import { parseSessionListPayload, type SessionListItem } from './lib/session-list'
import type { Envelope } from '@shared/remote-protocol-types'

type View = { kind: 'list' } | { kind: 'chat'; localSessionId: string; title: string }

const DEFAULT_RELAY =
  import.meta.env.VITE_RELAY_URL ??
  (typeof location !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    : 'ws://localhost:8787')

export default function App() {
  const [desktop, setDesktop] = useState(() => loadDesktopIdentity())

  const handlePaired = () => setDesktop(loadDesktopIdentity())
  useEffect(() => {
    const onStorage = () => setDesktop(loadDesktopIdentity())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (!desktop) {
    return <PairPage onPaired={handlePaired} />
  }
  return <RemoteShell desktop={desktop} onUnpaired={() => setDesktop(null)} />
}

/** 已配对后的中继外壳：建立连接、路由视图。 */
function RemoteShell({
  desktop,
  onUnpaired,
}: {
  desktop: { desktopId: string; desktopKey: string }
  onUnpaired: () => void
}) {
  const device = useMemo(() => loadDeviceIdentity(), [])
  // device 缺失（理论上配对时已写入）：兜底回配对页。
  if (!device) {
    return <PairPage onPaired={() => window.location.reload()} />
  }

  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [view, setView] = useState<View>({ kind: 'list' })
  const [inputValue, setInputValue] = useState('')

  // 顺序耦合：useRelay 需要 onInbound，onInbound 需要 chat/dialog，
  // chat/dialog 的 send 又需要 relay.send —— 形成循环。
  // 解法：用 sendRef 桥接，hook 的 send 读 ref（运行时已就绪），
  // relay 在挂载后回填 ref。打破初始化时的 TDZ。
  const sendRef = useRef<(t: any, p: unknown) => Promise<boolean>>(async () => false)
  const sendViaRef = useCallback((t: any, p: unknown) => sendRef.current(t, p), [])

  const chat = useSessionChat({ send: sendViaRef as any })
  const dialog = useDialogQueue({ send: sendViaRef as any })

  const onInbound = useCallback(
    (env: Envelope) => {
      if (env.type === 'session.list') {
        setSessions(parseSessionListPayload(env.payload))
        return
      }
      if (env.type === 'session.delta' || env.type === 'session.blocks' || env.type === 'session.result') {
        // 仅当前 chat 视图对应的会话才喂给 chat hook（避免跨会话串扰）
        if (view.kind === 'chat') {
          const p = env.payload as { localSessionId?: string }
          if (p && p.localSessionId === view.localSessionId) {
            chat.onInbound(env)
          }
        }
        return
      }
      if (env.type === 'dialog.request') {
        dialog.onInbound(env)
        return
      }
      // 其余（session.notice 等）暂不处理
    },
    [chat, dialog, view],
  )

  const relay = useRelay({
    relayUrl: DEFAULT_RELAY,
    deviceId: device.deviceId,
    deviceKey: device.deviceKey,
    onInbound,
  })

  // relay 建立后回填 sendRef，让 chat/dialog 的 send 闭包能命中真实 send。
  useEffect(() => {
    sendRef.current = (t, p) => relay.send(t as any, p)
  }, [relay])

  // 已配对即自动连中继。
  useEffect(() => {
    relay.start()
    return () => relay.stop()
    // 仅首次挂载启动；重连由 useRelay 内部退避处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAttach = useCallback(
    (localSessionId: string) => {
      const s = sessions.find((x) => x.localSessionId === localSessionId)
      setView({ kind: 'chat', localSessionId, title: s?.title ?? '' })
      chat.reset()
      void relay.attach(localSessionId)
    },
    [sessions, relay, chat],
  )

  const handleCreate = useCallback(async () => {
    const ok = await relay.send('session.create', {})
    if (ok) {
      // 等桌面回 session.list 更新后用户点击进入；或直接进入一个占位 chat。
      // 简化：保持 list 视图，待桌面下发新会话后用户点入。
      void ok
    }
  }, [relay])

  const handleSend = useCallback(() => {
    if (view.kind !== 'chat') return
    const text = inputValue
    setInputValue('')
    void chat.sendMessage(view.localSessionId, text)
  }, [view, inputValue, chat])

  const handleInterrupt = useCallback(() => {
    if (view.kind !== 'chat') return
    void chat.interrupt(view.localSessionId)
  }, [view, chat])

  const handleUnpair = useCallback(() => {
    relay.stop()
    clearPairingStorage()
    onUnpaired()
  }, [relay, onUnpaired])

  if (view.kind === 'chat') {
    return (
      <ChatPage
        title={view.title || '新会话'}
        messages={chat.messages}
        running={chat.running}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onBack={() => {
          setView({ kind: 'list' })
          chat.reset()
        }}
        currentDialog={dialog.current}
        onApprove={(reqId) => void dialog.approve(reqId)}
        onDeny={(reqId) => void dialog.deny(reqId)}
      />
    )
  }

  return (
    <SessionListPage
      connected={relay.connected}
      sessions={sessions}
      onAttach={handleAttach}
      onCreate={() => void handleCreate()}
    />
  )
}
