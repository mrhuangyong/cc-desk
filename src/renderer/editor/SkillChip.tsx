// src/renderer/editor/SkillChip.tsx
// SkillChip：TipTap inline 原子节点。refId=带 source 的 id，label=技能 name。
// 渲染靠 ChipView；此 NodeView 仅把 ChipView 挂进 NodeViewWrapper。
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ChipView } from '../components/blocks/ChipView'

function SkillChipView({ node, deleteNode, selected }: any) {
  const { refId, label } = node.attrs
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <ChipView kind="skill" label={label} onRemove={deleteNode} selected={selected} />
    </NodeViewWrapper>
  )
}

export const SkillChip = Node.create({
  name: 'skillChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      refId: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-chip="skill"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-chip': 'skill' }]
  },
  addNodeView() {
    return ReactNodeViewRenderer(SkillChipView)
  },
})
