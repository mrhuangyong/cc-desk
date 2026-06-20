import { contextBridge, ipcRenderer } from 'electron'

// 主窗口 preload：通过 contextBridge 把受限的 IPC API 暴露给渲染进程。
// 所有跨进程调用都走这里，渲染进程通过 window.api.* 访问。
contextBridge.exposeInMainWorld('api', {
  claude: {
    send: (opts: any) => ipcRenderer.invoke('claude:send', opts),
    stop: (localSessionId: string) => ipcRenderer.invoke('claude:stop', localSessionId),
    runningSessions: () => ipcRenderer.invoke('claude:running-sessions') as Promise<string[]>,
    onSystem: (cb: (data: any) => void) => { ipcRenderer.on('claude:system', (_, data) => cb(data)) },
    onDelta: (cb: (data: { kind: 'text' | 'thinking'; delta: string }) => void) => { ipcRenderer.on('claude:delta', (_, data) => cb(data)) },
    onBlocks: (cb: (data: any) => void) => { ipcRenderer.on('claude:blocks', (_, data) => cb(data)) },
    onNotice: (cb: (data: any) => void) => { ipcRenderer.on('claude:notice', (_, data) => cb(data)) },
    onTask: (cb: (data: any) => void) => { ipcRenderer.on('claude:task', (_, data) => cb(data)) },
    onResult: (cb: (data: any) => void) => { ipcRenderer.on('claude:result', (_, data) => cb(data)) },
    onError: (cb: (data: { error: string }) => void) => { ipcRenderer.on('claude:error', (_, data) => cb(data)) },
    onAborted: (cb: (data: any) => void) => { ipcRenderer.on('claude:aborted', (_, data) => cb(data)) },
    onDialogRequest: (cb: (data: any) => void) => { ipcRenderer.on('claude:dialog-request', (_, data) => cb(data)) },
    onBuiltinResult: (cb: (data: any) => void) => { ipcRenderer.on('claude:builtin-result', (_, data) => cb(data)) },
    onPlan: (cb: (data: any) => void) => { ipcRenderer.on('claude:plan', (_, data) => cb(data)) },
    onSubagentOutput: (cb: (data: any) => void) => { ipcRenderer.on('claude:subagent-output', (_, data) => cb(data)) },
    dialogResponse: (payload: { reqId: string; result: any }) => ipcRenderer.invoke('claude:dialog-response', payload),
    setPermissionMode: (opts: { localSessionId: string; permission: string }) => ipcRenderer.invoke('claude:set-permission-mode', opts),
    removeAllListeners: () => {
      ['claude:system', 'claude:delta', 'claude:blocks', 'claude:notice', 'claude:task', 'claude:result', 'claude:error', 'claude:aborted', 'claude:dialog-request', 'claude:backend-task', 'claude:builtin-result', 'claude:plan', 'claude:subagent-output', 'update:state']
        .forEach(ch => ipcRenderer.removeAllListeners(ch))
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s: any) => ipcRenderer.invoke('settings:save', s)
  },
  ccDesk: {
    model: {
      get: () => ipcRenderer.invoke('cc-desk:model:get'),
      save: (patch: any) => ipcRenderer.invoke('cc-desk:model:save', patch),
    },
  },
  projects: {
    get: () => ipcRenderer.invoke('projects:get'),
    save: (snap: any) => ipcRenderer.invoke('projects:save', snap)
  },
  cc: {
    mcp: {
      get: () => ipcRenderer.invoke('cc:mcp:get'),
      save: (servers: any) => ipcRenderer.invoke('cc:mcp:save', servers),
    },
    plugins: {
      get: () => ipcRenderer.invoke('cc:plugins:get'),
      setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('cc:plugin:set-enabled', id, enabled),
    },
    skills: {
      get: () => ipcRenderer.invoke('cc:skills:get'),
      getFile: (id: string) => ipcRenderer.invoke('cc:skill:get', id),
      saveFile: (id: string, content: string) => ipcRenderer.invoke('cc:skill:save', id, content),
      setEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('cc:skill:set-enabled', name, enabled),
    },
    commands: { get: () => ipcRenderer.invoke('cc:commands:get') },
    hooks: {
      get: () => ipcRenderer.invoke('cc:hooks:get'),
      setEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('cc:hook:set-enabled', name, enabled),
    },
    memory: {
      get: () => ipcRenderer.invoke('cc:memory:get'),
      save: (content: string) => ipcRenderer.invoke('cc:memory:save', content),
    },
    model: {
      get: () => ipcRenderer.invoke('cc:model:get'),
      save: (cfg: any) => ipcRenderer.invoke('cc:model:save', cfg),
    },
    general: {
      get: () => ipcRenderer.invoke('cc:general:get'),
      save: (cfg: any) => ipcRenderer.invoke('cc:general:save', cfg),
    },
    builtin: {
      compact: (localSessionId: string) => ipcRenderer.invoke('cc:builtin:compact', localSessionId),
      init: (opts: { cwd: string }) => ipcRenderer.invoke('cc:builtin:init', opts),
      exportSession: (localSessionId: string) => ipcRenderer.invoke('cc:builtin:export', localSessionId),
      addDir: (opts: { localSessionId: string; dir: string }) => ipcRenderer.invoke('cc:builtin:add-dir', opts),
    },
  },
  fs: {
    readTree: (dirPath: string) => ipcRenderer.invoke('fs:read-tree', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
    searchFiles: (dirPath: string) => ipcRenderer.invoke('fs:search-files', dirPath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:write-file', filePath, content),
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
  },
  onArchiveTick: (cb: (data: { beforeTs: number }) => void) => {
    const channel = 'archive:tick'
    const handler = (_: unknown, data: { beforeTs: number }) => cb(data)
    ipcRenderer.on(channel, handler)
    // 返回 unsubscribe，供 useEffect cleanup 调用，避免组件重 mount 时监听器累加泄漏
    return () => ipcRenderer.removeListener(channel, handler)
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
  },
  session: {
    archive: (localSessionId: string) => ipcRenderer.invoke('session:archive', localSessionId),
  },
  backendTask: {
    list: (localSessionId: string) => ipcRenderer.invoke('backend-task:list', localSessionId),
    kill: (localSessionId: string, taskId: string) => ipcRenderer.invoke('backend-task:kill', localSessionId, taskId),
    // 从主进程 registry 删除任务记录（单个或批量），避免刷新后已移除任务复活。
    remove: (localSessionId: string, taskIds: string | string[]) => ipcRenderer.invoke('backend-task:remove', localSessionId, taskIds),
    onEvent: (cb: (data: any) => void) => {
      const channel = 'claude:backend-task'
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
  },
  update: {
    // 主→渲染：状态机变更。返回 unsubscribe，防监听器累加（沿用 onArchiveTick 模式）
    onState: (cb: (s: any) => void) => {
      const channel = 'update:state'
      const handler = (_: unknown, s: any) => cb(s)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    downloadAndOpen: () => ipcRenderer.invoke('update:download-and-open'),
  },
  appVersion: {
    get: () => ipcRenderer.invoke('app:version'),
  },
})
