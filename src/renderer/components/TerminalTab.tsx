import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tabId: string
  cwd?: string
}

export function TerminalTab({ tabId, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const createdRef = useRef(false)

  useEffect(() => {
    if (createdRef.current || !containerRef.current) return
    createdRef.current = true

    const term = new Terminal({
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", monospace',
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

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      fit.fit()
      window.api?.pty.resize({ tabId, cols: term.cols, rows: term.rows })
    })
    resizeObserver.observe(containerRef.current)

    // pty exit
    const onExit = ({ tabId: id }: { tabId: string; code: number }) => {
      if (id === tabId) term.write('\r\n\x1b[90m[Process exited]\x1b[0m')
    }
    window.api?.pty.onExit(onExit)

    return () => {
      resizeObserver.disconnect()
      disposables.forEach((d) => d.dispose())
      term.dispose()
      window.api?.pty.kill(tabId)
    }
  }, [tabId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', padding: 4 }} />
}
