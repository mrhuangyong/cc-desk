// 审查 tab：底部 commit 输入 + 生成按钮 + 提交按钮。
// 文案走 i18n（translate），不内联字典。lang 由父组件 ReviewTab 传入。
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { translate, type Lang } from '../../i18n'

interface Props {
  message: string
  busy: boolean
  lang: Lang
  onMessageChange: (m: string) => void
  onGenerate: () => void
  onSubmit: () => void
}

export function CommitBar({ message, busy, lang, onMessageChange, onGenerate, onSubmit }: Props) {
  const [localMsg, setLocalMsg] = useState(message)
  // 同步外部 message 变化（如 AI 生成后回填）。
  // 用 useEffect 同步而非渲染期 setState（渲染期 setState 是 React 反模式，会触发警告）。
  useEffect(() => {
    if (!busy) setLocalMsg(message)
  }, [message, busy])

  const t = (k: string) => translate(lang, k)

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', gap: 6, alignItems: 'flex-end' }}>
      <textarea
        value={localMsg}
        onChange={(e) => { setLocalMsg(e.target.value); onMessageChange(e.target.value) }}
        placeholder={`commit message（${t('review.generate')}）`}
        rows={2}
        disabled={busy}
        style={{ flex: 1, resize: 'vertical', fontSize: 12, padding: '4px 6px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
      />
      <button
        onClick={onGenerate}
        disabled={busy}
        title={t('review.generate')}
        style={{ padding: '6px 8px', fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Sparkles size={13} /> {t('review.generate')}
      </button>
      <button
        onClick={onSubmit}
        disabled={busy}
        style={{ padding: '6px 14px', fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius)' }}
      >
        {busy ? '…' : t('review.commit')}
      </button>
    </div>
  )
}
