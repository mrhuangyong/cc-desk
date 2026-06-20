// 应用更新管理：封装 electron-updater，按平台分流。
// win/linux: 走 autoUpdater 全自动（autoDownload=true，用户点重启）。
// mac: 无 Apple 证书时 autoUpdater 无法静默下载安装，改为 fetch latest-mac.yml
//      比对版本，发现新版后下载 dmg + shell.openPath 自动打开（用户拖拽安装）。
// 状态机经注入的 emit 回调转发到渲染端，不直接持有 webContents（窗口刷新安全）。
import { autoUpdater } from 'electron-updater'
import { app, shell } from 'electron'
import type { UpdateStatus } from '../renderer/types'

const SUPPORTS_AUTO = process.platform === 'win32' || process.platform === 'linux'
const CHECK_INTERVAL = 4 * 60 * 60 * 1000 // 4 小时复查
const STARTUP_DELAY = 8 * 1000 // 启动后 8s 首检

// 极简 semver 大于判断（仅支持 x.y.z 数字）：返回 a > b
function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

interface MacMeta { version: string; assetName: string }

function parseMacYml(yml: string): MacMeta | null {
  const vMatch = yml.match(/^version:\s*(.+)$/m)
  if (!vMatch) return null
  const version = vMatch[1].trim()
  const dmgMatch = yml.match(/url:\s*([^\s]+\.dmg)\b/)
  const assetName = dmgMatch ? dmgMatch[1].trim() : ''
  return { version, assetName }
}

export class UpdateManager {
  private status: UpdateStatus = { state: 'idle' }
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private emit: (s: UpdateStatus) => void = () => {}
  private readonly repo: string

  constructor(opts: { repo: string }) {
    this.repo = opts.repo
    if (SUPPORTS_AUTO) {
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = false
      this.bindAutoUpdaterEvents()
    }
  }

  setEmit(fn: (s: UpdateStatus) => void) {
    this.emit = fn
  }

  sendCurrentState() {
    this.emit(this.status)
  }

  private setStatus(s: UpdateStatus) {
    this.status = s
    this.emit(s)
  }

  private bindAutoUpdaterEvents() {
    autoUpdater.on('update-available', (info: any) => {
      this.setStatus({ state: 'available', version: info?.version ?? '' })
    })
    autoUpdater.on('download-progress', (p: any) => {
      this.setStatus({ state: 'downloading', percent: Math.round(p?.percent ?? 0) })
    })
    autoUpdater.on('update-downloaded', (info: any) => {
      this.setStatus({ state: 'ready', version: info?.version ?? '' })
    })
    autoUpdater.on('update-not-available', () => {
      this.setStatus({ state: 'idle' })
    })
    autoUpdater.on('error', (e: any) => {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    })
  }

  async checkNow(): Promise<void> {
    if (!app.isPackaged) {
      this.setStatus({ state: 'idle' })
      return
    }
    this.setStatus({ state: 'checking' })
    if (SUPPORTS_AUTO) {
      try {
        await autoUpdater.checkForUpdates()
      } catch (e: any) {
        this.setStatus({ state: 'error', message: String(e?.message ?? e) })
      }
      return
    }
    // mac: fetch latest-mac.yml 比对版本
    try {
      const meta = await this.fetchMacMeta()
      if (!meta) {
        this.setStatus({ state: 'error', message: '无法解析 latest-mac.yml' })
        return
      }
      if (semverGt(meta.version, app.getVersion())) {
        this.setStatus({ state: 'available', version: meta.version })
      } else {
        this.setStatus({ state: 'idle' })
      }
    } catch (e: any) {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    }
  }

  private async fetchMacMeta(): Promise<MacMeta | null> {
    const url = `https://github.com/${this.repo}/releases/latest/download/latest-mac.yml`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`latest-mac.yml HTTP ${res.status}`)
    const yml = await res.text()
    return parseMacYml(yml)
  }

  async downloadDmgAndOpen(): Promise<void> {
    try {
      const meta = await this.fetchMacMeta()
      if (!meta || !meta.assetName) {
        this.setStatus({ state: 'error', message: '未找到 dmg 下载地址' })
        return
      }
      const url = `https://github.com/${this.repo}/releases/download/v${meta.version}/${meta.assetName}`
      const dlDir = app.getPath('downloads')
      const path = await this.downloadFile(url, `${dlDir}/${meta.assetName}`)
      await shell.openPath(path)
    } catch (e: any) {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    }
  }

  private async downloadFile(url: string, dest: string): Promise<string> {
    const { createWriteStream } = await import('fs')
    const { Readable } = await import('stream')
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(dest)
      Readable.fromWeb(res.body as any).pipe(ws)
      ws.on('finish', () => resolve())
      ws.on('error', reject)
    })
    return dest
  }

  install(): void {
    if (this.status.state === 'ready') {
      autoUpdater.quitAndInstall()
    }
  }

  startAutoCheck(): void {
    this.startupTimer = setTimeout(() => this.checkNow(), STARTUP_DELAY)
    this.timer = setInterval(() => this.checkNow(), CHECK_INTERVAL)
  }

  dispose(): void {
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
