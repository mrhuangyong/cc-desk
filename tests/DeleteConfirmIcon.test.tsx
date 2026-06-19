import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteConfirmIcon } from '../src/renderer/components/DeleteConfirmIcon'

describe('DeleteConfirmIcon', () => {
  it('默认 variant=archive：初始显示归档图标，点击进入确认态', () => {
    render(<DeleteConfirmIcon onConfirm={() => {}} />)
    const btn = screen.getByRole('button', { name: /归档/ })
    expect(btn.querySelector('svg')).toBeTruthy()
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: /确认归档/ }).querySelector('svg')).toBeTruthy()
  })

  it('variant=delete：初始显示删除图标', () => {
    render(<DeleteConfirmIcon variant="delete" onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: /删除/ }).querySelector('svg')).toBeTruthy()
  })

  it('点击确认图标触发 onConfirm（归档）', () => {
    const onConfirm = vi.fn()
    render(<DeleteConfirmIcon onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /归档/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认归档/ }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('确认态只有一个确认按钮，无取消按钮', () => {
    const onConfirm = vi.fn()
    render(<DeleteConfirmIcon onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: /归档/ }))
    expect(screen.getByRole('button', { name: /确认归档/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /取消/ })).toBeNull()
  })

  it('鼠标离开确认态则还原', () => {
    const onConfirm = vi.fn()
    render(<DeleteConfirmIcon onConfirm={onConfirm} />)
    const btn = screen.getByRole('button', { name: /归档/ })
    fireEvent.click(btn)
    const confirmBtn = screen.getByRole('button', { name: /确认归档/ })
    fireEvent.mouseLeave(confirmBtn)
    expect(screen.getByRole('button', { name: /归档/ }).querySelector('svg')).toBeTruthy()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
