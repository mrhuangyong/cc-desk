import { contextBridge, ipcRenderer } from 'electron'

// 主窗口 preload：通过 contextBridge 把受限的 IPC API 暴露给渲染进程。
// 所有跨进程调用都走这里，渲染进程通过 window.api.* 访问。
contextBridge.exposeInMainWorld('api', {
  claude: {
    send: (opts: any) => ipcRenderer.invoke('claude:send', opts),
    stop: () => ipcRenderer.invoke('claude:stop'),
    onStreamDelta: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:stream-delta', (_, data) => cb(data))
    },
    onSystem: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:system', (_, data) => cb(data))
    },
    onAssistant: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:assistant', (_, data) => cb(data))
    },
    onResult: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:result', (_, data) => cb(data))
    },
    onError: (cb: (data: any) => void) => {
      ipcRenderer.on('claude:error', (_, data) => cb(data))
    },
    onAborted: (cb: () => void) => {
      ipcRenderer.on('claude:aborted', () => cb())
    },
    removeAllListeners: () => {
      ;[
        'claude:stream-delta',
        'claude:system',
        'claude:assistant',
        'claude:result',
        'claude:error',
        'claude:aborted'
      ].forEach((ch) => ipcRenderer.removeAllListeners(ch))
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s: any) => ipcRenderer.invoke('settings:save', s)
  },
  fs: {
    readTree: (dirPath: string) => ipcRenderer.invoke('fs:read-tree', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath)
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
  },
  pty: {
    create: (opts: any) => ipcRenderer.invoke('pty:create', opts),
    input: (opts: any) => ipcRenderer.invoke('pty:input', opts),
    resize: (opts: any) => ipcRenderer.invoke('pty:resize', opts),
    kill: (tabId: string) => ipcRenderer.invoke('pty:kill', tabId),
    onOutput: (cb: (data: any) => void) => {
      ipcRenderer.on('pty:output', (_, data) => cb(data))
    },
    onExit: (cb: (data: any) => void) => {
      ipcRenderer.on('pty:exit', (_, data) => cb(data))
    }
  }
})
