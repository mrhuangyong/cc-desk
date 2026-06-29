import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import type { Action } from '../state/actions'

// buffer 按 sessionId 再按 kind 分桶:同一帧内同 kind 的 delta 拼成一次 STREAM_DELTA。
// 上限 60 次/秒(rAF)。失焦时 rAF 暂停,setTimeout(16ms) 兜底,保证后台流式不堆积。
interface DeltaEntry { kind: 'text' | 'thinking'; delta: string }

export function useStreamBatcher(dispatch: Dispatch<Action>) {
  // buffer 结构: Record<sessionId, Record<kind, string>>
  const bufferRef = useRef<Record<string, { text?: string; thinking?: string }>>({})
  const rafIdRef = useRef<number | null>(null)
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dispatchRef = useRef(dispatch)
  useEffect(() => { dispatchRef.current = dispatch }, [dispatch])

  const flush = () => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (timeoutIdRef.current != null) {
      clearTimeout(timeoutIdRef.current as unknown as number)
      timeoutIdRef.current = null
    }
    const buffer = bufferRef.current
    bufferRef.current = {}
    for (const sessionId of Object.keys(buffer)) {
      const entry = buffer[sessionId]
      if (entry.text != null) dispatchRef.current({ type: 'STREAM_DELTA', sessionId, kind: 'text', delta: entry.text })
      if (entry.thinking != null) dispatchRef.current({ type: 'STREAM_DELTA', sessionId, kind: 'thinking', delta: entry.thinking })
    }
  }

  const schedule = () => {
    if (rafIdRef.current != null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      flush()
    })
    // 后台/失焦兜底:rAF 可能暂停,16ms 后强制 flush
    timeoutIdRef.current = setTimeout(() => { flush() }, 16)
  }

  const pushDelta = (sessionId: string, kind: 'text' | 'thinking', delta: string) => {
    const buf = bufferRef.current[sessionId] ?? (bufferRef.current[sessionId] = {})
    if (kind === 'text') {
      buf.text = (buf.text ?? '') + delta
    } else {
      buf.thinking = (buf.thinking ?? '') + delta
    }
    schedule()
  }

  // 卸载时清掉未 flush 的 delta,防泄漏
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
      if (timeoutIdRef.current != null) clearTimeout(timeoutIdRef.current as unknown as number)
    }
  }, [])

  return { pushDelta, flush }
}
