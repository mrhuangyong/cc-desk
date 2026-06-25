import { describe, it, expect, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { AppProvider } from '../src/renderer/state/store'
import { BrowserTab, injectViewportChainFix, syncWebviewShadowFrameSize, VIEWPORT_CHAIN_FIX_SCRIPT } from '../src/renderer/components/BrowserTab'
import { TabBar } from '../src/renderer/components/TabBar'
import { getPanelContentLockWidth } from '../src/renderer/components/RightPanel'
import { seedProjects } from './fixtures'

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  window.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
})

describe('浏览器 Tab 布局', () => {
  it('BrowserTab 根节点允许在 flex 容器内按可视区域伸缩', () => {
    const { container } = render(
      <AppProvider initialProjects={structuredClone(seedProjects)}>
        <BrowserTab tabId="browser-tab-1" initialUrl="http://localhost:5173/" />
      </AppProvider>
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.style.display).toBe('flex')
    expect(root.style.height).toBe('100%')
    expect(root.style.minHeight).toBe('0px')
    expect(root.style.minWidth).toBe('0px')

    const webview = container.querySelector('webview') as HTMLElement
    expect(webview.style.width).toBe('100%')
  })

  it('TabBar 根节点允许内容区跟随右栏高度和宽度变化', () => {
    const { container } = render(
      <AppProvider initialProjects={structuredClone(seedProjects)}>
        <TabBar />
      </AppProvider>
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.style.display).toBe('flex')
    expect(root.style.height).toBe('100%')
    expect(root.style.minHeight).toBe('0px')
    expect(root.style.minWidth).toBe('0px')
  })

  it('右栏拖拽时内层内容不能继续锁定展开动画的旧宽度', () => {
    expect(getPanelContentLockWidth({ animating: true, dragging: true, originalWidth: 420 })).toBeUndefined()
    expect(getPanelContentLockWidth({ animating: true, dragging: false, originalWidth: 420 })).toBe(420)
  })

  it('webview guest 内部 100% iframe 的父级高度链会被补齐', () => {
    const host = document.createElement('div')
    const parent = document.createElement('div')
    const iframe = document.createElement('iframe')
    iframe.setAttribute('style', 'height: 100%; width: 100%;')
    parent.appendChild(iframe)
    host.appendChild(parent)
    document.body.appendChild(host)

    new Function(VIEWPORT_CHAIN_FIX_SCRIPT)()

    expect(iframe.getAttribute('data-ccdesk-fullheight')).toBe('true')
    expect(parent.style.height).toBe('100%')
    expect(parent.style.minHeight).toBe('100%')
    expect(document.body.style.height).toBe('100%')

    host.remove()
  })

  it('webview dom-ready 前 executeJavaScript 同步抛错时不会打崩 BrowserTab', () => {
    const webview = {
      executeJavaScript: () => {
        throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.')
      },
    }

    expect(() => injectViewportChainFix(webview)).not.toThrow()
  })

  it('webview shadowRoot 内部 iframe 会同步宿主 webview 高度', () => {
    const webview = document.createElement('div')
    Object.defineProperty(webview, 'clientHeight', { configurable: true, value: 930 })
    Object.defineProperty(webview, 'clientWidth', { configurable: true, value: 420 })
    const shadow = webview.attachShadow({ mode: 'open' })
    const iframe = document.createElement('iframe')
    iframe.setAttribute('style', 'flex: 1 1 auto; width: 100%; border: 0px;')
    shadow.appendChild(iframe)

    syncWebviewShadowFrameSize(webview)

    expect(iframe.style.height).toBe('930px')
    expect(iframe.style.width).toBe('100%')
    expect(iframe.style.display).toBe('block')
  })
})
