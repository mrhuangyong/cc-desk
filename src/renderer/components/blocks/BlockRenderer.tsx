import type { ContentBlock } from '../../types'
import { useStore } from '../../state/store'
import { TextBlock } from './TextBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseCard } from './ToolUseCard'
import { ToolGroup } from './ToolGroup'
import { ImageBlock } from './ImageBlock'
import { MetaToolCard } from './MetaToolCard'

// 元工具（任务/计划管理类）：用语义化卡片渲染，而非普通 ToolUseCard。
// TaskCreate/TaskUpdate/TaskList 让对话流完整记录模型的任务规划；
// ExitPlanMode 提供「查看计划」入口（plan 抽屉），解决 plan 批准后入口丢失。
const META_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'ExitPlanMode'])

export function BlockRenderer({ block, subagentOutputByToolUseId, hiddenToolUseIds }: { block: ContentBlock; subagentOutputByToolUseId?: Record<string, ContentBlock[]>; hiddenToolUseIds?: Set<string> }) {
  const { state } = useStore()
  switch (block.type) {
    case 'text': return <TextBlock text={block.text} />
    // thinking 块受「显示思考过程」设置控制：关闭时不渲染
    case 'thinking': return state.settings.showThinking ? <ThinkingBlock text={block.text} /> : null
    case 'tool_use':
      // subagent 入口的 Task 卡片不在主流显示(重心移至悬浮面板)
      if (hiddenToolUseIds?.has(block.id)) return null
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

export function renderBlocks(blocks: ContentBlock[], compact?: boolean, subagentOutputByToolUseId?: Record<string, ContentBlock[]>, hiddenToolUseIds?: Set<string>): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.type === 'tool_use') {
      // 收集连续的 tool_use（跳过中间夹带的 tool_result，它不渲染）
      const group: ToolBlock[] = []
      let j = i
      while (j < blocks.length) {
        const cur = blocks[j]
        if (cur.type !== 'tool_use' && cur.type !== 'tool_result') break
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
        out.push(<BlockRenderer key={`b${key++}`} block={b} subagentOutputByToolUseId={subagentOutputByToolUseId} hiddenToolUseIds={hiddenToolUseIds} />)
      }
      i++
    }
  }
  return out
}
