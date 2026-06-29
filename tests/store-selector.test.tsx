import { describe, it, expect, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { AppProvider, useSelector, useDispatch, resetStore } from '../src/renderer/state/store'
import type { AppState } from '../src/renderer/state/reducer'
import type { Project } from '../src/renderer/types'

// 单会话 s1 的种子:让 activeSessionId='s1',STREAM_DELTA 改 streamingBySession 不动 activeSessionId
const seed: Project[] = [
  { id: 'p1', name: 'p1', path: '/p1', sessions: [{ id: 's1', title: 's1', updatedAt: 1, messages: [] }] },
]

describe('useSelector 分片订阅', () => {
  beforeEach(() => {
    // 模块级 curState 跨用例共享,每个用例前重置回干净初态
    resetStore()
  })

  it('订阅 activeSessionId 的组件,在 streamingBySession 变化时不重渲', () => {
    let renderCount = 0
    const Consumer = () => {
      const sid = useSelector((s: AppState) => s.activeSessionId)
      renderCount++
      return <span data-testid="sid">{sid}</span>
    }
    const Trigger = () => {
      const dispatch = useDispatch()
      return (
        <button data-testid="fire" onClick={() => dispatch({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'x' })}>fire</button>
      )
    }
    const App = () => (
      <AppProvider initialProjects={seed}>
        <Consumer />
        <Trigger />
      </AppProvider>
    )

    const { getByTestId } = render(<App />)
    expect(getByTestId('sid').textContent).toBe('s1')
    const baseline = renderCount

    // dispatch STREAM_DELTA 只改 streamingBySession,不改 activeSessionId
    act(() => { getByTestId('fire').click() })
    const delta = renderCount - baseline

    // 核心:Consumer 未订阅 streamingBySession,不该重渲(delta=0)
    expect(delta, `baseline=${baseline} after=${renderCount} delta=${delta}`).toBe(0)
  })

  it('订阅的切片变化时,组件确实重渲', () => {
    let renderCount = 0
    const Consumer = () => {
      // 订阅 streamingBySession(对象),dispatch STREAM_DELTA 会改它
      const stream = useSelector((s: AppState) => s.streamingBySession)
      renderCount++
      return <span data-testid="tick">{Object.keys(stream).length}</span>
    }
    const Trigger = () => {
      const dispatch = useDispatch()
      return (
        <button data-testid="fire" onClick={() => dispatch({ type: 'STREAM_DELTA', sessionId: 's1', kind: 'text', delta: 'x' })}>fire</button>
      )
    }
    const App = () => (
      <AppProvider initialProjects={seed}>
        <Consumer />
        <Trigger />
      </AppProvider>
    )

    const { getByTestId } = render(<App />)
    const baseline = renderCount
    act(() => { getByTestId('fire').click() })
    // 订阅的 streamingBySession 变了 → 必须重渲(delta>0)
    expect(renderCount - baseline, `baseline=${baseline} after=${renderCount}`).toBeGreaterThan(0)
  })
})
