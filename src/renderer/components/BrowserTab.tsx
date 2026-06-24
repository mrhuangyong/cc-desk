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

export function BrowserTab({ initialUrl }: { initialUrl?: string }) {
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
  }

  const go = (delta: number) => {
    const ni = idx + delta
    if (ni < 0 || ni >= history.length) return
    setIdx(ni)
    setUrl(history[ni])
    setInput(history[ni])
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

  // webview 是独立 Chromium 渲染进程，容器（右栏）拖动改变宽度时，CSS flex
  // 尺寸变化不总能触发 guest 页面 viewport 重排——导致右栏缩放时浏览器内容
  // 不跟着变。用 ResizeObserver 监听包装容器，回调里把容器尺寸显式写到
  // webview 的 style，强制其内部重新布局（与 TerminalTab 的 ResizeObserver
  // + fit 模式同理：主动通知而非依赖被动 stretch）。
  useEffect(() => {
    const wrap = webviewWrapRef.current
    const wv = webviewRef.current
    if (!wrap || !wv) return
    const apply = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (w === 0 || h === 0) return
      wv.style.width = `${w}px`
      wv.style.height = `${h}px`
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(wrap)
    return () => ro.disconnect()
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
        <div ref={webviewWrapRef} style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
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
