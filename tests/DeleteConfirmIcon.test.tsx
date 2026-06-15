import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteConfirmIcon } from '../src/renderer/components/DeleteConfirmIcon'

describe('DeleteConfirmIcon', () => {
  it('初始显示删除图标，点击变为确认图标', () => {
    render(<DeleteConfirmIcon onConfirm={() => {}} />)
    const btn = screen.getByRole('button', { name: /删除/ })
    expect(btn).toHaveTextContent('🗑️')
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: /确认删除/ })).toHaveTextContent('✅')
  })

  it('点击确认图标触发 onConfirm', () => {
    const onConfirm = vi.fn()
    render(<DeleteConfirmIcon onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /删除/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('鼠标离开未确认则还原为删除图标', () => {
    const onConfirm = vi.fn()
    render(<DeleteConfirmIcon onConfirm={onConfirm} />)
    const btn = screen.getByRole('button', { name: /删除/ })
    fireEvent.click(btn)
    const confirmBtn = screen.getByRole('button', { name: /确认删除/ })
    fireEvent.mouseLeave(confirmBtn)
    expect(screen.getByRole('button', { name: /删除/ })).toHaveTextContent('🗑️')
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
