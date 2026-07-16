import { useState, useEffect, useRef } from 'react'
import { TitleBar } from './components/TitleBar'
import { LeftPanel } from './components/LeftPanel'
import { ChatArea } from './components/ChatArea'
import { RightPanel } from './components/RightPanel'
import { SettingsPage } from './components/settings/SettingsPage'
import { useStore, useSelector } from './state/store'
import { SearchDialog } from './components/SearchDialog'

export function App() {
  const { dispatch } = useStore()
  // 分片订阅：仅订阅 App 渲染实际需要的字段，避免流式 delta 每帧重建 projects
  // 导致 App 全量重渲染（连带 LeftPanel/RightPanel 无谓重渲染）。
  const currentView = useSelector((s) => s.currentView)
  const activeSessionId = useSelector((s) => s.activeSessionId)
  const theme = useSelector((s) => s.theme)
  const lastFileOpenedSeq = useSelector((s) => s.lastFileOpenedSeq)
  const zoom = useSelector((s) => s.settings.zoom)
  const chatWidth = useSelector((s) => s.settings.chatWidth)
  const projectName = useSelector((s) => {
    const proj = s.projects.find(p => p.sessions.some(sess => sess.id === s.activeSessionId))
    return proj?.name ?? 'cc-desk'
  })
  // projects 用于防抖保存 effect；用 ref 桥接，不在渲染路径订阅（避免每帧重渲染）
  const projectsRef = useRef<import('./types').Project[] | null>(null)
  const tabsBySession = useSelector((s) => s.tabsBySession)
  const activeTabIdBySession = useSelector((s) => s.activeTabIdBySession)
  const claudeSessionMap = useSelector((s) => s.claudeSessionMap)
  const goalBySession = useSelector((s) => s.goalBySession)
  const settingsCwd = useSelector((s) => s.settings.cwd)
  // 更新 ref（不入渲染依赖）
  useSelector((s) => { projectsRef.current = s.projects; return s.projects.length })

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)  // 右栏默认隐藏
  const [searchOpen, setSearchOpen] = useState(false)  // 全局搜索弹窗（Cmd/Ctrl+K 触发）

  // 文件树点击打开文件时，自动展开折叠的右栏。监听 lastFileOpenedSeq 计数：
  // 它只在 OPEN_FILE_TAB（文件树点击）时递增，切 tab/关 tab 不动它，
  // 故不会因无关 tab 变化误触发展开。
  useEffect(() => {
    if (lastFileOpenedSeq > 0) setRightCollapsed(false)
  }, [lastFileOpenedSeq])

  // 界面主题：始终（含设置页）把 state.theme 落到 document，并持久化。
  // 之前仅 ThemeSwitcher 内驱动，而设置页不渲染 TitleBar/ThemeSwitcher，
  // 导致在设置页改主题无效果。这里在 App 层兜底。
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cc-desk-theme', theme)
  }, [theme])

  // 应用级快捷键：Cmd+,（macOS）/ Ctrl+, 切换设置/工作区
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        if (currentView === 'settings') {
          dispatch({ type: 'SET_VIEW', view: 'workspace' })
        } else {
          dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentView, dispatch])

  // 应用级快捷键：Cmd+B（macOS）/ Ctrl+B 切换右栏，Cmd+E / Ctrl+E 切换左栏。
  // setState 的 setter 引用稳定，无需进依赖数组。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'b') {
        e.preventDefault()
        setRightCollapsed(c => !c)
      } else if (k === 'e') {
        e.preventDefault()
        setLeftCollapsed(c => !c)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 应用级快捷键：Cmd+K（macOS）/ Ctrl+K 打开全局搜索，Cmd+J / Ctrl+J 打开终端。
  // 与 Cmd+B/Cmd+E 一致：setState 引用稳定、dispatch 来自 store，均无需进依赖数组。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        setSearchOpen(o => !o)
      } else if (k === 'j') {
        e.preventDefault()
        // 从 ref 读最新 projects/settings.cwd，不触发重渲染
        const project = projectsRef.current?.find((p) =>
          p.sessions.some((sess) => sess.id === activeSessionId)
        )
        const cwd = project?.path || settingsCwd || undefined
        dispatch({ type: 'OPEN_TAB', tabType: 'terminal', ...(cwd ? { cwd } : {}) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSessionId, settingsCwd, dispatch])

  // 应用级快捷键：Cmd+N（macOS）/ Ctrl+N 新建会话。
  // projectId 取当前激活会话所属项目，无激活则回退第一个项目。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() !== 'n') return
      const active = projectsRef.current?.find(p => p.sessions.some(s => s.id === activeSessionId))
      const pid = (active ?? projectsRef.current?.[0])?.id
      if (!pid) return
      e.preventDefault()
      dispatch({ type: 'ADD_SESSION', projectId: pid })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSessionId, dispatch])

  // 设置页（currentView === 'settings'）下不渲染搜索弹窗，避免无承载视图
  useEffect(() => {
    if (currentView === 'settings') setSearchOpen(false)
  }, [currentView])

  // 界面缩放：zoom 只作用于内容区（TitleBar 之外），避免缩放自定义 titleBar
  // 导致其按钮与 macOS 原生红绿灯（不受 CSS zoom 影响）错位。
  const zoomFactor = (() => {
    const z = zoom
    return z === 'small' ? 0.85 : z === 'large' ? 1.2 : 1
  })()

  // 对话宽度：按 chatWidth 档位动态写入 CSS 变量，覆盖 index.css 的 :root 默认值
  const chatWidthPx = (() => {
    const w = chatWidth
    return w === 'compact' ? 760 : w === 'standard' ? 880 : w === 'xwide' ? 1080 : 960
  })()
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-max-width', `${chatWidthPx}px`)
  }, [chatWidthPx])

  // 工作区持久化的运行时状态：保存防抖定时器 + 是否已完成首次加载的标志
  const saveTimer = useRef<number | null>(null)
  const hydratedRef = useRef(false)

  // 启动时加载持久化设置
  useEffect(() => {
    window.api?.settings.get().then(s => {
      if (s) {
        dispatch({ type: 'SET_SETTINGS', settings: s })
        // 界面主题从设置同步（settings.theme 优先于 localStorage 的默认）
        if (s.theme) dispatch({ type: 'SET_THEME', theme: s.theme as never })
      }
    })
    // 加载持久化的工作区快照（项目/会话/消息/tab/sessionMap），注入 state
    window.api?.projects.get().then(async snap => {
      if (snap && snap.projects?.length > 0) {
        dispatch({ type: 'HYDRATE', snapshot: snap })
        // /goal resume:还原未完成(active)的 goal,计数器重置(官方:条件保留,turns/timer 重置)
        // SET_GOAL 会重置 turns/startedAt;setGoal IPC 同步主进程 goalStore,让该 session 的 Stop hook 重新激活评估
        const goals = (snap as any).goalBySession || {}
        for (const [gsid, g] of Object.entries(goals)) {
          const condition = (g as any)?.condition
          if (typeof condition === 'string' && condition) {
            dispatch({ type: 'SET_GOAL', sessionId: gsid, condition })
            window.api?.claude?.setGoal?.(gsid, condition)
          }
        }
      }
      // 无论是否恢复，加载完成后才允许保存，避免空 state 在加载前覆盖磁盘
      hydratedRef.current = true

      // 恢复仍在运行的 session：main 进程的 SDK query 刷新后仍存活，
      // 查询哪些 session 正在迭代，对它们重建 streaming 状态，
      // 把已恢复的 draft message 关联回去，让续推的新 delta 无缝追加。
      try {
        const runningIds = await window.api?.claude?.runningSessions?.()
        if (Array.isArray(runningIds) && runningIds.length > 0) {
          // 从 HYDRATE 后的 projects 里找每个 running session 的最后一条 assistant message（draft）
          const hydrated = snap && snap.projects?.length > 0 ? snap : null
          const projects = hydrated?.projects ?? []
          for (const sid of runningIds) {
            const session = projects.flatMap(p => p.sessions).find(sess => sess.id === sid)
            if (!session || session.messages.length === 0) continue
            const last = session.messages[session.messages.length - 1]
            if (last.role !== 'assistant') continue
            // 必须是「未完成的草稿」才恢复 streaming——已完成的 assistant 消息(finalize 时
            // 已带 costUSD/durationMs 等)即便主进程 query 还在收尾(runningSessions 仍返回它),
            // 也不该重建 streaming,否则刷新后输入框误显停止态、发送进队列。
            // 草稿消息无 finalize 标志;若已有任一标志,视作已完成,跳过。
            const isFinalized = last.costUSD != null || last.durationMs != null || last.turns != null
            if (isFinalized) continue
            // 把 draft message 的 content 重建为 streaming blocks
            const blocks = (last.content ?? []) as import('./state/reducer').AppState['streamingBySession'][string]['blocks']
            const notices = (last.notices ?? []) as import('./state/reducer').AppState['streamingBySession'][string]['notices']
            dispatch({ type: 'RESTORE_STREAMING', sessionId: sid, draftMessageId: last.id, blocks, notices })
            // 恢复该 session 的后台任务/subagent（main 进程 registry 仍存活）
            try {
              const tasks = await window.api?.backendTask?.list?.(sid)
              if (Array.isArray(tasks) && tasks.length > 0) {
                for (const t of tasks) {
                  dispatch({ type: 'UPSERT_BACKEND_TASK', sessionId: sid, task: t })
                }
              }
            } catch { /* backendTask.list 可能不存在,忽略 */ }
          }
        }
      } catch { /* runningSessions 可能不存在(老版本),忽略 */ }

      // 恢复刷新前未决的挂起 dialog（AskUserQuestion / ExitPlanMode / 权限请求）。
      // 主进程 dialogResolvers 仍持有 Promise、SDK 全程阻塞等待回答，刷新后渲染端
      // pendingDialog 归零会导致用户再也回不去那个卡片 → 会话死锁。这里从主进程补发。
      try {
        const dialogs = await window.api?.claude?.pendingDialogs?.()
        if (Array.isArray(dialogs) && dialogs.length > 0) {
          for (const d of dialogs) {
            if (d.localSessionId) {
              dispatch({ type: 'SHOW_DIALOG', reqId: d.reqId, sessionId: d.localSessionId,
                         dialogKind: d.dialogKind, payload: d.payload, toolUseId: d.toolUseId })
            }
          }
        }
      } catch { /* 老版本无此通道,忽略 */ }
    })
  }, [])

  // 工作区快照持久化：订阅稳定字段，debounce 落盘。
  // 流式 delta 现在会同步更新 projects.messages 里的 draft message（实时持久化），
  // 使刷新后可恢复到截断点。debounce 500ms 合并高频 delta，写压可控。
  useEffect(() => {
    // 加载未完成前不保存，防止初始化空 state 覆盖磁盘上的快照
    if (!hydratedRef.current) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      window.api?.projects.save({
        projects: projectsRef.current ?? [],
        activeSessionId,
        tabsBySession,
        activeTabIdBySession,
        claudeSessionMap,
        // /goal: 只持久化 active 的 goal 条件(achieved/cleared 不还原,官方)
        goalBySession: Object.fromEntries(
          Object.entries(goalBySession)
            .filter(([, g]) => g.status === 'active')
            .map(([k, g]) => [k, { condition: g.condition }])
        ),
      })
    }, 500)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [
    projectsRef,
    activeSessionId,
    tabsBySession,
    activeTabIdBySession,
    claudeSessionMap,
    goalBySession,
  ])

  // 自动归档：监听主进程定时信号，清理陈旧空会话
  useEffect(() => {
    // onArchiveTick 返回 unsubscribe；返回它作 cleanup，避免重 mount 时监听器累加
    const unsubscribe = window.api?.onArchiveTick?.(({ beforeTs }) => {
      dispatch({ type: 'ARCHIVE_STALE', beforeTs })
    })
    return () => { unsubscribe?.() }
  }, [dispatch])

  // 远程控制同步：手机在远程新建/归档会话时，主进程直接改了 projects.json（绕过 reducer）。
  // 收到 workspace:changed 后重新拉快照并 HYDRATE，让桌面 UI 与远程操作保持一致。
  // HYDRATE 幂等（含存活会话挑选与孤儿清理）；不重跑 running session 恢复（远程增删不影响在跑会话态）。
  useEffect(() => {
    const unsubscribe = window.api?.projects?.onWorkspaceChanged?.(() => {
      console.warn('[workspace-changed] 触发 HYDRATE')
      window.api?.projects.get().then(snap => {
        if (snap && snap.projects?.length >= 0) {
          dispatch({ type: 'HYDRATE', snapshot: snap })
        }
      })
    })
    return () => { unsubscribe?.() }
  }, [dispatch])

  // 远程（手机）发来的 user 文本：dispatcher 收到 session.message 时经
  // claude:remote-user-message 推来。dispatch REMOTE_USER_MESSAGE 把这条 user 消息
  // 加入对应会话，让桌面端对话里除了 AI 回复也能看到「手机问的问题」。
  // 目标会话节点不存在时 reducer 静默（等 HYDRATE 校正），不报错。
  useEffect(() => {
    const unsubscribe = window.api?.claude?.onRemoteUserMessage?.((data) => {
      console.warn('[remote-user-msg] renderer 收到:', data?.localSessionId, String(data?.text ?? '').slice(0, 50))
      if (data?.localSessionId && typeof data.text === 'string') {
        dispatch({ type: 'REMOTE_USER_MESSAGE', sessionId: data.localSessionId, text: data.text })
      }
    })
    return () => { unsubscribe?.() }
  }, [dispatch])

  // SDK user turn 的纯文本(claude:user-message):user 消息与 assistant 走同源持久化路径。
  // 这是 user 消息可靠落盘的来源(本地+远程发消息都经 SDK 回放)。复用 REMOTE_USER_MESSAGE
  // 的 reducer action,reducer 内按「末条相同文本 user」去重,避免与本地 echo/remote 补丁重复。
  useEffect(() => {
    const unsubscribe = window.api?.claude?.onUserMessage?.((data) => {
      if (data?.localSessionId && typeof data.text === 'string') {
        dispatch({ type: 'REMOTE_USER_MESSAGE', sessionId: data.localSessionId, text: data.text })
      }
    })
    return () => { unsubscribe?.() }
  }, [dispatch])

  // /goal: Stop hook 每轮评估后下发 reason/turns,联动 reducer 更新目标卡片。
  useEffect(() => {
    window.api?.claude?.onGoalEvaluated?.((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      dispatch({ type: 'GOAL_EVALUATED', sessionId: sid, reason: data.reason, turns: data.turns })
    })
  }, [dispatch])

  // /goal: 评估判定达成时下发,联动 reducer 标记 status='achieved'。
  useEffect(() => {
    window.api?.claude?.onGoalAchieved?.((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      dispatch({ type: 'GOAL_ACHIEVED', sessionId: sid })
    })
  }, [dispatch])

  // /goal 远程设/清：手机端发 /goal set/clear 时，主进程推 claude:goal-set-by-remote
  // 让桌面渲染端同步状态卡片（condition=null 表示清除 → CLEAR_GOAL）。
  useEffect(() => {
    window.api?.claude?.onGoalSetByRemote?.((data: any) => {
      const sid = data?.localSessionId
      if (!sid) return
      if (data.condition == null) {
        dispatch({ type: 'CLEAR_GOAL', sessionId: sid })
      } else {
        dispatch({ type: 'SET_GOAL', sessionId: sid, condition: data.condition })
      }
    })
  }, [dispatch])

  // 应用更新状态：订阅主进程状态机推送（单次挂载，cleanup 取消订阅防泄漏）
  useEffect(() => {
    const unsubscribe = window.api?.update?.onState?.((status) => {
      dispatch({ type: 'UPDATE_STATUS', status })
    })
    return () => { unsubscribe?.() }
  }, [dispatch])

  // 视图保活：切到设置页时不 unmount workspace（否则右栏 TerminalTab 的 cleanup 会
  // pty.kill 杀掉终端进程，切回后只剩空壳）。workspace 用 display:none 隐藏而非卸载，
  // 与 TabBar 对 tab 的保活范式一致；TerminalTab 的 ResizeObserver 会处理恢复后的 refit。
  return (
    <>
      <div style={{
        display: currentView === 'workspace' ? 'flex' : 'none',
        flexDirection: 'column',
        height: '100%',
      }}>
        <TitleBar
          projectName={projectName}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          onToggleLeft={() => setLeftCollapsed(c => !c)}
          onToggleRight={() => setRightCollapsed(c => !c)}
        />
        <div style={{ flex: 1, display: 'flex', minHeight: 0, zoom: zoomFactor }}>
          <LeftPanel
            collapsed={leftCollapsed}
            onOpenSearch={() => setSearchOpen(true)}
          />
          <ChatArea />
          <RightPanel collapsed={rightCollapsed} />
        </div>
        {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      </div>
      {currentView === 'settings' && <SettingsPage />}
    </>
  )
}
