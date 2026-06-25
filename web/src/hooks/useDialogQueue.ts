// web/src/hooks/useDialogQueue.ts
// 管理 dialog.request 批准请求队列（Task 14）。
//
// 职责：从入站信封中识别 dialog.request → 入队（去重，断线补发不重复展示）→
//   暴露 current（队首）与 items；approve/deny → 发 dialog.response 并出队；
//   ignore → 仅出队（不回信）。
//
// 纯逻辑（FIFO、去重、移除）下沉到 lib/dialog-queue.ts 的 createDialogQueue，
//   本 hook 只做 React 状态同步 + 传输桥接（send）。这样队列语义可脱离 React 单测。
//
// 协议契约（src/shared/remote-protocol-types.ts）：
//   - 收：dialog.request（payload: { reqId, localSessionId, dialogKind, payload }）
//   - 发：dialog.response（payload: { reqId, result }）
//   result 形态按 dialogKind 构造（见 lib/dialog-result.ts），与桌面端 askUserViaPanel
//   的三类 dialog 处理逻辑对齐：permission→completed、plan→completed+permissionMode、
//   ask→cancelled（UI 无答案输入的遗留缺口）。
import { useCallback, useRef, useState } from 'react'
import type { Envelope, MessageType } from '@shared/remote-protocol-types'
import { createDialogQueue, parseDialogRequest, type DialogRequest } from '../lib/dialog-queue'
import { buildDialogResult } from '../lib/dialog-result'

/** useRelay.send 的最小签名（仅本 hook 用到的子集，便于注入测试）。 */
export type SendFn = (
  type: Extract<MessageType, 'dialog.response'>,
  payload: unknown,
) => Promise<boolean>

export interface UseDialogQueueOptions {
  send: SendFn
}

export interface UseDialogQueueHandle {
  /** 当前队首（要展示的批准请求）。 */
  current: DialogRequest | null
  /** 全部队列（含 current），按入队 FIFO 顺序。 */
  items: DialogRequest[]
  /**
   * 入站信封处理器：挂在 useRelay 的 onInbound。
   * 仅识别 dialog.request，其余信封静默忽略。
   */
  onInbound(env: Envelope): void
  /** 批准：发 dialog.response(approve) 并出队。 */
  approve(reqId: string): Promise<void>
  /** 拒绝：发 dialog.response(deny) 并出队。 */
  deny(reqId: string): Promise<void>
  /** 忽略：仅出队，不回 dialog.response（用户主动跳过）。 */
  ignore(reqId: string): void
  /** 清空队列（解绑会话/卸载时用）。 */
  clear(): void
}

export function useDialogQueue(opts: UseDialogQueueOptions): UseDialogQueueHandle {
  const { send } = opts
  // 纯逻辑队列用 ref 持有（不参与渲染 diff），React 只镜像它的快照。
  const queueRef = useRef(createDialogQueue())
  const [state, setState] = useState(() => queueRef.current.state())
  const sync = useCallback(() => {
    setState(queueRef.current.state())
  }, [])

  const onInbound = useCallback((env: Envelope) => {
    if (env.type !== 'dialog.request') return
    const req = parseDialogRequest(env.payload)
    if (!req) return
    queueRef.current.enqueue(req)
    sync()
  }, [sync])

  const removeFromQueue = useCallback((reqId: string) => {
    queueRef.current.resolve(reqId)
    sync()
  }, [sync])

  /** 按 reqId 查队列项的 dialogKind（构造 result 时需要）。 */
  const dialogKindOf = useCallback((reqId: string): string | undefined => {
    return queueRef.current.state().items.find((d) => d.reqId === reqId)?.dialogKind
  }, [])

  const approve = useCallback(async (reqId: string) => {
    const dialogKind = dialogKindOf(reqId) ?? ''
    const ok = await send('dialog.response', { reqId, result: buildDialogResult(dialogKind, 'approve') })
    // I1：send 失败（未连接/中继不可达）时保留队列项，让用户重连后重试，
    // 避免卡片消失但桌面端未收到 → 重连补发后又突兀出现。
    if (!ok) return
    removeFromQueue(reqId)
  }, [send, removeFromQueue, dialogKindOf])

  const deny = useCallback(async (reqId: string) => {
    const dialogKind = dialogKindOf(reqId) ?? ''
    const ok = await send('dialog.response', { reqId, result: buildDialogResult(dialogKind, 'deny') })
    if (!ok) return
    removeFromQueue(reqId)
  }, [send, removeFromQueue, dialogKindOf])

  const ignore = useCallback((reqId: string) => {
    removeFromQueue(reqId)
  }, [removeFromQueue])

  const clear = useCallback(() => {
    queueRef.current.clear()
    sync()
  }, [sync])

  return {
    current: state.current,
    items: state.items,
    onInbound,
    approve,
    deny,
    ignore,
    clear,
  }
}
