import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RefreshCw, Bug, MousePointerClick } from 'lucide-react'
import { useStore } from '../state/store'
import { Tooltip } from './Tooltip'

// 拾取模式注入到 webview guest 页面的脚本。
// 职责：mousemove 高亮悬停元素；click 阻止默认、采集元素信息、通过 console.log 回传宿主、卸载监听。
// 回传通道：webview 的 console-message 事件能捕获 guest 页面的 console 输出，
// 用特殊前缀标记拾取结果，宿主解析。无需 preload / ipc，绕开跨进程 postMessage 不可达的问题。
const PICK_MARKER = '__CCDESK_PICK__'
const PICKER_SCRIPT = `
(function () {
  if (window.__ccDeskPicker) return; // 防重复安装
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #d97757;background:rgba(217,119,87,0.15);display:none;';
  document.body.appendChild(overlay);
  function onMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay) return;
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay) return;
    function selectorPath(node) {
      var parts = [];
      while (node && node.nodeType === 1 && node !== document.documentElement) {
        var part = node.tagName.toLowerCase();
        if (node.id) { part += '#' + node.id; parts.unshift(part); break; }
        if (node.className && typeof node.className === 'string') {
          var cls = node.className.trim().split(/\\s+/).slice(0, 2).join('.');
          if (cls) part += '.' + cls;
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }
    var text = (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    var html = el.outerHTML || '';
    if (html.length > 500) html = html.slice(0, 500) + '...';
    // 用 console.log + 特殊前缀回传，宿主通过 webview 的 console-message 事件捕获
    var payload = JSON.stringify({ source: location.href, tag: el.tagName.toLowerCase(), text: text, selector: selectorPath(el), html: html });
    console.log('${PICK_MARKER}' + payload);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    overlay.remove();
    delete window.__ccDeskPicker;
  }
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  window.__ccDeskPicker = true;
})();
`

// 某些预览页会在 webview 内部用 iframe height:100% 承载实际内容，但 iframe 的父级
// 没有明确高度，导致 100% 高度链断开。只修声明了 100% 高度的 iframe 祖先链，避免
// 影响普通网页布局。
export const VIEWPORT_CHAIN_FIX_SCRIPT = `
(function () {
  var STYLE_ID = 'ccdesk-browser-viewport-chain-fix';
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      'html, body { width: 100% !important; height: 100% !important; min-height: 100% !important; }',
      'iframe[data-ccdesk-fullheight="true"] { width: 100% !important; height: 100% !important; display: block !important; }'
    ].join('\\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function wantsFullHeight(iframe) {
    var heightAttr = (iframe.getAttribute('height') || '').trim();
    var inlineHeight = (iframe.style && iframe.style.height || '').trim();
    var styleText = iframe.getAttribute('style') || '';
    return heightAttr === '100%' || inlineHeight === '100%' || /height\\s*:\\s*100%/i.test(styleText);
  }

  Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (iframe) {
    if (!wantsFullHeight(iframe)) return;
    iframe.setAttribute('data-ccdesk-fullheight', 'true');
    var el = iframe.parentElement;
    while (el && el !== document.documentElement) {
      el.style.minHeight = '100%';
      el.style.height = '100%';
      if (getComputedStyle(el).display === 'inline') el.style.display = 'block';
      el = el.parentElement;
    }
  });
})();
`

export function injectViewportChainFix(webview: Pick<WebviewEl, 'executeJavaScript'>): void {
  try {
    const result = webview.executeJavaScript?.(VIEWPORT_CHAIN_FIX_SCRIPT)
    if (result && typeof result.catch === 'function') {
      result.catch((err: unknown) => {
        console.warn('[cc-desk] 注入浏览器高度链修复失败', err)
      })
    }
  } catch (err) {
    console.warn('[cc-desk] 注入浏览器高度链修复失败', err)
  }
}

export function syncWebviewShadowFrameSize(webview: Pick<HTMLElement, 'clientHeight' | 'clientWidth' | 'shadowRoot'>): void {
  const iframe = webview.shadowRoot?.querySelector('iframe') as HTMLIFrameElement | null
  if (!iframe) return
  const h = webview.clientHeight
  const w = webview.clientWidth
  if (w > 0) iframe.style.width = '100%'
  if (h > 0) iframe.style.height = `${h}px`
  iframe.style.minHeight = '0'
  iframe.style.display = 'block'
  iframe.style.border = '0'
}

interface PickedInfo {
  source: string
  tag: string
  text: string
  selector: string
  html: string
}

// webview 元素的最小类型（DOM 自定义元素 + webview 特有方法/事件）
type WebviewEl = HTMLDivElement & {
  executeJavaScript?: (code: string) => Promise<unknown>
  reload?: () => void
  openDevTools?: () => void
}

export function BrowserTab({ tabId, initialUrl }: { tabId: string; initialUrl?: string }) {
  const { state, dispatch } = useStore()
  const webviewRef = useRef<WebviewEl | null>(null)
  const webviewWrapRef = useRef<HTMLDivElement | null>(null)
  const [url, setUrl] = useState(initialUrl ?? '')
  const [input, setInput] = useState(initialUrl ?? '')
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : [])
  const [idx, setIdx] = useState(0)
  const [picking, setPicking] = useState(false)

  const navigate = (next: string) => {
    const full = next.startsWith('http') ? next : `https://${next}`
    const newHistory = [...history.slice(0, idx + 1), full]
    setHistory(newHistory)
    setIdx(newHistory.length - 1)
    setUrl(full)
    setInput(full)
    dispatch({ type: 'UPDATE_TAB_URL', tabId, url: full })
  }

  const go = (delta: number) => {
    const ni = idx + delta
    if (ni < 0 || ni >= history.length) return
    setIdx(ni)
    setUrl(history[ni])
    setInput(history[ni])
    dispatch({ type: 'UPDATE_TAB_URL', tabId, url: history[ni] })
  }

  // 通过 webview 的 console-message 事件接收 guest 页面回传的拾取结果
  const handleConsoleMessage = (e: Event) => {
    const detail = (e as unknown as { message?: string }).message
    if (typeof detail !== 'string' || !detail.startsWith(PICK_MARKER)) return
    try {
      const info = JSON.parse(detail.slice(PICK_MARKER.length)) as PickedInfo
      // 拾取结果作为附件填入草稿（chip 形态），用户可继续编辑文本后发送
      dispatch({ type: 'ADD_DRAFT_ATTACHMENT', attachment: { type: 'pickedElement', el: info } })
      setPicking(false)
    } catch {
      // 解析失败忽略
    }
  }

  // webview 挂载后绑定 console-message 监听
  const setWebviewRef = (el: WebviewEl | null) => {
    if (webviewRef.current) {
      webviewRef.current.removeEventListener('console-message', handleConsoleMessage)
    }
    webviewRef.current = el
    if (el) {
      el.addEventListener('console-message', handleConsoleMessage)
    }
  }

  // 清理
  useEffect(() => {
    return () => {
      if (webviewRef.current) {
        webviewRef.current.removeEventListener('console-message', handleConsoleMessage)
      }
    }
  }, [])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || typeof wv.executeJavaScript !== 'function') return
    const injectViewportFix = () => injectViewportChainFix(wv)
    wv.addEventListener('dom-ready', injectViewportFix)
    wv.addEventListener('did-finish-load', injectViewportFix)
    return () => {
      wv.removeEventListener('dom-ready', injectViewportFix)
      wv.removeEventListener('did-finish-load', injectViewportFix)
    }
  }, [url])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const syncGuestUrl = (e: Event) => {
      const nextUrl = (e as unknown as { url?: string }).url
      if (!nextUrl) return
      setUrl(nextUrl)
      setInput(nextUrl)
      dispatch({ type: 'UPDATE_TAB_URL', tabId, url: nextUrl })
    }
    wv.addEventListener('did-navigate', syncGuestUrl)
    wv.addEventListener('did-navigate-in-page', syncGuestUrl)
    return () => {
      wv.removeEventListener('did-navigate', syncGuestUrl)
      wv.removeEventListener('did-navigate-in-page', syncGuestUrl)
    }
  }, [dispatch, tabId, url])

  // webview 是独立 Chromium 渲染进程，且元素异步 attach。CSS height:100% 对 webview 不可靠
  // （Electron webview 有固有 preferred size，常表现为 ~140px 默认高度）。用 ResizeObserver
  // 高度由包装层显式写到 webview style.px；宽度保持 100% 交给 flex 布局自适应。
  // 不能把宽度写成像素值，否则右栏拖宽后如果 ResizeObserver/动画时序错过一帧，
  // webview 会残留旧宽度（例如 420px）。
  useEffect(() => {
    const wrap = webviewWrapRef.current
    const wv = webviewRef.current
    if (!wrap || !wv) return
    let rafId = 0
    const syncSize = () => {
      const h = wrap.clientHeight
      wv.style.width = '100%'
      if (h === 0) return
      wv.style.height = `${h}px`
      syncWebviewShadowFrameSize(wv)
    }
    const scheduleSync = () => {
      syncSize()
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(syncSize)
    }
    scheduleSync()
    // webview attach 后布局稳定，再 apply 一次（解决 effect 早跑、attach晚的问题）
    const onAttach = scheduleSync
    wv.addEventListener('did-attach', onAttach)
    const ro = new ResizeObserver(scheduleSync)
    ro.observe(wrap)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      wv.removeEventListener('did-attach', onAttach)
      ro.disconnect()
    }
  }, [url])

  const togglePick = () => {
    const wv = webviewRef.current
    if (picking) {
      setPicking(false)
      return
    }
    if (!wv || typeof wv.executeJavaScript !== 'function') {
      console.error('[cc-desk] webview 未就绪，拾取不可用')
      return
    }
    setPicking(true)
    wv.executeJavaScript(PICKER_SCRIPT).catch((err: unknown) => {
      console.error('[cc-desk] 注入拾取脚本失败', err)
      setPicking(false)
    })
  }

  const btnBase: React.CSSProperties = {
    fontSize: 16, padding: '4px 8px', lineHeight: 1, cursor: 'pointer',
    background: 'transparent', border: 'none'
  }
  // 拾取态按钮：强调色填充背景，明显区分激活/非激活
  const pickBtnStyle: React.CSSProperties = picking
    ? { ...btnBase, color: 'var(--accent-text)', background: 'var(--accent)', borderRadius: 'var(--radius)' }
    : { ...btnBase, color: 'var(--text-muted)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <Tooltip label="后退"><button disabled={idx === 0} onClick={() => go(-1)} style={{ ...btnBase, color: idx === 0 ? 'var(--text-muted)' : 'var(--text-muted)', opacity: idx === 0 ? 0.3 : 1, display: 'inline-flex', alignItems: 'center' }}><ArrowLeft size={16} /></button></Tooltip>
        <Tooltip label="前进"><button disabled={idx >= history.length - 1} onClick={() => go(1)} style={{ ...btnBase, color: 'var(--text-muted)', opacity: idx >= history.length - 1 ? 0.3 : 1, display: 'inline-flex', alignItems: 'center' }}><ArrowRight size={16} /></button></Tooltip>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') navigate(input) }}
          style={{ flex: 1, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)' }}
        />
        <Tooltip label="刷新"><button onClick={() => webviewRef.current?.reload?.()} style={{ ...btnBase, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}><RefreshCw size={16} /></button></Tooltip>
        <Tooltip label="控制台 (DevTools)"><button onClick={() => webviewRef.current?.openDevTools?.()} style={{ ...btnBase, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}><Bug size={16} /></button></Tooltip>
        <Tooltip label={picking ? '拾取中…（点击取消）' : '拾取元素填入对话输入框'}>
        <button
          onClick={togglePick}
          style={{ ...pickBtnStyle, display: 'inline-flex', alignItems: 'center' }}
        ><MousePointerClick size={16} /></button>
        </Tooltip>
      </div>
      {url ? (
        <div ref={webviewWrapRef} style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          <webview
            ref={setWebviewRef}
            src={url}
            style={{ display: 'block', width: '100%', height: '100%', border: 'none', background: '#fff' }}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          在地址栏输入网址开始浏览
        </div>
      )}
    </div>
  )
}
