import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../state/store'
import { URL_RE, cleanUrl } from '../utils/url'

// 终端配色表：跟随应用主题。codex-dark 用深色（与历史配色一致），其余浅色主题用浅色。
// 范式对齐 Monaco 的 monacoThemeFor（src/renderer/editor/monacoEnv.ts）。
function terminalThemeFor(themeId: string): ITheme {
  if (themeId === 'codex-dark') {
    return {
      background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#d4d4d4',
      cursorAccent: '#1e1e1e', selectionBackground: '#264f78',
      black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
      blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
      brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
      brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
      brightCyan: '#29b8db', brightWhite: '#ffffff',
    }
  }
  // 浅色（codex-light / codex-warm / codex-cool / codex-paper 共用）
  return {
    background: '#ffffff', foreground: '#1e1e1e', cursor: '#1e1e1e',
    cursorAccent: '#ffffff', selectionBackground: '#add6ff',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#b58900',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#555555',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
    brightYellow: '#e5e510', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
    brightCyan: '#29b8db', brightWhite: '#1e1e1e',
  }
}

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
      theme: terminalThemeFor(state.theme),
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
          const url = cleanUrl(raw)
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
    const offOutput = window.api?.pty.onOutput(onOutput)

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
    const offExit = window.api?.pty.onExit(onExit)

    return () => {
      resizeObserver.disconnect()
      linkProvider.dispose()
      disposables.forEach((d) => d.dispose())
      offOutput?.()
      offExit?.()
      term.dispose()
      window.api?.pty.kill(tabId)
    }
  }, [tabId, cwd, terminalFont, dispatch])

  // 主题变化时运行时更新 xterm 配色：xterm 支持运行时改 options.theme，自动重绘，
  // 无需重建实例、不丢历史。独立于挂载 effect（有 createdRef 单次保护），互不干扰。
  // 首次挂载期间若 termRef 尚未赋值，用 ?. 跳过——初始 theme 已在挂载 effect 内设置。
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalThemeFor(state.theme)
  }, [state.theme])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', padding: 4 }} />
}
