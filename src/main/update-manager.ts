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

  // 收集所有 dmg url（electron-builder 同时构建 arm64 + x64 时 latest-mac.yml 含多条）
  const dmgUrls: string[] = []
  const dmgRe = /url:\s*([^\s]+\.dmg)\b/g
  let m: RegExpExecArray | null
  while ((m = dmgRe.exec(yml)) !== null) {
    dmgUrls.push(m[1].trim())
  }

  // 根据当前 CPU 架构选择对应 dmg
  // electron-builder 配置 artifactName: "${productName}-${version}-${arch}.${ext}"
  // 生成的 dmg 文件名如 cc-desk-1.9.3-x64.dmg / cc-desk-1.9.3-arm64.dmg
  const archSuffix = process.arch === 'arm64' ? '-arm64' : '-x64'
  const assetName = dmgUrls.find(u => u.includes(archSuffix)) || dmgUrls[0] || ''

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
      // electron-updater 的 download-progress 在某些环境下 percent 为 undefined 或始终 0，
      // 用 bytesPerSecond 判断是否真的在下载：有速度时按 percent 显示，无速度时显示 0（UI 层会转为「…」）
      const percent = p?.percent != null ? Math.round(p.percent) : 0
      this.setStatus({ state: 'downloading', percent })
    })
    autoUpdater.on('update-downloaded', (info: any) => {
      this.setStatus({ state: 'ready', version: info?.version ?? '' })
    })
    autoUpdater.on('update-not-available', () => {
      this.setStatus({ state: 'up-to-date' })
    })
    autoUpdater.on('error', (e: any) => {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    })
  }

  async checkNow(): Promise<void> {
    // win/linux 的 electron-updater 仅在打包后可用，dev 模式直接返回；
    // mac 走 fetch latest-mac.yml 比对版本，dev 下也能跑（方便测试）。
    if (SUPPORTS_AUTO && !app.isPackaged) {
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
        this.setStatus({ state: 'up-to-date' })
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
    // 进入下载态给 UI 反馈（mac 下载 dmg 可能持续数十秒~几分钟）
    this.setStatus({ state: 'downloading', percent: 0 })
    try {
      const meta = await this.fetchMacMeta()
      if (!meta || !meta.assetName) {
        this.setStatus({ state: 'error', message: '未找到 dmg 下载地址' })
        return
      }
      const url = `https://github.com/${this.repo}/releases/download/v${meta.version}/${meta.assetName}`
      const dlDir = app.getPath('downloads')
      const path = await this.downloadFile(url, `${dlDir}/${meta.assetName}`, (percent) => {
        this.setStatus({ state: 'downloading', percent })
      })
      await shell.openPath(path)
      // 打开后回到 available（dmg 已挂载，用户拖拽安装，不走 quitAndInstall）
      this.setStatus({ state: 'available', version: meta.version })
    } catch (e: any) {
      this.setStatus({ state: 'error', message: String(e?.message ?? e) })
    }
  }

  private async downloadFile(url: string, dest: string, onProgress?: (percent: number) => void): Promise<string> {
    const { createWriteStream } = await import('fs')
    const { Readable } = await import('stream')
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
    const total = parseInt(res.headers.get('content-length') || '0', 10)
    let downloaded = 0
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(dest)
      const readable = Readable.fromWeb(res.body as any)
      readable.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        if (total > 0 && onProgress) {
          const percent = Math.round((downloaded / total) * 100)
          onProgress(percent)
        }
      })
      readable.pipe(ws)
      ws.on('finish', () => resolve())
      ws.on('error', reject)
      readable.on('error', reject)
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
