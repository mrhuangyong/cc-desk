// src/main/pty-manager.ts
import * as pty from 'node-pty'
import type { WebContents } from 'electron'

export class PtyManager {
  private processes = new Map<string, pty.IPty>()
  private webContents: WebContents | null = null

  setWebContents(wc: WebContents) { this.webContents = wc }

  create(tabId: string, cols: number, rows: number, cwd?: string): void {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols, rows,
      cwd: cwd || process.env.HOME || '/',
    })
    p.onData((data: string) => {
      this.webContents?.send('pty:output', { tabId, data })
    })
    p.onExit(({ exitCode }: { exitCode: number }) => {
      this.processes.delete(tabId)
      this.webContents?.send('pty:exit', { tabId, code: exitCode })
    })
    this.processes.set(tabId, p)
  }

  write(tabId: string, data: string): void {
    this.processes.get(tabId)?.write(data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.processes.get(tabId)?.resize(cols, rows)
  }

  kill(tabId: string): void {
    const p = this.processes.get(tabId)
    if (p) { p.kill(); this.processes.delete(tabId) }
  }

  killAll(): void {
    for (const [, p] of this.processes) { p.kill() }
    this.processes.clear()
  }
}
