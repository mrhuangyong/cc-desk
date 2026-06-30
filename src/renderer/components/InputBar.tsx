import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Paperclip, AtSign, Check, ShieldCheck, ChevronDown, ArrowUp, Square, Folder, FolderPlus } from 'lucide-react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { AttachmentChip } from './AttachmentChip'
import { PromptEditor } from '../editor/PromptEditor'
import { serializeForPrompt } from '../editor/serialize'
import { parseGoalCommand } from '../editor/goalParse'
import { runBuiltin } from './builtinCommands'
import { Tooltip } from './Tooltip'
import { ContextUsageRing, parseContextLength } from './ContextUsageRing'
import type { SlashMenuItem } from '../editor/types'
import type { DraftAttachment } from '../types'

type MenuId = 'permission' | 'model' | 'thinking' | 'project' | 'add'

const PERMISSIONS = ['变更前确认', '自动编辑', '计划模式', '完全访问']
const THINKINGS: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']

// 把文本类附件（网页元素/文件路径）拼进 prompt。图片不在此处理——
// 图片走专门的 images 字段透传到主进程，构造 image content block 给 SDK（见 collectImages）。
export function buildPromptWithAttachments(prompt: string, attachments: DraftAttachment[]): string {
  const textAttachments = attachments.filter(a => a.type !== 'image')
  if (textAttachments.length === 0) return prompt
  const context = textAttachments.map((att, index) => {
    const n = index + 1
    if (att.type === 'pickedElement') {
      const el = att.el
      return [
        `[网页元素 ${n}]`,
        `来源: ${el.source}`,
        `标签: ${el.tag}`,
        `选择器: ${el.selector}`,
        `文本: ${el.text || '(无文本)'}`,
        `HTML: ${el.html}`,
      ].join('\n')
    }
    // file
    return [`[文件 ${n}]`, `名称: ${att.name}`, `路径: ${att.path}`].join('\n')
  }).join('\n\n')
  const prefix = prompt.trim() ? `${prompt.trim()}\n\n` : ''
  return `${prefix}以下是用户随消息附加的上下文，请一并参考：\n\n${context}`
}

// 从附件中提取图片，转成发送给主进程的格式（data 为纯 base64）。
export function collectImages(attachments: DraftAttachment[]): { mediaType: string; data: string; name?: string }[] {
  return attachments
    .filter((a): a is Extract<DraftAttachment, { type: 'image' }> => a.type === 'image')
    .map(a => ({ mediaType: a.mediaType, data: a.base64, name: a.name }))
}

export function InputBar() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()
  const [draftDoc, setDraftDoc] = useState(state.draft.doc)
  // draft.attachments 仍以全局 store 为单一真相源：BrowserTab 的元素拾取经
  // ADD_DRAFT_ATTACHMENT 写 store，本地粘贴/删除也 dispatch 回 store，InputBar 的本地
  // state 只是镜像。切会话时重置；store 变化时同步（这样外部入口的拾取能即时反映为 chip）。
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>(state.draft.attachments)

  useEffect(() => {
    setDraftDoc(state.draft.doc)
    setOpenMenu(null)
  }, [state.activeSessionId])

  // store.attachments 变化时同步到本地镜像（BrowserTab 拾取 / 远程写入 / 切会话残留都会经此生效）。
  useEffect(() => {
    setDraftAttachments(state.draft.attachments)
  }, [state.draft.attachments])

  // / 菜单全量缓存：组件 mount 时拉命令+技能，转成 SlashMenuItem[]
  const [allSlashItems, setAllSlashItems] = useState<SlashMenuItem[]>([])
  useEffect(() => {
    Promise.all([
      window.api?.cc?.commands?.get() ?? Promise.resolve([]),
      window.api?.cc?.skills?.get() ?? Promise.resolve([]),
    ]).then(([cmds, skills]) => {
      const cmdItems: SlashMenuItem[] = (cmds ?? []).map((c: any) => ({
        // 内置命令保留 kind='builtin' + builtinAction；插件/用户命令默认 'command'
        kind: c.kind === 'builtin' ? 'builtin' : 'command',
        id: c.id, name: c.name, desc: c.desc ?? '',
        ...(c.builtinAction ? { builtinAction: c.builtinAction } : {}),
      }))
      const skillItems: SlashMenuItem[] = (skills ?? []).map((s: any) => ({
        kind: 'skill', id: s.id, name: s.name, desc: s.desc ?? '',
      }))
      setAllSlashItems([...cmdItems, ...skillItems])
    })
  }, [])

  // @ 菜单的 cwd 基点：当前会话所属项目的 path，回退 settings.cwd
  const project = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const cwd = project?.path || state.settings?.cwd || ''
  const getCwd = useCallback(() => cwd, [cwd])

  // 会话级权限/思考：读会话字段，undefined 时用默认。
  // 从已找到的 project 内取 session，避免对全量 projects 再做一次 flatMap 扫描。
  const activeSession = project?.sessions.find(s => s.id === state.activeSessionId)
  const permission = activeSession?.permissionMode ?? '变更前确认'
  const thinking: 'low' | 'medium' | 'high' = activeSession?.thinking ?? 'medium'

  // 粘贴/拖拽的图片/文件 → 走附件通道（写回 store，保持与拾取入口一致的单一真相源）
  const onPasteFiles = (files: File[]) => {
    files.forEach(f => {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] ?? ''
          dispatch({ type: 'ADD_DRAFT_ATTACHMENT', attachment: { type: 'image', name: f.name, base64, mediaType: f.type } })
        }
        reader.readAsDataURL(f)
      } else {
        dispatch({ type: 'ADD_DRAFT_ATTACHMENT', attachment: { type: 'file', name: f.name, path: f.name } })
      }
    })
  }

  // 系统文件选择器：点击附件按钮触发
  const pickFiles = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      onPasteFiles(files)
    }
    input.click()
  }

  // 当前会话的流式状态：决定发送/停止三态
  const streaming = state.streamingBySession[state.activeSessionId]
  const isStreaming = !!streaming

  // 拉取当前会话的上下文用量（SDK getContextUsage），刷新进度环。
  // 查询失败/会话不存在时写入 null（显示「未知」态）。
  const refreshContextUsage = (sessionId: string) => {
    const fn = window.api?.claude?.contextUsage
    if (typeof fn !== 'function') return
    fn(sessionId).then((u: any) => {
      dispatch({ type: 'SET_CONTEXT_USAGE', sessionId, usage: u ?? null })
    }).catch(() => { /* ignore */ })
  }
  // 主进程在每轮对话结束（for-await 退出前、control 通道仍活着）主动推送真实 usage，
  // 订阅它更新 store——这是最准确的数据源（循环外再查 control 命令已不可用）。
  useEffect(() => {
    const off = window.api?.claude?.onContextUsage?.((data: any) => {
      if (data?.localSessionId && data.usage) {
        dispatch({ type: 'SET_CONTEXT_USAGE', sessionId: data.localSessionId, usage: data.usage })
      }
    })
    return () => { off?.() }
  }, [])
  // 会话切换时主动查一次：能立刻显示该会话上次缓存值（若 sq 仍存活），
  // 否则等用户发消息后主进程推送。
  useEffect(() => { refreshContextUsage(state.activeSessionId) }, [state.activeSessionId])

  // 模型列表来自 cc-desk 多供应商配置（仅 enabled 模型），本地 state 持有
  // contextLength 用于上下文进度环的 maxTokens 兜底（SDK getContextUsage 的 maxTokens 缺失时）。
  const [modelCfg, setModelCfg] = useState<{ models: { id: string; name: string; contextLength?: string }[]; activeModelId: string } | null>(null)
  useEffect(() => {
    window.api?.ccDesk.model.get().then(c => setModelCfg({
      models: c.models.filter((m: any) => m.enabled).map((m: any) => ({ id: m.id, name: m.sdkModelId, contextLength: m.contextLength })),
      activeModelId: c.activeModelId,
    }))
  }, [])

  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [editorRef, setEditorRef] = useState<any>(null)

  // 新建/切换会话时自动聚焦输入框
  useEffect(() => {
    if (!editorRef) return
    const timer = setTimeout(() => editorRef.commands.focus('end'), 50)
    return () => clearTimeout(timer)
  }, [state.activeSessionId, editorRef])

  // 序列化 doc 得到纯文本预览：canSend 与 doSend 都用它
  const promptPreview = useMemo(() => serializeForPrompt(draftDoc), [draftDoc])
  const canSend = promptPreview.trim().length > 0 || draftAttachments.length > 0
  const clearLocalDraft = () => {
    setDraftDoc(null)
    setDraftAttachments([])
  }

  // 发送：追加用户消息 + 标记会话进入流式 + IPC 调用主进程
  const handleSend = () => {
    // 空 prompt 且无附件：不发
    if (!promptPreview.trim() && draftAttachments.length === 0) return
    // 流式中：按 queueMode 处理
    if (isStreaming) {
      if (state.settings.queueMode === 'guide') {
        // 引导模式：立即中断当前任务并发送
        window.api?.claude?.stop(state.activeSessionId)
        setTimeout(() => doSend(), 200)
      } else {
        // 队列模式：消息进排队列表，AI 完成后自动发送
        dispatch({ type: 'ENQUEUE_MESSAGE', sessionId: state.activeSessionId, prompt: promptPreview, attachments: draftAttachments })
        clearLocalDraft()
      }
      return
    }
    doSend()
  }

  // 队列：当前会话的排队消息
  const queue = state.queueBySession[state.activeSessionId] ?? []
  // 队列自动消费：当前会话非流式 + 队列非空 → 自动发送队首
  useEffect(() => {
    if (isStreaming || queue.length === 0) return
    const next = queue[0]
    const claudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
    const cwd = project?.path || state.settings?.cwd || undefined
    const doc = next.prompt
      ? { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: next.prompt }] }] }
      : null
    dispatch({ type: 'SEND_MESSAGE_WITH_DRAFT', doc, attachments: next.attachments })
    dispatch({ type: 'DEQUEUE_MESSAGE', sessionId: state.activeSessionId, queueId: next.id })
    dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
    window.api?.claude?.send({ prompt: buildPromptWithAttachments(next.prompt, next.attachments), images: collectImages(next.attachments), localSessionId: state.activeSessionId, sessionId: claudeSessionId || undefined, cwd, permission, thinking, extraDirs: activeSession?.extraDirs })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, queue.length])

  // 立即发送指定排队项：中断当前 → 移除该项 → 发送
  const sendQueuedNow = (queueId: string) => {
    const qm = queue.find(q => q.id === queueId)
    if (!qm) return
    window.api?.claude?.stop(state.activeSessionId)
    dispatch({ type: 'DEQUEUE_MESSAGE', sessionId: state.activeSessionId, queueId })
    // 清理前一次任务规划的任务列表、计划状态、后台任务，让 Claude 从干净上下文开始处理新消息
    dispatch({ type: 'CLEAR_TASKS', sessionId: state.activeSessionId })
    dispatch({ type: 'DISMISS_PLAN', sessionId: state.activeSessionId })
    dispatch({ type: 'CLEAR_BACKEND_TASKS', sessionId: state.activeSessionId })
    setTimeout(() => {
      const claudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
      const cwd = project?.path || state.settings?.cwd || undefined
      const doc = qm.prompt ? { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: qm.prompt }] }] } : null
      dispatch({ type: 'SEND_MESSAGE_WITH_DRAFT', doc, attachments: qm.attachments })
      dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
      window.api?.claude?.send({ prompt: buildPromptWithAttachments(qm.prompt, qm.attachments), images: collectImages(qm.attachments), localSessionId: state.activeSessionId, sessionId: claudeSessionId || undefined, cwd, permission, thinking, extraDirs: activeSession?.extraDirs })
    }, 200)
  }

  const doSend = () => {
    const prompt = serializeForPrompt(draftDoc)
    if (!prompt.trim() && draftAttachments.length === 0) return
    // 宿主级内置命令（/export /add-dir）：Claude 不认识，选中引用后发送时由宿主执行，
    // 不发给模型。精确匹配 /name。
    // 注意：/init 不在此列——它是 Claude 原生指令，普通发送给 Claude 它自己就会执行
    // （探索项目 + 写 CLAUDE.md）。早期实现把 /init 也走宿主 runBuiltin（runSideQuery 旁路生成），
    // 经代理卡死且偏离原生行为，故 /init 改回普通发送。
    const trimmed = prompt.trim()
    // /goal 三态:set 立即发条件启动 + 记 goal;check 弹状态卡片;clear 清 goal + 中断。
    // 放在 hostBuiltin 之前:/goal 带参数,需前缀解析而非精确匹配。
    const goalCmd = parseGoalCommand(trimmed)
    if (goalCmd) {
      if (goalCmd.kind === 'check') {
        dispatch({ type: 'SHOW_GOAL_STATUS', sessionId: state.activeSessionId })
        clearLocalDraft()
        return
      }
      if (goalCmd.kind === 'clear') {
        dispatch({ type: 'CLEAR_GOAL', sessionId: state.activeSessionId })
        window.api?.claude?.clearGoal?.(state.activeSessionId)  // 同步主进程 goalStore,Stop hook 不再评估
        window.api?.claude?.stop(state.activeSessionId)
        clearLocalDraft()
        return
      }
      // set: 记 goal + 立即把【条件文本】(不含 /goal 前缀)作为 prompt 发给 Claude 启动第一轮。
      // 官方语义:条件本身作为 directive。不能 fall-through 到下方通用流(那条用 prompt,含 /goal 前缀)。
      dispatch({ type: 'SET_GOAL', sessionId: state.activeSessionId, condition: goalCmd.condition })
      window.api?.claude?.setGoal?.(state.activeSessionId, goalCmd.condition)  // 同步主进程 goalStore,激活 Stop hook 评估
      const goalClaudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
      const goalCwd = project?.path || state.settings?.cwd || undefined
      dispatch({ type: 'SEND_MESSAGE_WITH_DRAFT', doc: draftDoc, attachments: draftAttachments })
      dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
      window.api?.claude?.send({
        prompt: buildPromptWithAttachments(goalCmd.condition, draftAttachments),
        images: collectImages(draftAttachments),
        localSessionId: state.activeSessionId,
        sessionId: goalClaudeSessionId || undefined,
        cwd: goalCwd,
        permission,
        thinking,
        extraDirs: activeSession?.extraDirs,
      })
      clearLocalDraft()
      return
    }
    const hostBuiltin = allSlashItems.find(
      it => it.kind === 'builtin' && it.builtinAction
        && ['export-session', 'add-dir'].includes(it.builtinAction.type)
        && trimmed === it.name,
    )
    if (hostBuiltin) {
      runBuiltin(hostBuiltin, {
        dispatch, sessionId: state.activeSessionId, cwd: getCwd(), modelName,
        claudeSessionId: state.claudeSessionMap?.[state.activeSessionId],
        toggleMenu, editor: editorRef,
      })
      dispatch({ type: 'SEND_MESSAGE_WITH_DRAFT', doc: draftDoc, attachments: draftAttachments })
      clearLocalDraft()
      return
    }
    // 取当前本地会话映射到的 Claude 真实 sessionId；存在则 resume 续接，否则新建会话
    const claudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
    // 工作目录优先取当前激活会话所属项目的 path，回退到全局设置 cwd。
    const cwd = project?.path || state.settings?.cwd || undefined
    dispatch({ type: 'SEND_MESSAGE_WITH_DRAFT', doc: draftDoc, attachments: draftAttachments })
    dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
    window.api?.claude?.send({
      prompt: buildPromptWithAttachments(prompt, draftAttachments),
      images: collectImages(draftAttachments),
      localSessionId: state.activeSessionId,
      sessionId: claudeSessionId || undefined,
      cwd,
      permission,
      thinking,
      extraDirs: activeSession?.extraDirs,
    })
    clearLocalDraft()
  }

  // 停止：IPC 中断主进程的 Claude 调用
  const handleStop = () => {
    window.api?.claude?.stop(state.activeSessionId)
  }

  const onSendClick = () => {
    if (!canSend) {
      if (isStreaming) handleStop()
      return
    }
    // 有内容时，无论是否流式都走 handleSend（queue/guide 分支会接管流式情况）
    handleSend()
  }

  const toggleMenu = (id: MenuId) => setOpenMenu(prev => (prev === id ? null : id))

  // builtin-result 回填：主进程 compact 完成后通过 IPC 推回 summary。
  // preload 的 onBuiltinResult 用 ipcRenderer.on，无去重——用 ref + mount-only effect 避免累积 listener。
  const builtinResultHandlerRef = useRef<(data: any) => void>(() => {})
  builtinResultHandlerRef.current = (data: any) => {
    // 不按 activeSessionId 过滤：compact 是异步的，结果返回前用户可能已切到别的会话。
    // COMPACT_DONE 按 data.localSessionId 路由，会正确更新触发压缩的那个会话，不会串台。
    if (data.op === 'compact' && data.summary && data.keepRecent) {
      dispatch({ type: 'COMPACT_DONE', sessionId: data.localSessionId, summary: data.summary, keepRecent: data.keepRecent })
    }
    // add-dir 的 ADD_SESSION_DIR 已在 runBuiltin 里发，这里不重复
  }
  useEffect(() => {
    const handler = (data: any) => builtinResultHandlerRef.current(data)
    window.api?.claude?.onBuiltinResult(handler)
  }, [])

  // 模型列表来自 cc-desk 多供应商配置（仅 enabled）；当前模型即 activeModelId
  const enabledModels = modelCfg?.models ?? []
  const activeModel = enabledModels.find(m => m.id === (modelCfg?.activeModelId ?? ''))
  const modelName = activeModel?.name ?? t('input.model')
  const selectModel = (id: string) => {
    setModelCfg(prev => prev ? { ...prev, activeModelId: id } : prev)
    window.api?.ccDesk.model.save({ activeModelId: id })
    setOpenMenu(null)
  }

  // 空会话判断:无消息时显示项目选择下拉框,发送首条消息后关联固定、不再显示
  const isEmptySession = (activeSession?.messages.length ?? 1) === 0

  // 添加新项目(复用系统目录选择器)
  const handleAddProject = async () => {
    setOpenMenu(null)
    const dirPath = await window.api?.dialog.openDirectory()
    if (!dirPath) return
    const name = dirPath.split('/').pop() || dirPath
    dispatch({ type: 'ADD_PROJECT', name, path: dirPath })
  }

  // 通用下拉菜单容器
  const menuStyle: React.CSSProperties = {
    position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
    background: 'var(--surface-1)',
    borderRadius: 10, boxShadow: 'var(--shadow-float)',
    padding: 5, minWidth: 180, zIndex: 100,
  }
  const itemStyle: React.CSSProperties = {
    padding: '8px 10px', borderRadius: 6, color: 'var(--text)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    cursor: 'pointer', fontSize: 12,
  }
  const btnBase: React.CSSProperties = {
    padding: '5px 9px', borderRadius: 7, background: 'transparent',
    border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  }

  // 流式时过滤掉 compact（压缩进行中会破坏流）；其他命令照常
  const slashItems = isStreaming
    ? allSlashItems.filter(i => !(i.kind === 'builtin' && i.builtinAction?.type === 'compact'))
    : allSlashItems

  return (
    <div style={{
      background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-float)',
      // 不用 overflow:hidden——否则向上展开的下拉菜单会被裁掉
    }}>
      {/* 排队消息列表（queue 模式，AI 流式中发送的消息在此等待） */}
      {queue.length > 0 && (
        <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border-hair)', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
          {queue.map((qm, i) => (
            <div key={qm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg-hover)', borderRadius: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>#{i + 1}</span>
              {state.editingQueueId === qm.id ? (
                <>
                  <input
                    type="text"
                    defaultValue={qm.prompt}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                      if (e.key === 'Escape') { dispatch({ type: 'SET_EDITING_QUEUE', queueId: null }) }
                    }}
                    style={{ flex: 1, padding: '2px 6px', fontSize: 12, border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--surface-1)', color: 'var(--text)' }}
                  />
                  <button
                    onClick={(e) => {
                      const val = ((e.currentTarget.parentElement?.querySelector('input')) as HTMLInputElement)?.value?.trim() ?? qm.prompt
                      if (val) dispatch({ type: 'UPDATE_QUEUED_MESSAGE', sessionId: state.activeSessionId, queueId: qm.id, prompt: val })
                      dispatch({ type: 'SET_EDITING_QUEUE', queueId: null })
                    }}
                    title="保存"
                    style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--accent)', color: 'var(--accent-text)' }}
                  >保存</button>
                  <button
                    onClick={() => dispatch({ type: 'SET_EDITING_QUEUE', queueId: null })}
                    title="取消"
                    style={{ padding: '0 6px', fontSize: 13, lineHeight: 1, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}
                  >×</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{qm.prompt || '(空消息)'}</span>
                  <button
                    onClick={() => sendQueuedNow(qm.id)}
                    title="中断当前任务并立即发送"
                    style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--accent)', color: 'var(--accent-text)' }}
                  >立即</button>
                  <button
                    onClick={() => dispatch({ type: 'SET_EDITING_QUEUE', queueId: qm.id })}
                    title="编辑"
                    style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--text-muted)' }}
                  >编辑</button>
                  <button
                    onClick={() => dispatch({ type: 'DEQUEUE_MESSAGE', sessionId: state.activeSessionId, queueId: qm.id })}
                    title="取消排队"
                    style={{ padding: '0 6px', fontSize: 13, lineHeight: 1, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}
                  >×</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {/* 上方 chip 栏：粘贴/拖拽的附件 */}
      {draftAttachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px 0' }}>
          {draftAttachments.map((att, i) => (
            <AttachmentChip
              key={i}
              attachment={att}
              onRemove={() => dispatch({ type: 'REMOVE_DRAFT_ATTACHMENT', index: i })}
            />
          ))}
        </div>
      )}
      {/* 编辑区：TipTap */}
      <div
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer?.files ?? [])
          if (files.length > 0) { e.preventDefault(); onPasteFiles(files) }
        }}
        onDragOver={(e) => e.preventDefault()}
        style={{ position: 'relative', minHeight: 48, padding: '14px 16px 8px' }}
      >
        <PromptEditor
          doc={draftDoc}
          placeholder={t('input.placeholder')}
          allSlashItems={slashItems}
          getCwd={getCwd}
          onDocChange={setDraftDoc}
          onPasteFiles={onPasteFiles}
          onSend={onSendClick}
          onEditorReady={setEditorRef}
          onBuiltinRun={(item) => runBuiltin(item, {
            dispatch,
            sessionId: state.activeSessionId,
            cwd: getCwd(),
            modelName,
            claudeSessionId: state.claudeSessionMap?.[state.activeSessionId],
            toggleMenu,
            editor: editorRef,
          })}
        />
      </div>

      {/* 控件栏 */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 6, position: 'relative' }}>
        {/* 点外部关闭层 */}
        {openMenu && (
          <div
            onClick={() => setOpenMenu(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 90 }}
          />
        )}

        {/* 左下组 */}
        <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
          {/* 项目选择下拉框:仅空会话显示。发送首条消息后关联固定,不再显示。 */}
          {isEmptySession && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => toggleMenu('project')}
                style={{ ...btnBase, background: openMenu === 'project' ? 'var(--bg-hover)' : undefined, color: openMenu === 'project' ? 'var(--text)' : undefined }}
              >
                <Folder size={13} /><span>{project?.name ?? '选择项目'}</span><ChevronDown size={10} />
              </button>
              {openMenu === 'project' && (
                <div style={menuStyle}>
                  {state.projects.map(p => (
                    <div
                      key={p.id}
                      style={{
                        ...itemStyle,
                        background: p.id === project?.id ? 'var(--bg-hover)' : 'transparent',
                      }}
                      onClick={() => {
                        if (p.id !== project?.id) {
                          dispatch({ type: 'MOVE_SESSION', sessionId: state.activeSessionId, toProjectId: p.id })
                        }
                        setOpenMenu(null)
                      }}
                      onMouseEnter={e => { if (p.id !== project?.id) e.currentTarget.style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (p.id !== project?.id) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Folder size={12} style={{ color: 'var(--text-muted)' }} />
                        {p.name}
                      </span>
                      {p.id === project?.id && <Check size={13} />}
                    </div>
                  ))}
                  <div style={{ height: 1, background: 'var(--border-hair)', margin: '4px 0' }} />
                  <div
                    style={{ ...itemStyle, color: 'var(--text-muted)' }}
                    onClick={handleAddProject}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <FolderPlus size={12} /> 打开新项目
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 添加按钮：加号图标,展开菜单(添加附件 / @ 提及 / / 命令) */}
          <div style={{ position: 'relative' }}>
            <Tooltip label="添加">
            <button
              onClick={() => toggleMenu('add')}
              style={{ ...btnBase, background: openMenu === 'add' ? 'var(--bg-hover)' : undefined, color: openMenu === 'add' ? 'var(--text)' : undefined }}
            >
              <Plus size={14} />
            </button>
            </Tooltip>
            {openMenu === 'add' && (
              <div style={menuStyle}>
                <div
                  style={itemStyle}
                  onClick={() => { setOpenMenu(null); pickFiles() }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Paperclip size={13} style={{ color: 'var(--text-muted)' }} /> 添加附件
                  </span>
                </div>
                <div
                  style={itemStyle}
                  onClick={() => {
                    setOpenMenu(null)
                    editorRef?.commands?.focus?.()
                    editorRef?.commands?.insertContent('@')
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <AtSign size={13} style={{ color: 'var(--text-muted)' }} /> 插入 @ 提及
                  </span>
                </div>
                <div
                  style={itemStyle}
                  onClick={() => {
                    setOpenMenu(null)
                    editorRef?.commands?.focus?.()
                    editorRef?.commands?.insertContent('/')
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 13, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 15, lineHeight: 1 }}>/</span> 插入 / 命令
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 权限按钮 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => toggleMenu('permission')}
              style={{ ...btnBase, background: 'var(--bg-hover)', color: 'var(--text)' }}
            >
              <ShieldCheck size={13} /><span>{permission}</span><ChevronDown size={10} />
            </button>
            {openMenu === 'permission' && (
              <div style={menuStyle}>
                {PERMISSIONS.map(p => (
                  <div
                    key={p}
                    style={{
                      ...itemStyle,
                      background: p === permission ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => { dispatch({ type: 'SET_SESSION_PERMISSION', sessionId: state.activeSessionId, permissionMode: p }); setOpenMenu(null) }}
                    onMouseEnter={e => { if (p !== permission) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (p !== permission) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>{p}</span>
                    {p === permission && <Check size={13} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右下组 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* 上下文用量进度环（模型选择按钮左侧） */}
          <ContextUsageRing
            usage={state.contextUsageBySession?.[state.activeSessionId] ?? null}
            maxContextFallback={parseContextLength(activeModel?.contextLength)}
          />
          {/* 模型按钮 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => toggleMenu('model')}
              style={{ ...btnBase, background: openMenu === 'model' ? 'var(--bg-hover)' : undefined, color: openMenu === 'model' ? 'var(--text)' : undefined }}
            >
              <span>{modelName}</span><ChevronDown size={10} />
            </button>
            {openMenu === 'model' && (
              <div style={{ ...menuStyle, minWidth: 200 }}>
                {enabledModels.map(m => (
                  <div
                    key={m.id}
                    style={{
                      ...itemStyle,
                      background: m.id === (modelCfg?.activeModelId ?? '') ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => selectModel(m.id)}
                    onMouseEnter={e => { if (m.id !== (modelCfg?.activeModelId ?? '')) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (m.id !== (modelCfg?.activeModelId ?? '')) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>{m.name}</span>
                    {m.id === (modelCfg?.activeModelId ?? '') && <Check size={13} />}
                  </div>
                ))}
                {enabledModels.length === 0 && (
                  <div style={{ ...itemStyle, color: 'var(--text-muted)' }}>无可用模型</div>
                )}
              </div>
            )}
          </div>

          {/* 思考强度按钮 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => toggleMenu('thinking')}
              style={{ ...btnBase, background: openMenu === 'thinking' ? 'var(--bg-hover)' : undefined, color: openMenu === 'thinking' ? 'var(--text)' : undefined }}
            >
              <span>思考:{thinking}</span><ChevronDown size={10} />
            </button>
            {openMenu === 'thinking' && (
              <div style={menuStyle}>
                {THINKINGS.map(t => (
                  <div
                    key={t}
                    style={{
                      ...itemStyle,
                      background: t === thinking ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => { dispatch({ type: 'SET_SESSION_THINKING', sessionId: state.activeSessionId, thinking: t }); setOpenMenu(null) }}
                    onMouseEnter={e => { if (t !== thinking) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (t !== thinking) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span>{t}</span>
                    {t === thinking && <Check size={13} />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 发送钮三态 */}
          <Tooltip label={isStreaming && !canSend ? t('input.stop') : t('input.send')}>
          <button
            onClick={onSendClick}
            aria-label={isStreaming && !canSend ? t('input.stop') : t('input.send')}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: canSend ? 'var(--accent)' : isStreaming ? 'var(--accent)' : 'var(--bg-hover)',
              color: canSend ? 'var(--accent-text)' : isStreaming ? 'var(--accent-text)' : 'var(--text-faint)',
              border: 'none', cursor: canSend || isStreaming ? 'pointer' : 'not-allowed',
              padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, lineHeight: 1,
            }}
          >
            {isStreaming && !canSend ? <Square size={12} /> : <ArrowUp size={14} />}
          </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
