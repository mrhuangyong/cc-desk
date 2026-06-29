// web/src/App.tsx
// PWA 根组件（Task 14 完成接入）。
//
// 视图分派：
//   未配对 → PairPage（Task 13）
//   已配对 → 中继连接 + 业务路由：
//     - list 视图：ProjectListPage（项目列表 → 展开看会话 → attach/create）
//     - chat 视图：ChatPage（流式对话、批准卡片）
//
// useRelay 收到的业务信封按 type 分发：
//   session.list → 会话列表；session.delta/blocks/result → useSessionChat.onInbound；
//   dialog.request → useDialogQueue.onInbound。
// 发送：session.attach/create/message/interrupt/dialog.response 经 relay.send。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadDesktopIdentity,
  loadDeviceIdentity,
  clearPairingStorage,
  parseShareTokenFromUrl,
  loadShareToken,
  saveShareToken,
} from './lib/pair'
import PairPage from './pages/PairPage'
import ProjectListPage from './pages/ProjectListPage'
import ChatPage from './pages/ChatPage'
import { useRelay } from './hooks/useRelay'
import { useSessionChat } from './hooks/useSessionChat'
import { useDialogQueue } from './hooks/useDialogQueue'
import { usePwaBack } from './hooks/usePwaBack'
import { useTheme } from './hooks/useTheme'
import { SunIcon, MoonIcon } from './components/icons'
import { parseSessionListFull, type SessionListItem, type ProjectMeta } from './lib/session-list'
import { readImageAsAttachment, type ImageAttachment } from './lib/read-image'
import { loadDraft, saveDraft, clearDraft } from './lib/draft-storage'
import type { Envelope } from '@shared/remote-protocol-types'

type View = { kind: 'list' } | { kind: 'chat'; localSessionId: string; title: string }

const DEFAULT_RELAY =
  import.meta.env.VITE_RELAY_URL ??
  (typeof location !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    : 'ws://localhost:8787')

export default function App() {
  // Task 4：分享链接认证 —— token 优先级解析（一次性，挂载期确定模式）。
  //   1) URL ?t=xxx → 存 localStorage 后用它（扫码/点链接直达）。
  //   2) 无 URL ?t= → 读 localStorage ccdesk.share（刷新不丢）。
  //   3) 都无 → 旧 desktop 配对路径（PairPage）。
  // 用 useState 惰性初始化锁定结果：避免 location.search 变化（SPA 内无刷新）反复重算。
  const [shareToken] = useState<string | null>(() => {
    if (typeof location === 'undefined') return loadShareToken()
    const fromUrl = parseShareTokenFromUrl(location.search)
    if (fromUrl) {
      saveShareToken(fromUrl)
      return fromUrl
    }
    return loadShareToken()
  })

  const [desktop, setDesktop] = useState(() => loadDesktopIdentity())
  const { theme, toggle } = useTheme()
  const themeToggle = (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === 'light' ? '切换到暗色' : '切换到亮色'}
      title={theme === 'light' ? '暗色' : '亮色'}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  )

  const handlePaired = () => setDesktop(loadDesktopIdentity())
  useEffect(() => {
    const onStorage = () => setDesktop(loadDesktopIdentity())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 有 shareToken → 跳过配对检查，直接进 RemoteShell（token 即凭证，免配对直连）。
  if (shareToken) {
    return (
      <RemoteShell
        desktop={null}
        shareToken={shareToken}
        onUnpaired={() => window.location.reload()}
        themeToggle={themeToggle}
      />
    )
  }
  if (!desktop) {
    return <PairPage onPaired={handlePaired} headerExtra={themeToggle} />
  }
  return <RemoteShell desktop={desktop} onUnpaired={() => setDesktop(null)} themeToggle={themeToggle} />
}

/** 已配对后的中继外壳：建立连接、路由视图。 */
function RemoteShell({
  desktop,
  onUnpaired,
  themeToggle,
  shareToken,
}: {
  desktop: { desktopId: string; desktopKey: string } | null
  onUnpaired: () => void
  themeToggle: React.ReactNode
  /** 分享 token（Task 4）：存在则走 token 模式 bind，desktop/device 身份可空。 */
  shareToken?: string
}) {
  // token 模式：无配对身份，用空值占位（bind 不依赖 deviceId/deviceKey）。
  // 旧模式：必须读到 device（配对时写入），否则兜底回配对页。
  const device = useMemo(() => loadDeviceIdentity(), [])
  if (!shareToken && !device) {
    return <PairPage onPaired={() => window.location.reload()} headerExtra={themeToggle} />
  }

  // device 可能为 null（token 模式），下面用兜底值，仅 type 兼容用。
  const deviceId = device?.deviceId ?? ''
  const deviceKey = device?.deviceKey ?? ''

  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [projectsMeta, setProjectsMeta] = useState<ProjectMeta[]>([])
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [activeModelId, setActiveModelId] = useState<string>('')
  // 输入框发送参数(对齐桌面端):权限模式 + 思考强度。默认与桌面一致。
  // UI 控件(下拉)留给子项目 B,A 阶段用默认值随消息透传,验证协议层。
  const [currentPermission, setCurrentPermission] = useState<string>('变更前确认')
  const [currentThinking, setCurrentThinking] = useState<'low' | 'medium' | 'high'>('medium')
  // 排队模式(对齐桌面 queueMode):queue=流式时排队AI结束后发,guide=中断立即发。默认 queue。
  const [currentQueueMode, setCurrentQueueMode] = useState<'queue' | 'guide'>('queue')
  // 图片附件(对齐桌面 store.draft.attachments)。App 持有状态,ChatPage 渲染 chip + 回调。
  // 发送时转成 images 透传(sendMessage opts,协议层 A 阶段已通),发完清空。
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [view, setView] = useState<View>({ kind: 'list' })
  const [inputValue, setInputValue] = useState('')

  // PWA 系统返回键接管：对话页返回 → 回列表；列表页 → 「再按一次退出」。
  // 注意 onNavigateBack 在 chat.reset 之后定义（见下），用 ref 桥接避免 TDZ；
  // 这里先声明 navigateBackRef，hook 内部读 ref。
  const navigateBackRef = useRef<() => void>(() => {})

  // 顺序耦合：useRelay 需要 onInbound，onInbound 需要 chat/dialog，
  // chat/dialog 的 send 又需要 relay.send —— 形成循环。
  // 解法：用 sendRef 桥接，hook 的 send 读 ref（运行时已就绪），
  // relay 在挂载后回填 ref。打破初始化时的 TDZ。
  const sendRef = useRef<(t: any, p: unknown) => Promise<boolean>>(async () => false)
  const sendViaRef = useCallback((t: any, p: unknown) => sendRef.current(t, p), [])

  const chat = useSessionChat({ send: sendViaRef as any })
  const dialog = useDialogQueue({ send: sendViaRef as any })

  // PWA 系统返回键：对话页返回回列表（用 chat.reset 清状态）。
  const pwaBack = usePwaBack({
    inInnerView: view.kind === 'chat',
    onNavigateBack: () => navigateBackRef.current(),
  })
  // 回填 navigateBackRef：实际「回列表」逻辑（chat.reset 在此可用）。
  navigateBackRef.current = () => {
    setView({ kind: 'list' })
    chat.reset()
  }

  const onInbound = useCallback(
    (env: Envelope) => {
      if (env.type === 'session.list') {
        const data = parseSessionListFull(env.payload)
        setSessions(data.sessions)
        setProjectsMeta(data.projectsMeta)
        return
      }
      if (env.type === 'session.created') {
        // 桌面新建会话成功回告：把新会话加入列表并自动进入该会话（用户点「＋」后无需手动刷新/点击）。
        const p = env.payload as { localSessionId: string; projectId?: string; title?: string; cwd?: string }
        const projectId = p.projectId ?? ''
        const projectName = projectsMeta.find((m) => m.projectId === projectId)?.projectName ?? ''
        const newItem: SessionListItem = {
          localSessionId: p.localSessionId,
          title: p.title ?? '新会话',
          status: 'idle',
          projectId,
          projectName,
          updatedAt: Date.now(),
        }
        setSessions((prev) => (prev.some((s) => s.localSessionId === newItem.localSessionId) ? prev : [...prev, newItem]))
        // 自动进入新会话（reset + attach + 拉历史；新会话历史为空也无妨）。
        // 用 sendViaRef 发 attach，避免依赖尚未定义的 relay（TDZ）。
        setView({ kind: 'chat', localSessionId: p.localSessionId, title: newItem.title })
        chat.reset()
        void sendViaRef('session.attach', { localSessionId: p.localSessionId })
        void chat.loadHistory(p.localSessionId)
        return
      }
      if (env.type === 'session.delta' || env.type === 'session.blocks' || env.type === 'session.result' || env.type === 'session.history' || env.type === 'session.notice') {
        // 仅当前 chat 视图对应的会话才喂给 chat hook（避免跨会话串扰）
        if (view.kind === 'chat') {
          const p = env.payload as { localSessionId?: string }
          if (p && p.localSessionId === view.localSessionId) {
            chat.onInbound(env)
          }
        }
        return
      }
      if (env.type === 'session.models') {
        const p = env.payload as { models?: { id: string; name: string }[]; activeModelId?: string }
        if (Array.isArray(p.models) && p.models.length > 0) {
          setModels(p.models)
          if (p.activeModelId) setActiveModelId(p.activeModelId)
        }
        return
      }
      if (env.type === 'dialog.request') {
        // 按会话过滤:只弹当前查看的会话的 dialog,其他会话的直接 deny(避免跨会话弹窗)。
        const d = (env.payload as any)
        const currentSid = view.kind === 'chat' ? view.localSessionId : null
        if (d?.localSessionId && currentSid && d.localSessionId !== currentSid) {
          // 非当前会话的 dialog:直接发 deny,避免桌面端挂起等待 + 不弹窗打扰用户
          void sendViaRef('dialog.response', { reqId: d.reqId, result: { behavior: 'deny' } })
          return
        }
        dialog.onInbound(env)
        return
      }
      // 其余（session.notice 等）暂不处理
    },
    [chat, dialog, view, projectsMeta, sendViaRef],
  )

  const relay = useRelay({
    relayUrl: DEFAULT_RELAY,
    deviceId,
    deviceKey,
    shareToken,
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

  // 进会话时恢复该会话的草稿(view.localSessionId 变化时触发)。
  // 切会话/退出后回来都能看到上次未发送的输入。
  useEffect(() => {
    if (view.kind === 'chat') {
      setInputValue(loadDraft(view.localSessionId))
    }
  }, [view.kind, view.kind === 'chat' ? view.localSessionId : null])

  const handleAttach = useCallback(
    (localSessionId: string) => {
      const s = sessions.find((x) => x.localSessionId === localSessionId)
      setView({ kind: 'chat', localSessionId, title: s?.title ?? '' })
      chat.reset()
      void relay.attach(localSessionId)
      // 拉取历史对话（attach 后桌面从 projects-store 读真实 messages 下发）
      void chat.loadHistory(localSessionId)
    },
    [sessions, relay, chat],
  )

  const handleCreateInProject = useCallback(
    async (projectId: string) => {
      // session.create 带上 projectId，桌面端建会话时归入该项目。
      // 桌面创建成功后会回 session.created，由 onInbound 接收并自动进入该会话（无需手动刷新）。
      await relay.send('session.create', { projectId })
    },
    [relay],
  )

  // 归档会话：发 session.archive；乐观从列表移除；若正在该会话 chat 视图则退回列表。
  // 桌面端标记 archived 后会重推 session.list，这里乐观移除让 UI 立即响应。
  const handleArchive = useCallback(
    (localSessionId: string) => {
      clearDraft(localSessionId)  // 归档后清草稿
      setSessions((prev) => prev.filter((s) => s.localSessionId !== localSessionId))
      setView((prev) => {
        if (prev.kind === 'chat' && prev.localSessionId === localSessionId) {
          chat.reset()
          return { kind: 'list' }
        }
        return prev
      })
      void relay.send('session.archive', { localSessionId })
    },
    [relay, chat],
  )

  const addImages = useCallback(async (files: File[]) => {
    const items = await Promise.all(files.map(readImageAsAttachment))
    setAttachments((prev) => [...prev, ...items])
  }, [])

  const removeImage = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // 输入时同步保存草稿到 localStorage(按会话)。每次按键直接写(文本小)。
  const handleInputChange = useCallback((v: string) => {
    setInputValue(v)
    if (view.kind === 'chat') saveDraft(view.localSessionId, v)
  }, [view])

  const handleSend = useCallback(() => {
    if (view.kind !== 'chat') return
    const text = inputValue
    const imagesToSend = attachments.length ? attachments : undefined
    void chat.sendMessage(view.localSessionId, text, {
      permission: currentPermission,
      thinking: currentThinking,
      images: imagesToSend,
      queueMode: currentQueueMode,
    }).then((ok) => {
      if (!ok) return
      setInputValue('')
      clearDraft(view.localSessionId)  // 发送后清草稿
      if (attachments.length) setAttachments([])
    })
  }, [view, inputValue, chat, currentPermission, currentThinking, attachments, currentQueueMode])

  const handleInterrupt = useCallback(() => {
    if (view.kind !== 'chat') return
    void chat.interrupt(view.localSessionId)
  }, [view, chat])

  const handleUnpair = useCallback(() => {
    relay.stop()
    clearPairingStorage()
    onUnpaired()
  }, [relay, onUnpaired])

  const handleSetActiveModel = useCallback(
    (modelId: string) => {
      void relay.send('session.setActiveModel', { modelId })
      setActiveModelId(modelId)
    },
    [relay],
  )

  // toast：列表页「再按一次退出」提示
  const exitToast = pwaBack.showExitToast ? (
    <div className="exit-toast" role="status">再按一次退出</div>
  ) : null

  if (view.kind === 'chat') {
    return (
      <>
        <ChatPage
          title={view.title || '新会话'}
          localSessionId={view.localSessionId}
          messages={chat.messages}
          running={chat.running}
          historyVersion={chat.historyVersion}
          models={models}
          activeModelId={activeModelId}
          onSetActiveModel={handleSetActiveModel}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          onSend={handleSend}
          onInterrupt={handleInterrupt}
          onBack={() => {
            setView({ kind: 'list' })
            chat.reset()
          }}
          currentDialog={dialog.current}
          onApprove={(reqId) => void dialog.approve(reqId)}
          onDeny={(reqId) => void dialog.deny(reqId)}
          currentPermission={currentPermission}
          currentThinking={currentThinking}
          onPermissionChange={setCurrentPermission}
          onThinkingChange={setCurrentThinking}
          currentQueueMode={currentQueueMode}
          queue={chat.queue}
          attachments={attachments}
          onAddImages={addImages}
          onRemoveImage={removeImage}
          editingIndex={chat.editingIndex}
          onStartEdit={chat.setEditing}
          onCancelEdit={() => chat.setEditing(null)}
          onEditResend={(index, newText) => {
            if (view.kind === 'chat') void chat.editAndResend(view.localSessionId, index, newText)
          }}
          headerExtra={themeToggle}
        />
        {exitToast}
      </>
    )
  }

  return (
    <>
      <ProjectListPage
        connected={relay.connected}
        sessions={sessions}
        projectsMeta={projectsMeta}
        onAttach={handleAttach}
        onCreateInProject={(projectId) => void handleCreateInProject(projectId)}
        onArchive={handleArchive}
        headerExtra={themeToggle}
      />
      {exitToast}
    </>
  )
}
