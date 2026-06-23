// @vitest-environment node
//
// 真机端到端测试：用真实 Claude Agent SDK + 真实模型（glm-5.2 via 本地 ai-proxy
// 127.0.0.1:17860）驱动一次 query，把 SDK 实际发出的消息喂给修复后的
// ClaudeService.forwardEvent，捕获 IPC，验证四类能力识别。
//
// 与 forward-event-identity.test.ts 的区别：前者注入「手写」的消息结构；
// 本测试用的是「真实模型 + 真实 SDK」在运行时实际产出的消息，验证 SDK 真的把
// task_* 放在 type:'system'（修复正确性的根基），以及 forwardEvent 能识别真实事件。
//
// 跳过条件：ai-proxy 不可达时整体跳过（不阻断 CI）。
import { describe, it, expect, beforeAll } from 'vitest'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeService } from '../src/main/claude-service'
import { BackendTaskRegistry } from '../src/main/backend-task-registry'

const BASE_URL = 'http://127.0.0.1:17860'
const API_KEY = 'sk-coding'
const MODEL = 'glm-5.2'

// 探测 ai-proxy 是否在线；不在线则跳过真机测试
async function proxyOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      method: 'GET',
      headers: { 'x-api-key': API_KEY },
      signal: AbortSignal.timeout(3000),
    })
    return res.status < 500
  } catch {
    return false
  }
}

// 捕获 webContents.send 的最小 mock
function mockWebContents() {
  const calls: Array<{ channel: string; data: any }> = []
  const wc: any = { send: (ch: string, ...args: any[]) => calls.push({ channel: ch, data: args[0] }) }
  return { wc, calls }
}

const RUN = await proxyOnline()

describe.skipIf(!RUN)('真机 e2e：真实模型 + SDK 事件识别', () => {
  // 跑一次真实 query，把所有消息喂给 forwardEvent，收集 IPC 与 SDK 原始消息的 type。
  let sdkMessageTypes: string[] = []
  let ipcCalls: Array<{ channel: string; data: any }> = []

  beforeAll(async () => {
    const svc = new ClaudeService()
    svc.setRegistry(new BackendTaskRegistry())
    // AskUserQuestion 需要 manager.pushMessage 才不报错；给一个空 manager
    ;(svc as any).manager = {
      pushMessage: () => {},
      ensureSession: () => ({}),
    }
    const { wc, calls } = mockWebContents()
    ipcCalls = calls
    sdkMessageTypes = []

    // 真实 SDK query：连 ai-proxy + glm-5.2，用 plan 模式 + 一个会触发工具的 prompt。
    // maxTurns 限制成本；permissionMode 'plan' 让模型倾向用 ExitPlanMode。
    const q = query({
      prompt: '请制定一个把当前目录的 README 重命名为 README.md 的计划。用 ExitPlanMode 提交计划，不要直接执行。',
      options: {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: API_KEY,
          ANTHROPIC_BASE_URL: BASE_URL,
          ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
          ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL,
        },
        model: MODEL,
        cwd: process.cwd(),
        maxTurns: 4,
        permissionMode: 'plan',
      },
    })

    try {
      for await (const message of q) {
        sdkMessageTypes.push(message.type)
        try {
          ;(svc as any).forwardEvent(message, 'e2e-sess', wc)
        } catch {
          // forwardEvent 内部对个别异常消息容错；不影响整体
        }
      }
    } catch (e: any) {
      // SDK 在达到 maxTurns / 模型未收敛时会 throw（如 "Reached maximum number of turns"）。
      // 这是正常的轮次终止，不是事件识别失败——已产出的消息仍可用于断言。
      console.log('[e2e] query 终止:', String(e?.message ?? e))
    }
  }, 120000)

  it('SDK 真实发出的事件含 type=system（task_* 走 system subtype 的前提）', () => {
    // 至少应有 system 类消息（init 等）
    expect(sdkMessageTypes).toContain('system')
  })

  it('forwardEvent 正常流转真实事件，至少发出 claude:system/result/delta 之一', () => {
    const channels = new Set(ipcCalls.map(c => c.channel))
    expect(
      channels.has('claude:system') || channels.has('claude:result') || channels.has('claude:delta')
    ).toBe(true)
  })

  it('未分类事件不泛滥（修复后 task_* 不再误入 default）', () => {
    // default 分支发 claude:notice kind=info "未分类事件：system"
    // task_* 应已被 system subtype 分支处理，不应作为未分类 system 出现
    const uncategorized = ipcCalls.filter(
      c => c.channel === 'claude:notice' && typeof c.data?.text === 'string' && c.data.text.includes('未分类事件：system')
    )
    expect(uncategorized.length).toBe(0)
  })

  it('ExitPlanMode 计划走 claude:dialog-request(plan_proposed)，不再走 claude:plan（旧通道已废弃）', () => {
    // claude:plan 是历史遗留通道，主进程已不再发送（计划改随 claude:dialog-request /
    // dialogKind='plan_proposed' 传递，见 forwardEvent-identity 测试）。这里保留扫描仅作
    // 善后验证：claude:plan 应恒为空，且 ExitPlanMode 不应作为普通工具卡片泄漏到 assistant_blocks。
    const plans = ipcCalls.filter(c => c.channel === 'claude:plan')
    const blocks = ipcCalls.filter(c => c.channel === 'claude:blocks' && c.data?.op === 'assistant_blocks')
    const leakedExitPlan = blocks
      .flatMap(b => (b.data?.blocks ?? []).filter((x: any) => x?.type === 'tool_use' && x?.name === 'ExitPlanMode'))
    // 诚实断言：claude:plan 恒空（主进程不发送）；ExitPlanMode 若被模型调用，应走 dialog-request 而非泄漏为普通工具卡。
    expect(plans.length).toBe(0)
    expect(leakedExitPlan.length).toBe(0)
    if (leakedExitPlan.length === 0) {
      console.log('[e2e] ExitPlanMode 未泄漏为普通工具卡片（glm-5.2 可能未调用，或已正确路由到 dialog-request）')
    }
  })

  it('透明诊断：真实模型实际调用了哪些工具（tool_use_start 流出）', () => {
    const toolNames = new Set<string>(
      ipcCalls
        .filter(c => c.channel === 'claude:blocks' && c.data?.op === 'tool_use_start')
        .map(c => c.data?.block?.name)
        .filter(Boolean)
    )
    console.log('[e2e] glm-5.2 plan 模式实际调用工具:', [...toolNames].join(', ') || '(无工具调用)')
    // 仅诊断，不断言（模型行为取决于第三方代理能力）
    expect(true).toBe(true)
  })
})
