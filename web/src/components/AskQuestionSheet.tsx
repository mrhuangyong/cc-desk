// web/src/components/AskQuestionSheet.tsx
// AskUserQuestion 工具的移动端问答向导（dialogKind='ask_user_question'）。
//
// 对齐桌面端 src/renderer/components/AnswerPanel.tsx 的状态逻辑（step/answers/pick/answered/
// submit 构造），但 UI 用 web 端 .dialog-sheet 抽屉式 + CSS 变量，移动端触控友好。
//
// payload 形态（forwarder 透传 SDK 的 AskUserQuestion input）：
//   { questions: [{ question, header, options:[{label,description,preview?}], multiSelect? }] }
//
// 提交构造（与桌面 AnswerPanel.submit 完全一致，桌面端 handleAskUserQuestion 据此 push 回 SDK）：
//   answers: Array<{ questionIndex, selected:{index,label} } | { questionIndex, other:string }>
//   多选时每个选项/other 各占一项（拍平）。
//
// 取消（关闭按钮）→ onCancel → dialog.response(deny) → 桌面端 push「用户取消了这次提问」。
import { useState } from 'react'
import type { DialogRequest } from '../lib/dialog-queue'
import { ArrowRightIcon, CheckIcon, CloseIcon } from './icons'

export interface AskQuestionSheetProps {
  dialog: DialogRequest
  /** 提交：传 reqId + 答案数组（已按桌面端形态构造）。 */
  onSubmit: (reqId: string, answers: any[]) => void
  /** 取消：传 reqId（调用方走 deny）。 */
  onCancel: (reqId: string) => void
}

export default function AskQuestionSheet({ dialog, onSubmit, onCancel }: AskQuestionSheetProps) {
  const questions: any[] = (dialog.payload as any)?.questions ?? []
  const total = questions.length
  // 当前问题索引；answers: questionIndex → 单选 {index,label} | 多选 Array<...> | {other,text}
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<number, any>>({})

  // payload 无问题（异常）：退化为「取消」单按钮，避免空卡片卡死
  if (total === 0) {
    return (
      <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="提问">
        <div className="dialog-sheet">
          <div className="dialog-grab" aria-hidden="true" />
          <div className="dialog-question">提问内容为空</div>
          <div className="dialog-actions">
            <button className="dialog-btn deny" onClick={() => onCancel(dialog.reqId)}>取消</button>
          </div>
        </div>
      </div>
    )
  }

  const q = questions[step]
  const isLast = step >= total - 1
  const cur = answers[step]

  // 单选：覆盖；多选：toggle 累加
  const pick = (optIndex: number, opt: any) => {
    setAnswers((a) => {
      if (q.multiSelect) {
        const prev: any[] = Array.isArray(a[step]) ? a[step] : []
        const exists = prev.some((x) => x?.index === optIndex)
        const next = exists ? prev.filter((x) => x?.index !== optIndex) : [...prev, { index: optIndex, label: opt.label }]
        return { ...a, [step]: next }
      }
      return { ...a, [step]: { index: optIndex, label: opt.label } }
    })
  }
  const pickOther = () => {
    setAnswers((a) => {
      if (q.multiSelect) {
        const prev: any[] = Array.isArray(a[step]) ? a[step] : []
        const exists = prev.some((x) => x?.other)
        const next = exists ? prev.filter((x) => !x?.other) : [...prev, { other: true, text: '' }]
        return { ...a, [step]: next }
      }
      return { ...a, [step]: { other: true, text: '' } }
    })
  }
  const setOtherText = (text: string) => {
    setAnswers((a) => {
      if (q.multiSelect) {
        const prev: any[] = Array.isArray(a[step]) ? a[step] : []
        const next = prev.map((x) => (x?.other ? { ...x, text } : x))
        return { ...a, [step]: next }
      }
      return { ...a, [step]: { other: true, text } }
    })
  }

  // 当前问题是否已答（用于启用下一步/提交）
  const answered = (() => {
    const c = cur
    if (!c) return false
    if (Array.isArray(c)) return c.length > 0 && c.every((x) => !x.other || (x.text && x.text.trim()))
    if (c.other) return c.text && c.text.trim()
    return c.index !== undefined
  })()

  const submit = () => {
    const userAnswers = Object.entries(answers)
      .map(([qi, v]) => {
        const questionIndex = Number(qi)
        // 多选：每个选项/other 各一项
        if (Array.isArray(v)) {
          return v.map((item) => {
            if (item.other) return { questionIndex, other: item.text ?? '' }
            return { questionIndex, selected: { index: item.index, label: item.label } }
          })
        }
        if (v?.other) return { questionIndex, other: v.text ?? '' }
        return { questionIndex, selected: v }
      })
      .flat()
    onSubmit(dialog.reqId, userAnswers)
  }

  const isSelected = (optIndex: number) => {
    if (q.multiSelect) return Array.isArray(cur) && cur.some((x: any) => x?.index === optIndex)
    return cur?.index === optIndex
  }
  const otherSelected = () =>
    q.multiSelect ? Array.isArray(cur) && cur.some((x: any) => x?.other) : cur?.other

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label="提问">
      <div className="dialog-sheet">
        <div className="dialog-grab" aria-hidden="true" />
        {/* 进度 + 取消 */}
        <div className="dialog-sheet-head ask-head">
          <div className="ask-progress">{step + 1} / {total}</div>
          <button className="ask-cancel-btn" onClick={() => onCancel(dialog.reqId)} aria-label="取消">
            <CloseIcon />
          </button>
        </div>
        {/* 当前问题 */}
        <div className="dialog-question ask-question-block">
          <div className="ask-tags">
            {q.header && <span className="ask-tag">{q.header}</span>}
            {q.multiSelect && <span className="ask-tag ask-tag-muted">可多选</span>}
          </div>
          <div className="ask-text">{q.question}</div>
        </div>
        {/* 选项 */}
        <div className="dialog-options">
          {(q.options ?? []).map((opt: any, oi: number) => (
            <button
              key={oi}
              className={`dialog-option${isSelected(oi) ? ' selected' : ''}`}
              onClick={() => pick(oi, opt)}
              type="button"
            >
              <span className="dialog-option-mark">{isSelected(oi) ? <CheckIcon /> : null}</span>
              <span className="dialog-option-body">
                <span className="dialog-option-label">{opt.label}</span>
                {opt.description && <span className="dialog-option-desc">{opt.description}</span>}
              </span>
            </button>
          ))}
          {/* Other 自定义 */}
          <button
            className={`dialog-option${otherSelected() ? ' selected' : ''}`}
            onClick={pickOther}
            type="button"
          >
            <span className="dialog-option-mark">{otherSelected() ? <CheckIcon /> : null}</span>
            <span className="dialog-option-label">其他…</span>
          </button>
          {q.multiSelect
            ? Array.isArray(cur) && cur.filter((x: any) => x?.other).map((_: any, i: number) => (
                <input
                  key={i}
                  className="ask-other-input"
                  type="text"
                  placeholder="自定义回答"
                  defaultValue=""
                  onChange={(e) => setOtherText(e.target.value)}
                  onBlur={(e) => setOtherText(e.target.value)}
                />
              ))
            : cur?.other && (
                <input
                  className="ask-other-input"
                  type="text"
                  autoFocus
                  placeholder="自定义回答"
                  onChange={(e) => setOtherText(e.target.value)}
                />
              )}
        </div>
        {/* 导航 */}
        <div className="dialog-actions ask-nav">
          {step > 0 && (
            <button className="dialog-btn deny" onClick={() => setStep((s) => s - 1)} type="button">上一步</button>
          )}
          {isLast ? (
            <button className="dialog-btn approve" onClick={submit} disabled={!answered} type="button">
              <CheckIcon /> 提交
            </button>
          ) : (
            <button className="dialog-btn approve" onClick={() => setStep((s) => s + 1)} disabled={!answered} type="button">
              下一步 <ArrowRightIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
