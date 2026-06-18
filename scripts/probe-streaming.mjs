// scripts/probe-streaming.mjs
// 验证 SDK streaming-input 长连接模式的关键行为：
//   1. 后台命令在对话轮结束后是否仍存活
//   2. result 是否代表「一轮结束」而非「query 结束」
//   3. 同一 query push 第二条消息是否触发新一轮
//
// 用法：node scripts/probe-streaming.mjs
// 前置：设置 ANTHROPIC_API_KEY 环境变量
import { query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'

// 构造一个可推送的 async iterable + controller
function makePushableStream() {
  const queue = []
  let resolveNext = null
  let done = false
  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
            if (done) return Promise.resolve({ value: undefined, done: true })
            return new Promise((resolve) => { resolveNext = resolve })
          },
          return() { done = true; if (resolveNext) resolveNext({ value: undefined, done: true }); return Promise.resolve({ value: undefined, done: true }) },
        }
      },
    },
    push(msg) {
      if (resolveNext) { const r = resolveNext; resolveNext = null; r({ value: msg, done: false }) }
      else queue.push(msg)
    },
    close() { done = true; if (resolveNext) { const r = resolveNext; resolveNext = null; r({ value: undefined, done: true }) } },
  }
}

function countNodePtx(pattern) {
  try {
    const out = execSync(`pgrep -fl "${pattern}" 2>/dev/null || true`).toString().trim()
    return out ? out.split('\n') : []
  } catch { return [] }
}

async function main() {
  const { iterable, push, close } = makePushableStream()

  console.log('=== 创建 streaming-input query (model=qwen, baseUrl=localhost:1000) ===')
  const stream = query({
    prompt: iterable,
    options: {
      permissionMode: 'auto',
      maxTurns: 20,
      includePartialMessages: true,
      model: 'qwen',
    },
  })

  // 第一条消息：让 Claude 起一个后台命令
  console.log('=== push 第一条消息：起后台 sleep 60 ===')
  push({
    type: 'user',
    message: { role: 'user', content: '用 Bash 工具执行 `sleep 60`，务必设置 run_in_background: true。起完后就回复一句"已起"。' },
    parent_tool_use_id: null,
  })

  let firstResultSeen = false
  let secondPushed = false

  for await (const message of stream) {
    const t = message.type
    const st = message.subtype ?? ''
    if (t === 'result') {
      console.log(`>>> [result] subtype=${st} is_error=${!!message.is_error}`)
      if (!firstResultSeen) {
        firstResultSeen = true
        // 第一轮结束后，检查后台进程是否还活
        const procs = countNodePtx('sleep 60')
        console.log(`>>> 第一轮 result 后，'sleep 60' 进程数：${procs.length}`)
        console.log(`>>> 进程详情：\n${procs.join('\n') || '(无)'}`)

        // 等 3 秒再查一次，确认不是刚启动的残留
        await new Promise(r => setTimeout(r, 3000))
        const procs2 = countNodePtx('sleep 60')
        console.log(`>>> 等 3 秒后，'sleep 60' 进程数：${procs2.length}`)
        console.log(`>>> 进程详情：\n${procs2.join('\n') || '(无)'}`)

        // 验证 stream 是否还活着：push 第二条消息看是否触发新一轮
        if (procs2.length > 0 && !secondPushed) {
          secondPushed = true
          console.log('>>> push 第二条消息（验证 stream 仍可接收）')
          push({
            type: 'user',
            message: { role: 'user', content: '回复一个字：好' },
            parent_tool_use_id: null,
          })
        } else {
          console.log('>>> 后台进程已死或未起，不再 push 第二条')
          close()
          break
        }
      } else {
        console.log('>>> 第二轮 result —— 证明 streaming 模式下 stream 未关闭，可继续多轮')
        // 收尾：杀掉后台 sleep，关闭 stream
        try { execSync('pkill -f "sleep 60" 2>/dev/null || true') } catch {}
        close()
        break
      }
    } else if (t === 'stream_event') {
      const evt = message.event
      if (evt?.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        console.log(`>>> [tool_use_start] ${evt.content_block.name} input=${JSON.stringify(evt.content_block.input).slice(0, 100)}`)
      }
    } else if (t === 'system') {
      console.log(`>>> [system] ${st}`)
    }
  }

  console.log('=== stream 遍历结束 ===')
  // 遍历结束（close()）后查一次进程
  await new Promise(r => setTimeout(r, 1000))
  const procsFinal = countNodePtx('sleep 60')
  console.log(`>>> close() 后，'sleep 60' 进程数：${procsFinal.length}（预期 0，因 close 触发 cleanup 杀进程组）`)
  try { execSync('pkill -f "sleep 60" 2>/dev/null || true') } catch {}
}

async function probeResume() {
  console.log('\n=== probeResume: 验证 streaming 模式 resume 恢复历史 ===')
  // 第一轮：建会话，让 Claude 记住一个事实
  const c1 = makePushableStream()
  const q1 = query({ prompt: c1.iterable, options: { permissionMode: 'auto', maxTurns: 5, model: 'qwen' } })
  c1.push({ type: 'user', message: { role: 'user', content: '记住这个密码：banana7749。只回复"记住了"。' }, parent_tool_use_id: null })
  let sessionId = null
  for await (const m of q1) {
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id
    if (m.type === 'result') { console.log('>>> 第一轮 sessionId:', sessionId); break }
  }
  try { await q1.return() } catch {}

  if (!sessionId) { console.log('>>> 未拿到 sessionId，跳过'); return }
  // 第二轮：用 resume 恢复，问之前记住的密码
  const c2 = makePushableStream()
  const q2 = query({ prompt: c2.iterable, options: { permissionMode: 'auto', maxTurns: 5, model: 'qwen', resume: sessionId } })
  c2.push({ type: 'user', message: { role: 'user', content: '我之前让你记住的密码是什么？只回复密码本身，不要其他文字。' }, parent_tool_use_id: null })
  let answer = ''
  for await (const m of q2) {
    console.log('>>> [resume round2] msg type:', m.type, m.subtype ?? '')
    if (m.type === 'result') {
      console.log('>>> [resume round2] result is_error:', !!m.is_error, 'subtype:', m.subtype, 'result:', JSON.stringify(m.result ?? '').slice(0, 300))
    }
    if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.text) answer += m.event.delta.text
    if (m.type === 'result') break
  }
  console.log('>>> 第二轮 Claude 回答:', JSON.stringify(answer.trim()))
  console.log('>>> resume 验证:', answer.includes('banana7749') ? '✅ 历史上下文可见' : '❌ 历史上下文丢失')
  try { await q2.return() } catch {}
}

main().then(probeResume).catch(e => { console.error('ERROR:', e); process.exit(1) })
