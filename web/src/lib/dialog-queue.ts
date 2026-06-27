// web/src/lib/dialog-queue.ts
// dialog.request 队列的纯逻辑（Task 14）。
//
// 设计（Musk Algorithm：把队列管理从 React/useDialogQueue 拆出来单测）：
// - dialog.request 是状态化出站消息（spec §5.3）：桌面端 dialogReplayer 在断线重连后
//   会补发未解决的请求。手机端可能因此收到重复（同 reqId）或乱序的请求。
// - 队列语义：FIFO 展示，current=队首；同 reqId 去重（保留首次位置，补发不污染顺序）。
// - 三种处置：resolve（批准/拒绝 → 调用方回 dialog.response）、ignore（跳过，不回 response）。
//   两者都把请求移出队列，区别只在调用方是否回信；纯逻辑层一视同仁（仅做移除）。
//
// 与桌面端 dialog payload 字段对齐（src/main/remote-bridge.ts onDialogRequest）：
// { reqId, localSessionId, dialogKind, payload }。

/** 单条批准请求。 */
export interface DialogRequest {
  reqId: string
  localSessionId: string
  dialogKind: string
  payload: unknown
}

/** 队列状态快照（不可变，便于 React setState 直接替换）。 */
export interface DialogQueueState {
  items: DialogRequest[]
  current: DialogRequest | null
}

/** 从信封 payload 解析 DialogRequest；非法返回 null。 */
export function parseDialogRequest(payload: any): DialogRequest | null {
  if (!payload || typeof payload !== 'object') return null
  const { reqId, localSessionId, dialogKind } = payload
  if (typeof reqId !== 'string' || !reqId) return null
  if (typeof localSessionId !== 'string' || !localSessionId) return null
  if (typeof dialogKind !== 'string' || !dialogKind) return null
  return { reqId, localSessionId, dialogKind, payload: (payload as any).payload }
}

/**
 * 纯函数式队列：内部维护数组，每次操作返回不可变快照。
 * 去重按 reqId：补发同 reqId 时保留首次位置（FIFO 稳定）。
 */
export function createDialogQueue(initial: DialogRequest[] = []) {
  let items: DialogRequest[] = [...initial]

  const snapshot = (): DialogQueueState => ({
    items: [...items],
    current: items.length > 0 ? items[0] : null,
  })

  return {
    /** 入队；同 reqId 去重（保留首次位置）。 */
    enqueue(req: DialogRequest): DialogQueueState {
      if (items.some((d) => d.reqId === req.reqId)) {
        return snapshot() // 断线补发同一条，去重不污染顺序
      }
      items = [...items, req]
      return snapshot()
    },
    /** 解决/忽略某 reqId：从队列移除。返回新快照。 */
    resolve(reqId: string): DialogQueueState {
      const exists = items.some((d) => d.reqId === reqId)
      if (!exists) return snapshot()
      items = items.filter((d) => d.reqId !== reqId)
      return snapshot()
    },
    /** ignore 与 resolve 在纯逻辑层等价（都移除）；区别在调用方是否回 dialog.response。 */
    ignore(reqId: string): DialogQueueState {
      return this.resolve(reqId)
    },
    /** 清空（解绑会话时用）。 */
    clear(): DialogQueueState {
      items = []
      return snapshot()
    },
    /** 当前快照。 */
    state(): DialogQueueState {
      return snapshot()
    },
  }
}
