// src/main/pty-manager.ts
import * as pty from 'node-pty'
import type { WebContents } from 'electron'
import { getSettings } from './settings-store'

export class PtyManager {
  private processes = new Map<string, pty.IPty>()
  private webContents: WebContents | null = null

  setWebContents(wc: WebContents) { this.webContents = wc }

  async create(tabId: string, cols: number, rows: number, cwd?: string): Promise<void> {
    const settings = getSettings()
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
    // 继承系统终端 Profile：true 时以登录 shell 启动（-l），加载完整 profile / 代理 / 环境变量
    const loginArgs = settings.inheritTerminal && process.platform !== 'win32' ? ['-l'] : []
    // 构建子进程环境：继承当前进程 env，并注入 HTTP 代理（来自 cc-desk 自有常规设置 ~/.cc-desk/settings.json）
    const env: Record<string, string> = { ...process.env } as Record<string, string>
    if (settings.proxy) {
      env.HTTP_PROXY = settings.proxy
      env.HTTPS_PROXY = settings.proxy
      env.http_proxy = settings.proxy
      env.https_proxy = settings.proxy
    }
    const p = pty.spawn(shell, loginArgs, {
      name: 'xterm-256color',
      cols, rows,
      cwd: cwd || process.env.HOME || '/',
      env,
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
