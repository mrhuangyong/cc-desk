import { useEffect, useState } from 'react'
import { Paperclip, Check, ShieldCheck, ChevronDown, ArrowUp, Square } from 'lucide-react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { AttachmentChip } from './AttachmentChip'
import { PromptEditor } from '../editor/PromptEditor'
import { serializeForPrompt } from '../editor/serialize'
import type { SlashMenuItem } from '../editor/types'

type MenuId = 'permission' | 'model' | 'thinking'

const PERMISSIONS = ['变更前确认', '自动编辑', '计划模式', '完全访问']
const THINKINGS = ['minimal', 'standard', 'thorough']

export function InputBar() {
  const { state, dispatch } = useStore()
  const { t } = useI18n()

  // / 菜单全量缓存：组件 mount 时拉命令+技能，转成 SlashMenuItem[]
  const [allSlashItems, setAllSlashItems] = useState<SlashMenuItem[]>([])
  useEffect(() => {
    Promise.all([
      window.api?.cc?.commands?.get() ?? Promise.resolve([]),
      window.api?.cc?.skills?.get() ?? Promise.resolve([]),
    ]).then(([cmds, skills]) => {
      const cmdItems: SlashMenuItem[] = (cmds ?? []).map((c: any) => ({
        kind: 'command', id: c.id, name: c.name, desc: c.desc ?? '',
      }))
      const skillItems: SlashMenuItem[] = (skills ?? []).map((s: any) => ({
        kind: 'skill', id: s.id, name: s.name, desc: s.desc ?? '',
      }))
      setAllSlashItems([...cmdItems, ...skillItems])
    })
  }, [])

  // @ 菜单的 cwd 基点：当前会话所属项目的 path，回退 settings.cwd
  const project = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const getCwd = () => project?.path || state.settings?.cwd || ''

  // 粘贴/拖拽的图片/文件 → 走附件通道
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

  // 模型列表来自 cc-desk 多供应商配置（仅 enabled 模型），本地 state 持有
  const [modelCfg, setModelCfg] = useState<{ models: { id: string; name: string }[]; activeModelId: string } | null>(null)
  useEffect(() => {
    window.api?.ccDesk.model.get().then(c => setModelCfg({
      models: c.models.filter(m => m.enabled).map(m => ({ id: m.id, name: m.sdkModelId })),
      activeModelId: c.activeModelId,
    }))
  }, [])

  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [permission, setPermission] = useState('变更前确认')
  const [thinking, setThinking] = useState('standard')

  // 序列化 doc 得到纯文本预览：canSend 与 doSend 都用它
  const promptPreview = serializeForPrompt(state.draft.doc)
  const canSend = promptPreview.trim().length > 0 || state.draft.attachments.length > 0

  // 发送：追加用户消息 + 标记会话进入流式 + IPC 调用主进程
  const handleSend = () => {
    // 空 prompt 且无附件：不发
    if (!promptPreview.trim() && state.draft.attachments.length === 0) return
    // 交互行为：流式中，interrupt 模式先中断当前再发送；queue 模式等待（不发送）
    if (isStreaming) {
      if (state.settings.queueMode === 'interrupt') {
        window.api?.claude?.stop()
        // 中断后稍候重发（让 STREAM_ABORTED 清理完成）
        setTimeout(() => doSend(), 200)
      }
      return
    }
    doSend()
  }
  const doSend = () => {
    const prompt = serializeForPrompt(state.draft.doc)
    if (!prompt.trim() && state.draft.attachments.length === 0) return
    // 取当前本地会话映射到的 Claude 真实 sessionId；存在则 resume 续接，否则新建会话
    const claudeSessionId = state.claudeSessionMap?.[state.activeSessionId]
    // 工作目录优先取当前激活会话所属项目的 path，回退到全局设置 cwd。
    const cwd = project?.path || state.settings?.cwd || undefined
    dispatch({ type: 'SEND_MESSAGE' })
    dispatch({ type: 'STREAM_START', sessionId: state.activeSessionId })
    window.api?.claude?.send({
      prompt,
      localSessionId: state.activeSessionId,
      sessionId: claudeSessionId || undefined,
      cwd,
    })
  }

  // 停止：IPC 中断主进程的 Claude 调用
  const handleStop = () => {
    window.api?.claude?.stop()
  }

  const onSendClick = () => {
    if (isStreaming) {
      handleStop()
      return
    }
    if (!canSend) return
    handleSend()
  }

  const toggleMenu = (id: MenuId) => setOpenMenu(prev => (prev === id ? null : id))

  // 模型列表来自 cc-desk 多供应商配置（仅 enabled）；当前模型即 activeModelId
  const enabledModels = modelCfg?.models ?? []
  const activeModel = enabledModels.find(m => m.id === (modelCfg?.activeModelId ?? ''))
  const modelName = activeModel?.name ?? t('input.model')
  const selectModel = (id: string) => {
    setModelCfg(prev => prev ? { ...prev, activeModelId: id } : prev)
    window.api?.ccDesk.model.save({ activeModelId: id })
    setOpenMenu(null)
  }

  // 通用下拉菜单容器
  const menuStyle: React.CSSProperties = {
    position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
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

  return (
    <div style={{
      background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-float)',
      // 不用 overflow:hidden——否则向上展开的下拉菜单会被裁掉
    }}>
      {/* 上方 chip 栏：粘贴/拖拽的附件 */}
      {state.draft.attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px 0' }}>
          {state.draft.attachments.map((att, i) => (
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
          doc={state.draft.doc}
          placeholder={t('input.placeholder')}
          allSlashItems={allSlashItems}
          getCwd={getCwd}
          onDocChange={(doc) => dispatch({ type: 'SET_DRAFT_DOC', doc })}
          onPasteFiles={onPasteFiles}
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
          {/* 附件按钮：触发系统文件选择 */}
          <button onClick={pickFiles} style={{ ...btnBase }} title="添加附件">
            <Paperclip size={13} /><span>附件</span>
          </button>

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
                    onClick={() => { setPermission(p); setOpenMenu(null) }}
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
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
                    onClick={() => { setThinking(t); setOpenMenu(null) }}
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
          <button
            onClick={onSendClick}
            aria-label={isStreaming ? t('input.stop') : t('input.send')}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: isStreaming || canSend ? 'var(--accent)' : 'var(--bg-hover)',
              color: isStreaming || canSend ? 'var(--accent-text)' : 'var(--text-faint)',
              border: 'none', cursor: isStreaming || canSend ? 'pointer' : 'not-allowed',
              padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, lineHeight: 1,
            }}
          >
            {isStreaming ? <Square size={12} /> : <ArrowUp size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
