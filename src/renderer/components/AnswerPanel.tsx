import { useState } from 'react'
import { useStore } from '../state/store'

// AskUserQuestion 形态：payload.questions = [{ question, header, options:[{label,description,preview?}], multiSelect? }]
export function AnswerPanel() {
  const { state, dispatch } = useStore()
  const dialog = state.pendingDialog
  const questions: any[] = dialog?.payload?.questions ?? []
  const [answers, setAnswers] = useState<Record<number, any>>({})
  if (!dialog) return null

  const submit = (results: Record<number, any>) => {
    const userAnswers = Object.entries(results).map(([qi, v]) => {
      const questionIndex = Number(qi)
      // Other 自定义回答：{ other: true, text } → { other: text }；其余选项 → { selected: v }
      if (v?.other) return { questionIndex, other: v.text ?? '' }
      return { questionIndex, selected: v }
    })
    window.api?.claude?.dialogResponse({ reqId: dialog.reqId, result: { behavior: 'completed', result: { answers: userAnswers } } })
    dispatch({ type: 'ANSWER_DIALOG' })
  }
  const cancel = () => {
    window.api?.claude?.dialogResponse({ reqId: dialog.reqId, result: { behavior: 'cancelled' } })
    dispatch({ type: 'ANSWER_DIALOG' })
  }

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-float)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {questions.map((q, qi) => (
        <div key={qi}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>{q.header}</span>
            <span style={{ fontSize: 13 }}>{q.question}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(q.options ?? []).map((opt: any, oi: number) => (
              <label key={oi} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: answers[qi]?.index === oi ? 'var(--bg-hover)' : 'transparent' }}>
                <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`q${qi}`} onChange={() => setAnswers(a => ({ ...a, [qi]: { index: oi, label: opt.label } }))} />
                <span>
                  <div>{opt.label}</div>
                  {opt.description && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{opt.description}</div>}
                </span>
              </label>
            ))}
            {/* Other 自定义 */}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer', padding: '4px 6px' }}>
              <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`q${qi}`} onChange={() => setAnswers(a => ({ ...a, [qi]: { other: true } }))} />
              <span>Other…</span>
            </label>
            {answers[qi]?.other && (
              <input type="text" placeholder="自定义回答" onChange={e => setAnswers(a => ({ ...a, [qi]: { other: true, text: e.target.value } }))}
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
            )}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={cancel} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>取消</button>
        <button onClick={() => submit(answers)} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: 'var(--accent-text)', cursor: 'pointer' }}>提交</button>
      </div>
    </div>
  )
}
