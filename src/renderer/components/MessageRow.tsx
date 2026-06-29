import { Pencil } from 'lucide-react'
import { useStore } from '../state/store'
import { useI18n } from '../i18n/useI18n'
import { AttachmentChip } from './AttachmentChip'
import { Notices } from './Notices'
import { Tooltip } from './Tooltip'
import { PromptEditor } from '../editor/PromptEditor'
import { serializeForPrompt } from '../editor/serialize'
import { renderBlocks } from './blocks/BlockRenderer'
import { CopyButton, extractText, messageAttachments } from './ChatArea'

import type { ContentBlock, DraftAttachment, Message } from '../types'

// MessageRow：从 ChatArea 抽出的「单条消息行」渲染组件（纯重构，行为零变化）。
// 抽离原因：① 后续 Task 在此加 React.memo（ChatArea 在每个 STREAM_DELTA 重渲染，
//   N 条消息会全量重算，memo 后仅变化的消息行重渲染）；② 虚拟化时它就是列表项载体。
// 两个分支（assistant / user 含就地编辑）原样搬运自 ChatArea 旧的内联 map，未改任何渲染逻辑。
// editDoc 单一真源在 ChatArea（handleEditResend 也在 ChatArea，二者须读写同一 editDoc 实例，
//   否则编辑重发会失效），通过 props 下发，本组件不再自持 editDoc。
export interface MessageRowProps {
  message: Message
  isStreaming: boolean
  subagentOutputByToolUseId: Record<string, ContentBlock[]>
  subagentToolUseIds: Set<string>
  isLastUserMessage: boolean
  editingMessageId: string | null
  editDoc: any
  onEditDocChange: (doc: any) => void
  onEditResend: () => void
}

export function MessageRow(props: MessageRowProps) {
  const { dispatch } = useStore()
  const { t } = useI18n()
  const { message: m, isStreaming, subagentOutputByToolUseId, subagentToolUseIds, isLastUserMessage, editingMessageId, editDoc, onEditDocChange, onEditResend } = props

  if (m.role === 'assistant') {
    return (
      <div className="msg-row is-assistant" style={{
        alignSelf: 'flex-start', width: '100%',
        color: 'var(--text)',
        display: 'flex', flexDirection: 'column', gap: 0,
        userSelect: 'text', cursor: 'text',
      }}>
        {messageAttachments(m).map((attachment, index) => <AttachmentChip key={index} attachment={attachment} />)}
        <Notices notices={m.notices ?? []} />
        {renderBlocks(m.content, false, subagentOutputByToolUseId, subagentToolUseIds)}
        {/* 底部行：cost 元数据 + 复制钮，mono 小字 */}
        <div className="msg-foot" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          {(m.costUSD != null || m.durationMs != null) && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {m.costUSD != null && `$${m.costUSD.toFixed(4)} `}
              {m.durationMs != null && `${(m.durationMs / 1000).toFixed(1)}s`}
              {m.turns != null && ` · ${m.turns} 轮`}
            </div>
          )}
          <CopyButton text={extractText(m.content)} inline />
        </div>
      </div>
    )
  }

  // 用户消息：右对齐，收紧气泡（maxWidth 限制 + 小 padding，避免占满整行）
  return (
    <div className="msg-row is-user" style={{
      alignSelf: 'flex-end', maxWidth: '75%',
      background: 'var(--surface-1)', borderRadius: 'var(--radius)', padding: '5px 11px',
      color: 'var(--text)',
      display: 'flex', flexDirection: 'column', gap: 2,
      userSelect: 'text', cursor: 'text',
      position: 'relative',
    }}>
      {/* 编辑重发按钮：仅最后一条用户消息 + 非流式 + 非编辑态时显示，紧贴复制钮左侧 */}
      {isLastUserMessage && !isStreaming && editingMessageId !== m.id && (
        <button
          onClick={() => {
            const origText = extractText(m.content)
            onEditDocChange({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: origText }] }] })
            dispatch({ type: 'SET_EDITING_MESSAGE', messageId: m.id })
          }}
          title={t('chat.edit')}
          className="msg-copy edit-resend-btn"
        >
          <Pencil size={13} />
        </button>
      )}
      {editingMessageId === m.id && editDoc ? (
        /* 就地编辑态：PromptEditor + 取消/重发 */
        <div style={{ minWidth: 280 }}>
          <PromptEditor
            doc={editDoc}
            placeholder=""
            allSlashItems={[]}
            getCwd={() => ''}
            onDocChange={(doc) => onEditDocChange(doc)}
            onSend={onEditResend}
            onEditorReady={() => {}}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { onEditDocChange(null); dispatch({ type: 'SET_EDITING_MESSAGE', messageId: null }) }}
              style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text-muted)' }}
            >{t('chat.editCancel')}</button>
            <button
              onClick={onEditResend}
              disabled={!serializeForPrompt(editDoc).trim()}
              style={{ padding: '4px 12px', fontSize: 12, cursor: serializeForPrompt(editDoc).trim() ? 'pointer' : 'not-allowed', border: 'none', borderRadius: 6, background: serializeForPrompt(editDoc).trim() ? 'var(--accent)' : 'var(--bg-hover)', color: serializeForPrompt(editDoc).trim() ? 'var(--accent-text)' : 'var(--text-faint)' }}
            >{t('chat.editSend')}</button>
          </div>
        </div>
      ) : (
        <>
          {messageAttachments(m).map((attachment, index) => <AttachmentChip key={index} attachment={attachment} />)}
          {renderBlocks(m.content, true, subagentOutputByToolUseId, subagentToolUseIds)}
          <CopyButton text={extractText(m.content)} />
        </>
      )}
    </div>
  )
}
