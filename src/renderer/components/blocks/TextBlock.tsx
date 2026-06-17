import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

export function TextBlock({ text }: { text: string }) {
  if (!text) return null
  return <MarkdownRenderer text={text} />
}
