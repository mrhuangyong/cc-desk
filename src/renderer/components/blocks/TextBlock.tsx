import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

// 文本块。
// compact 模式用于用户消息气泡：去掉外层 margin，避免在收紧的气泡里额外撑高。
// 默认（assistant 消息）保留 margin，让多 block 之间有适度留白。
export function TextBlock({ text, compact }: { text: string; compact?: boolean }) {
  if (!text) return null
  return (
    <div className={compact ? 'md-compact' : undefined} style={compact ? undefined : { margin: '10px 0' }}>
      <MarkdownRenderer text={text} />
    </div>
  )
}
