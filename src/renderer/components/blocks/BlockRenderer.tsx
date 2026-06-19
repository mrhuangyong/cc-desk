import type { ContentBlock } from '../../types'
import { useStore } from '../../state/store'
import { TextBlock } from './TextBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseCard } from './ToolUseCard'
import { ToolGroup } from './ToolGroup'
import { ImageBlock } from './ImageBlock'

export function BlockRenderer({ block, subagentOutputByToolUseId }: { block: ContentBlock; subagentOutputByToolUseId?: Record<string, ContentBlock[]> }) {
  const { state } = useStore()
  switch (block.type) {
    case 'text': return <TextBlock text={block.text} />
    // thinking 块受「显示思考过程」设置控制：关闭时不渲染
    case 'thinking': return state.settings.showThinking ? <ThinkingBlock text={block.text} /> : null
    case 'tool_use': return <ToolUseCard block={block} subagentBlocks={subagentOutputByToolUseId?.[block.id]} />
    case 'tool_result': return null
    case 'image': return <ImageBlock source={block.source} />
    default: return null
  }
}

// 把连续的 tool_use block 聚合成 ToolGroup（≥2 个才分组），
// 其余 block 逐个用 BlockRenderer 渲染。供 ChatArea 统一调用，
// 让连续工具调用可整体折叠，避免一长串工具卡占满对话区。
type ToolBlock = Extract<ContentBlock, { type: 'tool_use' }>

export function renderBlocks(blocks: ContentBlock[], compact?: boolean, subagentOutputByToolUseId?: Record<string, ContentBlock[]>): React.ReactNode[] {
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
      if (group.length >= 2) {
        out.push(<ToolGroup key={`g${key++}`} tools={group} />)
      } else {
        out.push(<ToolUseCard key={`t${key++}`} block={group[0]} subagentBlocks={subagentOutputByToolUseId?.[group[0].id]} />)
      }
      i = j
    } else {
      if (b.type === 'text') {
        out.push(<TextBlock key={`b${key++}`} text={b.text} compact={compact} />)
      } else {
        out.push(<BlockRenderer key={`b${key++}`} block={b} subagentOutputByToolUseId={subagentOutputByToolUseId} />)
      }
      i++
    }
  }
  return out
}
