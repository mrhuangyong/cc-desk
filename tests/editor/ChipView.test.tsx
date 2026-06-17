import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChipView } from '../../src/renderer/components/blocks/ChipView'

describe('ChipView', () => {
  it('渲染 file 类型：图标 + 文件名', () => {
    render(<ChipView kind="file" label="InputBar.tsx" onRemove={() => {}} />)
    expect(screen.getByText('InputBar.tsx')).toBeTruthy()
  })
  it('渲染 skill 类型：图标 + 技能名', () => {
    render(<ChipView kind="skill" label="frontend-design" onRemove={() => {}} />)
    expect(screen.getByText('frontend-design')).toBeTruthy()
  })
  it('点 ✕ 触发 onRemove', () => {
    const onRemove = vi.fn()
    render(<ChipView kind="file" label="x.ts" onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
