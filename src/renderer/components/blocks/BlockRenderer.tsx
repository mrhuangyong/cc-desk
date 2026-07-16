import type { ContentBlock } from '../../types'
import { TextBlock } from './TextBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseCard } from './ToolUseCard'
import { ToolGroup } from './ToolGroup'
import { ImageBlock } from './ImageBlock'
import { MetaToolCard } from './MetaToolCard'
import { SubagentInlineCard } from './SubagentInlineCard'

// 元工具（任务/计划管理类）：用语义化卡片渲染，而非普通 ToolUseCard。
// TaskCreate/TaskUpdate/TaskList 让对话流完整记录模型的任务规划；
// ExitPlanMode 提供「查看计划」入口（plan 抽屉），解决 plan 批准后入口丢失。
const META_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'ExitPlanMode'])

// showThinking 由调用方 props 传入（缺省 true 向后兼容）：解耦 useStore，
// 使 BlockRenderer 不再订阅全局 state——这是分片订阅与 memo 生效的前提，
// 否则子组件仍随每次 state 变化（含流式 token delta）重渲。
export function BlockRenderer({ block, subagentOutputByToolUseId, hiddenToolUseIds, showThinking = true }: {
  block: ContentBlock
  subagentOutputByToolUseId?: Record<string, ContentBlock[]>
  hiddenToolUseIds?: Set<string>
  showThinking?: boolean
}) {
  switch (block.type) {
    case 'text': return <TextBlock text={block.text} />
    // thinking 块受「显示思考过程」设置控制：关闭时不渲染
    case 'thinking': return showThinking ? <ThinkingBlock text={block.text} /> : null
    case 'tool_use':
      // 运行中的 subagent（仍在悬浮面板显示实时进度）不在主流渲染卡片。
      // 已完成的 subagent 解除隐藏，渲染为内嵌卡片（含创建指令+过程+结果）。
      if (hiddenToolUseIds?.has(block.id)) return null
      // Task 工具（subagent）：渲染为 SubagentInlineCard，组合三要素（创建参数 + 过程 + 结果）。
      // 过程来自 subagentOutputByToolUseId[block.id]，创建参数/结果在 block 自身。
      if (block.name === 'Task') {
        return <SubagentInlineCard block={block} output={subagentOutputByToolUseId?.[block.id]} showThinking={showThinking} />
      }
      if (META_TOOL_NAMES.has(block.name)) return <MetaToolCard block={block} />
      return <ToolUseCard block={block} />
    case 'tool_result': return null
    case 'image': return <ImageBlock source={block.source} />
    default: return null
  }
}

// 把连续的 tool_use block 聚合成 ToolGroup（≥2 个才分组），
// 其余 block 逐个用 BlockRenderer 渲染。供 ChatArea 统一调用，
// 让连续工具调用可整体折叠，避免一长串工具卡占满对话区。
type ToolBlock = Extract<ContentBlock, { type: 'tool_use' }>

export function renderBlocks(blocks: ContentBlock[], compact?: boolean, subagentOutputByToolUseId?: Record<string, ContentBlock[]>, hiddenToolUseIds?: Set<string>, showThinking?: boolean): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.type === 'tool_use') {
      // Task（subagent）作为分组边界：单独渲染为 SubagentInlineCard，不与普通工具聚成 ToolGroup。
      // 防止「Task + Bash」相邻时被聚成一个折叠组、把 subagent 卡埋进去。
      if (b.name === 'Task') {
        if (!hiddenToolUseIds?.has(b.id)) {
          out.push(<SubagentInlineCard key={`s${key++}`} block={b} output={subagentOutputByToolUseId?.[b.id]} showThinking={showThinking} />)
        }
        i++
        continue
      }
      // 收集连续的普通 tool_use（跳过中间夹带的 tool_result，它不渲染；Task 已作边界单独处理）
      const group: ToolBlock[] = []
      let j = i
      while (j < blocks.length) {
        const cur = blocks[j]
        if (cur.type !== 'tool_use' && cur.type !== 'tool_result') break
        // Task 不进普通分组（分组边界）
        if (cur.type === 'tool_use' && cur.name === 'Task') break
        if (cur.type === 'tool_use') group.push(cur)
        j++
      }
      const visibleGroup = hiddenToolUseIds ? group.filter(t => !hiddenToolUseIds.has(t.id)) : group
      if (visibleGroup.length >= 2) {
        out.push(<ToolGroup key={`g${key++}`} tools={visibleGroup} />)
      } else if (visibleGroup.length === 1) {
        const single = visibleGroup[0]
        if (!hiddenToolUseIds?.has(single.id)) {
          // 元工具用 MetaToolCard（语义化卡片，提供计划抽屉入口）；
          // 普通工具仍用 ToolUseCard，避免引入 useStore 依赖影响无 Provider 的渲染场景。
          if (META_TOOL_NAMES.has(single.name)) {
            out.push(<MetaToolCard key={`m${key++}`} block={single} />)
          } else {
            out.push(<ToolUseCard key={`t${key++}`} block={single} />)
          }
        }
      }
      i = j
    } else {
      if (b.type === 'text') {
        out.push(<TextBlock key={`b${key++}`} text={b.text} compact={compact} />)
      } else {
        out.push(<BlockRenderer key={`b${key++}`} block={b} subagentOutputByToolUseId={subagentOutputByToolUseId} hiddenToolUseIds={hiddenToolUseIds} showThinking={showThinking} />)
      }
      i++
    }
  }
  return out
}
