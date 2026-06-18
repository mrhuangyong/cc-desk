// src/renderer/editor/FileChip.tsx
// FileChip：TipTap inline 原子节点。refId=绝对路径，label=文件名。
// 渲染靠 ChipView；此 NodeView 仅把 ChipView 挂进 NodeViewWrapper。
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ChipView } from '../components/blocks/ChipView'

function FileChipView({ node, deleteNode, selected }: any) {
  const { refId, label } = node.attrs
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <ChipView kind="file" label={label} onRemove={deleteNode} selected={selected} />
    </NodeViewWrapper>
  )
}

export const FileChip = Node.create({
  name: 'fileChip',
  group: 'inline',
  inline: true,
  atom: true, // 原子：光标不进 chip，退格整块删
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      refId: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-chip="file"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-chip': 'file' }]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileChipView)
  },
})
