import type { ContentBlock } from '../../types'
import { TextBlock } from './TextBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseCard } from './ToolUseCard'
import { ImageBlock } from './ImageBlock'

export function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text': return <TextBlock text={block.text} />
    case 'thinking': return <ThinkingBlock text={block.text} />
    case 'tool_use': return <ToolUseCard block={block} />
    case 'tool_result': return null
    case 'image': return <ImageBlock source={block.source} />
    default: return null
  }
}
