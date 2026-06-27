// web/src/pages/ChatPage.tsx
// PWA 对话页（Task 14）。
//
// 职责：
//   - 渲染消息序列（user / assistant）：assistant 文本走最简 markdown（粗体/行内代码/换行），
//     不引入 remark/shiki 等重依赖（Musk Algorithm：能不引就不引，手机端首屏体积敏感）。
//   - 渲染 assistant 消息的 blocks（tool_use / tool_result / plan 计划卡片）。
//   - 底部输入框 → onSend（→ session.message）；中断按钮 → onInterrupt（→ session.interrupt）。
//   - 顶部批准卡片（current dialog）→ onApprove/onDeny（→ dialog.response）。
//
// 数据由父组件（App）通过 useSessionChat / useDialogQueue 聚合后以 props 注入；
//   本页只做渲染 + 回调，传输/状态机在 hook 层（便于测试）。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AnyMessage } from '../hooks/useSessionChat'
import type { DialogRequest } from '../lib/dialog-queue'
import type { ChatBlock } from '../lib/chat-blocks'
import type { ImageAttachment } from '../lib/read-image'
import EdgeSwipeBack from '../components/EdgeSwipeBack'
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  SquareIcon,
  SendIcon,
  WrenchIcon,
  CheckIcon,
  ListIcon,
  ShieldIcon,
  QuestionIcon,
} from '../components/icons'

/** 权限模式选项(对齐桌面 InputBar.tsx:16,中文标签经主进程 getPermissionMode 翻译)。 */
const PERMISSIONS = ['变更前确认', '自动编辑', '计划模式', '完全访问'] as const
/** 思考强度选项(对齐桌面 InputBar.tsx:17)。 */
const THINKINGS = ['low', 'medium', 'high'] as const

export interface ChatPageProps {
  title: string
  /** 当前会话的 localSessionId（协议路由键）。会话切换的可靠判据（title 可能重复，如多个"新会话"）。 */
  localSessionId?: string
  messages: AnyMessage[]
  running: boolean
  /** 历史灌入计数（每次 session.history 到达 +1）。变化时强制滚动到底。默认 0。 */
  historyVersion?: number
  /** 可用模型列表（来自桌面端 session.models）。 */
  models?: { id: string; name: string }[]
  /** 当前激活模型 ID。 */
  activeModelId?: string
  /** 切换激活模型（→ session.setActiveModel）。 */
  onSetActiveModel?: (modelId: string) => void
  inputValue: string
  onInputChange: (v: string) => void
  onSend: () => void
  onInterrupt: () => void
  onBack: () => void
  /** 当前挂起的批准请求（队首）；无则不展示卡片。 */
  currentDialog?: DialogRequest | null
  onApprove?: (reqId: string) => void
  onDeny?: (reqId: string) => void
  /** 当前权限模式(对齐桌面)。B 子项目渲染下拉控件用。 */
  currentPermission?: string
  /** 当前思考强度。B 子项目渲染下拉控件用。 */
  currentThinking?: 'low' | 'medium' | 'high'
  /** 切换权限模式。B 子项目控件触发。 */
  onPermissionChange?: (permission: string) => void
  /** 切换思考强度。B 子项目控件触发。 */
  onThinkingChange?: (thinking: 'low' | 'medium' | 'high') => void
  /** 已选图片附件(App 状态)。渲染缩略图 chip。 */
  attachments?: ImageAttachment[]
  /** 选图回调(App 的 addImages)。 */
  onAddImages?: (files: File[]) => void
  /** 删除指定 index 的附件(App 的 removeImage)。 */
  onRemoveImage?: (index: number) => void
  /** 编辑重发:正在编辑的 user 消息 index(null=非编辑态)。 */
  editingIndex?: number | null
  /** 点编辑按钮进入编辑态(传该消息 index)。 */
  onStartEdit?: (index: number) => void
  /** 取消编辑。 */
  onCancelEdit?: () => void
  /** 保存编辑并重发(传 index + 新文本)。localSessionId 由 App 绑定。 */
  onEditResend?: (index: number, newText: string) => void
  /** header 右侧额外控件(主题切换等)。 */
  headerExtra?: React.ReactNode
}

/**
 * 最简行内 markdown 渲染（粗体 **x** + 行内代码 `x`）。
 * 不引依赖：手机端首屏体积敏感，复杂 markdown 待后续按需引入。
 * 仅处理行内格式，换行交给 CSS white-space: pre-wrap。
 */
function renderInline(text: string): React.ReactNode[] {
  // 先按 ** 拆粗体，再对每段按 ` 拆行内代码。
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  const out: React.ReactNode[] = []
  parts.forEach((seg, i) => {
    if (!seg) return
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      out.push(<strong key={`b${i}`}>{seg.slice(2, -2)}</strong>)
      return
    }
    // 行内代码
    const codeParts = seg.split(/(`[^`]+`)/g)
    codeParts.forEach((c, j) => {
      if (!c) return
      if (c.startsWith('`') && c.endsWith('`') && c.length > 2) {
        out.push(<code key={`c${i}-${j}`}>{c.slice(1, -1)}</code>)
        return
      }
      out.push(<React.Fragment key={`t${i}-${j}`}>{c}</React.Fragment>)
    })
  })
  return out
}

function BlockView({ block }: { block: ChatBlock }) {
  if (block.kind === 'plan') {
    return <div className="block plan-card"><ListIcon />{block.label}</div>
  }
  if (block.kind === 'tool_use') {
    return <div className="block tool-use"><WrenchIcon />{block.label}</div>
  }
  if (block.kind === 'tool_result') {
    return <div className="block tool-result"><CheckIcon />{block.label}</div>
  }
  return null
}

export default function ChatPage(props: ChatPageProps) {
  const {
    title,
    localSessionId,
    messages,
    running,
    historyVersion,
    inputValue,
    onInputChange,
    onSend,
    onInterrupt,
    onBack,
    currentDialog,
    onApprove,
    onDeny,
    headerExtra,
    models,
    activeModelId,
    onSetActiveModel,
    currentPermission,
    currentThinking,
    onPermissionChange,
    onThinkingChange,
    attachments,
    onAddImages,
    onRemoveImage,
    editingIndex,
    onStartEdit,
    onCancelEdit,
    onEditResend,
  } = props

  const canSend = inputValue.trim().length > 0

  // 原位编辑:正在编辑的文本(初始从被编辑消息取)。保存/取消时清空。
  const [editValue, setEditValue] = useState('')
  // editingIndex 变化时(进入编辑),同步 editValue 为该消息文本
  useEffect(() => {
    if (editingIndex != null && messages[editingIndex]?.role === 'user') {
      setEditValue((messages[editingIndex] as any).text || '')
    }
  }, [editingIndex, messages])

  // 图片附件菜单(拍照/相册)开合态 + 两个隐藏 file input ref
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)  // capture=environment,调相机
  const albumInputRef = useRef<HTMLInputElement | null>(null)   // 普通相册选择
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) onAddImages?.(files)
    e.target.value = ''  // 重置,允许重复选同一文件
    setShowAttachMenu(false)
  }

  // 自动滚动到底部。
  // 关键时序：进入会话时 messages 为空（历史异步加载），所以不能只在「messages 变化」时滚——
  // 要区分两种场景：
  //   ① 会话切换/历史灌入（historyVersion 变化）：强制滚到底，不看 stick
  //   ② 流式增量/新消息：仅在用户「贴在底部」时跟随，否则不打扰（显示回底按钮）
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [showJumpBottom, setShowJumpBottom] = useState(false)
  // 用户是否「贴在底部」。初始 true（进会话默认贴底）。
  const stickRef = useRef(true)
  // 上一次的会话标题 + 历史版本，用于检测切换/历史到达
  const prevTitleRef = useRef<string>(title)
  const prevHistoryRef = useRef<number>(historyVersion ?? 0)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = bodyRef.current
    if (!el || typeof el.scrollTo !== 'function') return // jsdom 无 scrollTo，真实浏览器有
    el.scrollTo({ top: el.scrollHeight, behavior })
    stickRef.current = true
    setShowJumpBottom(false)
  }, [])

  // 会话切换：无条件强制滚到底 + 重置贴底判断（对标桌面端 ChatArea 的 [activeSessionId] effect）。
  // 根因修复：原实现仅靠派生 forceBottom + stickRef，但 handleAttach→reset() 不重置这些 refs，
  // 且若用户曾在某会话向上滚过（stickRef=false），重新进入时 forceBottom 读到过期值而不滚动。
  // 这里以 localSessionId 为键独立触发，与「历史到达 forceBottom」「流式 stickRef 跟随」正交，互不干扰。
  // 同步滚动（不用 raf）：切换瞬间立刻定位底部，历史异步到达后由下方 messages effect 二次滚动修正。
  useEffect(() => {
    stickRef.current = true
    setShowJumpBottom(false)
    // 重置切换检测 refs，避免下方 forceBottom effect 在同一会话内重复触发或读到过期值。
    prevTitleRef.current = title
    prevHistoryRef.current = historyVersion ?? 0
    scrollToBottom('auto')
    // 仅以 localSessionId 为依赖：会话切换才触发，title/historyVersion 只用于重置 ref 初值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSessionId])

  // 会话切换 或 历史到达：标记需要强制滚（等下面的 messages effect 实际执行）
  const hv = historyVersion ?? 0
  const forceBottom = prevTitleRef.current !== title || prevHistoryRef.current !== hv
  useEffect(() => {
    prevTitleRef.current = title
    prevHistoryRef.current = hv
    if (forceBottom) {
      stickRef.current = true
      setShowJumpBottom(false)
    }
  }, [title, hv, forceBottom])

  // 消息变化时滚动。用 requestAnimationFrame 确保 DOM 已布局（历史灌入后高度才正确）。
  useEffect(() => {
    if (messages.length === 0) return // 空消息不滚
    const raf = requestAnimationFrame(() => {
      if (forceBottom) {
        // 首屏/历史到达/会话切换：强制滚到底
        scrollToBottom('auto')
      } else if (stickRef.current) {
        // 流式增量：仅贴底时跟随
        scrollToBottom('auto')
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [messages, running, forceBottom, scrollToBottom])

  // 滚动监听：判断是否偏离底部（>120px 视为偏离，显示回底按钮）。
  // 注意：内容撑高导致的 scroll 不会触发（只有 scrollTop 变化才触发）；用户主动滚才会。
  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < 120
    stickRef.current = atBottom
    setShowJumpBottom(!atBottom)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  // 批准请求的类型元信息：标签 + 图标 + 主问题文案（按类型差异化）
  const dialogMeta = (kind?: string): { label: string; icon: React.ReactNode; question: string } => {
    switch (kind) {
      case 'plan_proposed':
        return { label: '计划批准', icon: <ListIcon />, question: '是否批准此计划？' }
      case 'permission_request':
        return { label: '权限请求', icon: <ShieldIcon />, question: '需要你的确认' }
      case 'ask_user_question':
        return { label: '提问', icon: <QuestionIcon />, question: '需要你的确认' }
      default:
        return { label: '需要批准', icon: <ShieldIcon />, question: '需要你的确认' }
    }
  }

  return (
    <>
    <EdgeSwipeBack onBack={onBack}>
    <div className="app chat-page">
      <header className="app-header">
        <button className="icon-btn" onClick={onBack} aria-label="返回"><ArrowLeftIcon /></button>
        <div className="chat-header-title">
          <h1 className="chat-title">{title || '会话'}</h1>
          {models && models.length > 0 && (
            <select
              className="model-select"
              value={activeModelId || ''}
              onChange={(e) => onSetActiveModel?.(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="header-actions">
          {running && (
            <button className="icon-btn stop" onClick={onInterrupt} aria-label="停止">
              <SquareIcon />
            </button>
          )}
          {headerExtra}
        </div>
      </header>

      <main className="chat-body" ref={bodyRef} onScroll={onBodyScroll}>
        {messages.length === 0 && (
          <p className="hint chat-empty">还没有消息，输入开始对话</p>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') {
            // 编辑态:该消息原位变 textarea + 保存/取消
            if (editingIndex === i) {
              return (
                <div key={i} className="msg user editing">
                  <textarea
                    className="edit-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={2}
                  />
                  <div className="edit-actions">
                    <button className="edit-save-btn" onClick={() => onEditResend?.(i, editValue)}>保存</button>
                    <button className="edit-cancel-btn" onClick={() => onCancelEdit?.()}>取消</button>
                  </div>
                </div>
              )
            }
            // 找最后一条 user 消息的 index(决定是否显示编辑按钮)
            const lastUserIndex = (() => {
              for (let j = messages.length - 1; j >= 0; j--) if (messages[j].role === 'user') return j
              return -1
            })()
            const canEdit = !running && i === lastUserIndex && onEditResend
            return (
              <div key={i} className="msg user">
                <div className="msg-bubble user-bubble">{m.text}</div>
                {canEdit && (
                  <button className="edit-btn" onClick={() => onStartEdit?.(i)} aria-label="编辑">编辑</button>
                )}
              </div>
            )
          }
          return (
            <div key={i} className="msg assistant">
              <div className="msg-bubble assistant-bubble">
                {m.thinking && (
                  <details className="thinking">
                    <summary>思考</summary>
                    <div className="thinking-text">{m.thinking}</div>
                  </details>
                )}
                {m.text && <div className="assistant-text">{renderInline(m.text)}</div>}
                {m.blocks.map((b, j) => (
                  <BlockView key={j} block={b} />
                ))}
                {running && !m.text && m.blocks.length === 0 && !m.thinking && (
                  <span className="typing">…</span>
                )}
              </div>
            </div>
          )
        })}
      </main>

      {showJumpBottom && (
        <button
          className="jump-bottom-btn"
          onClick={() => scrollToBottom('smooth')}
          aria-label="回到底部"
        >
          <ArrowDownIcon />
        </button>
      )}

      <footer className="chat-input-bar">
        {(onPermissionChange || onThinkingChange) && (
          <div className="chat-input-controls">
            {onPermissionChange && (
              <select
                className="param-select"
                value={currentPermission || '变更前确认'}
                onChange={(e) => onPermissionChange(e.target.value)}
                aria-label="权限模式"
              >
                {PERMISSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {onThinkingChange && (
              <select
                className="param-select"
                value={currentThinking || 'medium'}
                onChange={(e) => onThinkingChange(e.target.value as 'low' | 'medium' | 'high')}
                aria-label="思考强度"
              >
                {THINKINGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>
        )}
        {attachments && attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((att, i) => (
              <div className="attach-chip" key={i}>
                <img src={`data:${att.mediaType};base64,${att.data}`} alt={att.name || '附件'} />
                {onRemoveImage && (
                  <button
                    className="attach-chip-remove"
                    onClick={() => onRemoveImage(i)}
                    aria-label="删除附件"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="chat-input-wrap">
          {onAddImages && (
            <>
              <button
                className="attach-add-btn"
                onClick={() => setShowAttachMenu((v) => !v)}
                aria-label="添加图片"
              >＋</button>
              {showAttachMenu && (
                <div className="attach-menu">
                  <button onClick={() => cameraInputRef.current?.click()}>拍照</button>
                  <button onClick={() => albumInputRef.current?.click()}>从相册选</button>
                </div>
              )}
              {/* 拍照:capture=environment 调起相机;相册:普通选择 */}
              <input
                ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                style={{ display: 'none' }} onChange={handleFilePick}
              />
              <input
                ref={albumInputRef} type="file" accept="image/*"
                style={{ display: 'none' }} onChange={handleFilePick}
              />
            </>
          )}
          <textarea
            className="chat-input"
            placeholder="输入消息…"
            value={inputValue}
            onChange={(e) => {
              onInputChange(e.target.value)
              // 自适应高度：重置后按 scrollHeight 设定，限制最大高度（CSS max-height 配合）
              const ta = e.target
              ta.style.height = 'auto'
              ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
            }}
            onKeyDown={onKeyDown}
            rows={1}
          />
          <button
            className="send-icon-btn"
            onClick={onSend}
            disabled={!canSend}
            aria-label="发送"
          >
            <SendIcon />
          </button>
        </div>
      </footer>
    </div>
    </EdgeSwipeBack>

    {/* 批准/权限请求：底部弹出模态（不挤压对话区） */}
    {currentDialog && (() => {
      const meta = dialogMeta(currentDialog.dialogKind)
      return (
        <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label={meta.label}>
          <div className="dialog-sheet">
            <div className="dialog-grab" aria-hidden="true" />
            <div className="dialog-sheet-head">
              <span className="dialog-kind-badge">{meta.icon}</span>
              <span className="dialog-kind">{meta.label}</span>
            </div>
            <div className="dialog-question">{meta.question}</div>
            <div className="dialog-actions">
              <button
                className="dialog-btn deny"
                onClick={() => onDeny?.(currentDialog.reqId)}
              >
                拒绝
              </button>
              <button
                className="dialog-btn approve"
                onClick={() => onApprove?.(currentDialog.reqId)}
              >
                批准
              </button>
            </div>
          </div>
        </div>
      )
    })()}
    </>
  )
}
