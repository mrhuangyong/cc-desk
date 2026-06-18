import type { ContentBlock } from '../../types'
import { useStore } from '../../state/store'
import { TextBlock } from './TextBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseCard } from './ToolUseCard'
import { ImageBlock } from './ImageBlock'

export function BlockRenderer({ block }: { block: ContentBlock }) {
  const { state } = useStore()
  switch (block.type) {
    case 'text': return <TextBlock text={block.text} />
    // thinking 块受「显示思考过程」设置控制：关闭时不渲染
    case 'thinking': return state.settings.showThinking ? <ThinkingBlock text={block.text} /> : null
    case 'tool_use': return <ToolUseCard block={block} />
    case 'tool_result': return null
    case 'image': return <ImageBlock source={block.source} />
    default: return null
  }
}
