import { useState } from 'react'
import { useStore } from '../state/store'
import { ArrowRight, Check, X } from 'lucide-react'
import { Tooltip } from './Tooltip'

// AskUserQuestion 形态：payload.questions = [{ question, header, options:[{label,description,preview?}], multiSelect? }]
// 逐步向导：一次只显示一个问题，答完「下一步」推进；最后一题显示「提交」。
// 多选（multiSelect）累加为数组，不再覆盖。
export function AnswerPanel() {
  const { state, dispatch } = useStore()
  const dialog = state.pendingDialog
  // null 守卫：pendingDialog 可能在竞态下瞬时为 null（如并发 DIALOG_RESOLVED 清除）。
  // 非空断言会在该帧抛 TypeError，无 ErrorBoundary 时导致整棵对话区子树卸载（弹窗消失）。
  // 返回 null 而非抛错，保留外层条件渲染的控制权。
  if (!dialog) return null
  const questions: any[] = dialog.payload?.questions ?? []
  const total = questions.length
  // 当前问题索引；answers: questionIndex → 单选 {index,label} | 多选 Array<{index,label}> | {other,text}
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<number, any>>({})

  if (total === 0) return null
  const q = questions[step]
  const isLast = step >= total - 1
  const cur = answers[step]

  // 单选：覆盖；多选：toggle 累加
  const pick = (optIndex: number, opt: any) => {
    setAnswers(a => {
      if (q.multiSelect) {
        const prev: any[] = Array.isArray(a[step]) ? a[step] : []
        const exists = prev.some(x => x?.index === optIndex)
        const next = exists ? prev.filter(x => x?.index !== optIndex) : [...prev, { index: optIndex, label: opt.label }]
        return { ...a, [step]: next }
      }
      return { ...a, [step]: { index: optIndex, label: opt.label } }
    })
  }
  const pickOther = () => {
    setAnswers(a => {
      if (q.multiSelect) {
        const prev: any[] = Array.isArray(a[step]) ? a[step] : []
        const exists = prev.some(x => x?.other)
        const next = exists ? prev.filter(x => !x?.other) : [...prev, { other: true, text: '' }]
        return { ...a, [step]: next }
      }
      return { ...a, [step]: { other: true, text: '' } }
    })
  }
  const setOtherText = (text: string) => {
    setAnswers(a => {
      if (q.multiSelect) {
        const prev: any[] = Array.isArray(a[step]) ? a[step] : []
        const next = prev.map(x => x?.other ? { ...x, text } : x)
        return { ...a, [step]: next }
      }
      return { ...a, [step]: { other: true, text } }
    })
  }

  // 当前问题是否已答（用于启用下一步/提交）
  const answered = (() => {
    const c = cur
    if (!c) return false
    if (Array.isArray(c)) return c.length > 0 && c.every(x => !x.other || (x.text && x.text.trim()))
    if (c.other) return c.text && c.text.trim()
    return c.index !== undefined
  })()

  const submit = () => {
    const userAnswers = Object.entries(answers).map(([qi, v]) => {
      const questionIndex = Number(qi)
      // 多选：每个选项作为一个 selected，或 other
      if (Array.isArray(v)) {
        return v.map(item => {
          if (item.other) return { questionIndex, other: item.text ?? '' }
          return { questionIndex, selected: { index: item.index, label: item.label } }
        })
      }
      if (v?.other) return { questionIndex, other: v.text ?? '' }
      return { questionIndex, selected: v }
    }).flat()
    window.api?.claude?.dialogResponse({ reqId: dialog.reqId, result: { behavior: 'completed', result: { answers: userAnswers } } })
    dispatch({ type: 'ANSWER_DIALOG' })
  }
  const cancel = () => {
    window.api?.claude?.dialogResponse({ reqId: dialog.reqId, result: { behavior: 'cancelled' } })
    dispatch({ type: 'ANSWER_DIALOG' })
  }

  const inputType = q.multiSelect ? 'checkbox' : 'radio'
  const isSelected = (optIndex: number) => {
    if (q.multiSelect) return Array.isArray(cur) && cur.some((x: any) => x?.index === optIndex)
    return cur?.index === optIndex
  }
  const otherSelected = () => q.multiSelect
    ? Array.isArray(cur) && cur.some((x: any) => x?.other)
    : cur?.other

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-float)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 进度 + 关闭 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{step + 1} / {total}</span>
        <Tooltip label="取消">
          <button onClick={cancel} aria-label="取消" style={{ padding: 4, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </Tooltip>
      </div>
      {/* 当前问题 */}
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          {q.header && <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>{q.header}</span>}
          {q.multiSelect && <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>可多选</span>}
          <span style={{ fontSize: 13 }}>{q.question}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(q.options ?? []).map((opt: any, oi: number) => (
            <label key={oi} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: isSelected(oi) ? 'var(--bg-hover)' : 'transparent' }}>
              <input type={inputType} name={`q${step}`} checked={isSelected(oi)} onChange={() => pick(oi, opt)} />
              <span>
                <div>{opt.label}</div>
                {opt.description && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{opt.description}</div>}
              </span>
            </label>
          ))}
          {/* Other 自定义 */}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: otherSelected() ? 'var(--bg-hover)' : 'transparent' }}>
            <input type={inputType} name={`q${step}`} checked={otherSelected()} onChange={pickOther} />
            <span>Other…</span>
          </label>
          {q.multiSelect
            ? Array.isArray(cur) && cur.filter((x: any) => x?.other).map((_: any, i: number) => (
                <input key={i} type="text" placeholder="自定义回答" defaultValue=""
                  onChange={e => setOtherText(e.target.value)}
                  onBlur={e => setOtherText(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
              ))
            : cur?.other && (
                <input type="text" autoFocus placeholder="自定义回答"
                  onChange={e => setOtherText(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)' }} />
              )}
        </div>
      </div>
      {/* 导航 */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>上一步</button>
        )}
        {isLast ? (
          <button onClick={submit} disabled={!answered} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: answered ? 'var(--accent)' : 'var(--bg-hover)', color: answered ? 'var(--accent-text)' : 'var(--text-muted)', cursor: answered ? 'pointer' : 'not-allowed', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={13} /> 提交
          </button>
        ) : (
          <button onClick={() => setStep(s => s + 1)} disabled={!answered} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: answered ? 'var(--accent)' : 'var(--bg-hover)', color: answered ? 'var(--accent-text)' : 'var(--text-muted)', cursor: answered ? 'pointer' : 'not-allowed', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            下一步 <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
