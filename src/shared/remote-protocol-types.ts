// src/shared/remote-protocol-types.ts
// 远程控制协议的类型与常量定义（纯类型，无 IO / 无运行时依赖）。
//
// 为什么从 remote-protocol.ts 拆出（Task 12 决策）：
// remote-protocol.ts 的签名实现用 node:crypto（createHmac / randomBytes），
// 浏览器/Web Worker 没有 node:crypto。为了让 PWA（web 子项目）能复用协议类型
// 而不把 node:crypto 拖进浏览器 bundle，把纯类型+常量独立成本文件。
//
// 单一真相源：remote-protocol.ts re-export 本文件的类型与常量，所有现有 Node 端
// import 路径（'../shared/remote-protocol'）透明兼容；web 端 tsc path mapping
// '@shared/remote-protocol-types' 直接指向本文件，打包无副作用。

/** 协议版本 */
export const PROTOCOL_VERSION = 1

/** 时间戳容差（毫秒） */
export const TS_TOLERANCE_MS = 60_000

/** 消息类型 —— 桌面→手机 */
export type ServerToClient =
  | 'session.list'        // 当前可远程操作的会话清单
  | 'session.delta'       // 流式增量
  | 'session.blocks'      // tool_use/tool_result/计划卡片
  | 'session.notice'      // 系统提示
  | 'session.result'      // query 结束
  | 'session.history'     // 历史对话（响应手机的拉取请求）
  | 'session.models'      // 可用模型清单 + 当前激活模型（手机端切换用）
  | 'session.created'     // 新建会话成功回告（payload: { localSessionId, projectId, title, cwd? }）
  | 'dialog.request'      // 批准请求（对应 claude:dialog-request）
  | 'connection.state'    // 桌面在线状态
  | 'goal.evaluated'      // goal 一轮评估完成（payload: { localSessionId, reason, turns }）
  | 'goal.achieved'       // goal 达成（payload: { localSessionId }）
  | 'goal.status'         // goal 状态查询回告（payload: { localSessionId, goal: {condition,status,turns}|null }）

/** 消息类型 —— 手机→桌面 */
export type ClientToServer =
  | 'bind'                // /ws 连接后的身份握手
  | 'session.sync'        // 上线/刷新后请求重推会话列表（无需重新配对）
  | 'session.attach'      // 接管会话
  | 'session.create'      // 新建会话
  | 'session.archive'     // 归档会话（payload: { localSessionId }）
  | 'session.message'     // 发消息
  | 'session.interrupt'   // 中断 query
  | 'session.setActiveModel' // 切换激活模型（改桌面 cc-desk-store activeModelId）
  | 'session.history.request' // 拉取会话历史（分页）
  | 'dialog.response'     // 批准/拒绝/忽略

/** 控制类消息（配对、错误等） */
export type ControlMessage =
  | 'pair.code'           // 桌面→中继：请求生成配对码
  | 'pair.request'        // 中继→桌面：手机请求配对
  | 'pair.approve'        // 桌面→中继：同意配对
  | 'pair.success'        // 中继→手机：配对完成，下发密钥
  | 'error'               // 错误回报
  | 'peer_offline'        // 对端不在线

export type MessageType = ServerToClient | ClientToServer | ControlMessage

/** 消息信封（所有消息统一外壳） */
export interface Envelope<T = unknown> {
  v: number               // 协议版本
  type: MessageType
  deviceId: string        // 发送方设备
  ts: number              // 毫秒时间戳
  nonce: string           // 单调随机，防重放
  sig: string             // HMAC-SHA256(deviceKey, ts+nonce+payload) base64
  payload: T
}
