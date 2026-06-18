import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../state/store'

interface Props {
  tabId: string
  cwd?: string
}

export function TerminalTab({ tabId, cwd }: Props) {
  const { state, dispatch } = useStore()
  const terminalFont = state.settings.terminalFont || '"Cascadia Code", "Fira Code", monospace'
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const createdRef = useRef(false)

  useEffect(() => {
    if (createdRef.current || !containerRef.current) return
    createdRef.current = true

    const term = new Terminal({
      fontSize: 13,
      fontFamily: terminalFont,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78'
      },
      cursorBlink: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    // Small delay to let the container size settle before fitting
    setTimeout(() => fit.fit(), 50)

    termRef.current = term
    fitRef.current = fit

    // Create pty
    window.api?.pty.create({ tabId, cols: term.cols, rows: term.rows, cwd })

    // 链接检测：终端中的 URL 可点击，用内置浏览器打开（非系统浏览器）。
    const URL_RE = /https?:\/\/[^\s<>)\]"'`，。、；：！？）】》*]+/g
    const TRAIL_PUNCT = /[.,;:!?)*]+$/
    const linkProvider = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const line = term.buffer.active.getLine(bufferLineNumber - 1)
        if (!line) { callback(undefined); return }
        const text = line.translateToString(true)
        const links: Array<{ range: { start: { x: number; y: number }; end: { x: number; y: number } }; text: string; activate: (e: MouseEvent, t: string) => void }> = []
        let m: RegExpExecArray | null
        URL_RE.lastIndex = 0
        while ((m = URL_RE.exec(text)) !== null) {
          const raw = m[0]
          const url = raw.replace(TRAIL_PUNCT, '')
          if (!url) continue
          const startX = m.index + 1  // xterm buffer 1-indexed
          const endX = m.index + url.length
          links.push({
            range: {
              start: { x: startX, y: bufferLineNumber },
              end: { x: endX, y: bufferLineNumber }
            },
            text: url,
            activate: (_e: MouseEvent, linkText: string) => {
              dispatch({ type: 'OPEN_TAB', tabType: 'browser', url: linkText })
            }
          })
        }
        callback(links.length > 0 ? links : undefined)
      }
    })

    // pty output → terminal
    const onOutput = ({ tabId: id, data }: { tabId: string; data: string }) => {
      if (id === tabId) term.write(data)
    }
    window.api?.pty.onOutput(onOutput)

    // Terminal input → pty
    const disposables = [
      term.onData((data) => {
        window.api?.pty.input({ tabId, data })
      })
    ]

    // Resize handling：容器从 display:none 切回可见时尺寸从 0 恢复，
    // 此处 refit。隐藏期间（尺寸 0）跳过，避免 FitAddon 在 0 尺寸下抛错。
    const safeFit = () => {
      const el = containerRef.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      try { fit.fit() } catch { /* 容器尺寸异常，忽略 */ }
      window.api?.pty.resize({ tabId, cols: term.cols, rows: term.rows })
    }
    const resizeObserver = new ResizeObserver(safeFit)
    resizeObserver.observe(containerRef.current)

    // pty exit
    const onExit = ({ tabId: id }: { tabId: string; code: number }) => {
      if (id === tabId) term.write('\r\n\x1b[90m[Process exited]\x1b[0m')
    }
    window.api?.pty.onExit(onExit)

    return () => {
      resizeObserver.disconnect()
      linkProvider.dispose()
      disposables.forEach((d) => d.dispose())
      term.dispose()
      window.api?.pty.kill(tabId)
    }
  }, [tabId, cwd, terminalFont, dispatch])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', padding: 4 }} />
}
