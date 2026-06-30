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
    // dialog 已被任一端解决（手机或桌面回答）：清桌面端残留面板，避免双端可弹时面板挂着不消失。
    onDialogResolved: (cb: (data: { reqId: string }) => void) => {
      const handler = (_: unknown, data: { reqId: string }) => cb(data)
      ipcRenderer.on('claude:dialog-resolved', handler)
      return () => ipcRenderer.removeListener('claude:dialog-resolved', handler)
    },
    // 远程（手机）发来的 user 文本：dispatcher 收到 session.message 时推给桌面，
    // 让桌面端对话里除了 AI 回复也能看到「手机问的问题」（修复桌面看不到移动端消息）。
    onRemoteUserMessage: (cb: (data: { localSessionId: string; text: string }) => void) => {
      const handler = (_: unknown, data: { localSessionId: string; text: string }) => cb(data)
      ipcRenderer.on('claude:remote-user-message', handler)
      return () => ipcRenderer.removeListener('claude:remote-user-message', handler)
    },
    // SDK user turn 的纯文本 prompt（claude:user-message）：user 消息与 assistant 走同源
    // 持久化路径。用于可靠显示+落盘用户输入（本地+远程发消息都走这条），替代脆弱的补丁。
    onUserMessage: (cb: (data: { localSessionId: string; text: string }) => void) => {
      const handler = (_: unknown, data: { localSessionId: string; text: string }) => cb(data)
      ipcRenderer.on('claude:user-message', handler)
      return () => ipcRenderer.removeListener('claude:user-message', handler)
    },
    onContextUsage: (cb: (data: any) => void) => {
      const handler = (_: unknown, data: any) => cb(data)
      ipcRenderer.on('claude:context-usage', handler)
      // 返回 unsubscribe，供 useEffect cleanup 调用，避免组件重 mount 时监听器累加泄漏
      return () => ipcRenderer.removeListener('claude:context-usage', handler)
    },
    onBuiltinResult: (cb: (data: any) => void) => { ipcRenderer.on('claude:builtin-result', (_, data) => cb(data)) },
    onSubagentOutput: (cb: (data: any) => void) => { ipcRenderer.on('claude:subagent-output', (_, data) => cb(data)) },
    onNotification: (cb: (data: any) => void) => { ipcRenderer.on('claude:notification', (_, data) => cb(data)) },
    dialogResponse: (payload: { reqId: string; result: any }) => ipcRenderer.invoke('claude:dialog-response', payload),
    // 刷新后拉取所有未决的挂起 dialog（AskUserQuestion/ExitPlanMode/权限），补回卡片，
    // 否则主进程 Promise 永久挂起导致 SDK 死锁。invoke 一次性查询，无需订阅/退订。
    pendingDialogs: () => ipcRenderer.invoke('claude:pending-dialogs') as Promise<Array<{ reqId: string; localSessionId?: string; dialogKind: string; payload: any; toolUseId?: string }>>,
    setPermissionMode: (opts: { localSessionId: string; permission: string }) => ipcRenderer.invoke('claude:set-permission-mode', opts),
    contextUsage: (localSessionId: string) => ipcRenderer.invoke('claude:context-usage', localSessionId),
    // /goal: set/clear 同步主进程 goalStore;evaluated/achieved 是 Stop hook 评估结果的下行通知。
    setGoal: (lsid: string, condition: string) => ipcRenderer.invoke('claude:set-goal', lsid, condition),
    clearGoal: (lsid: string) => ipcRenderer.invoke('claude:clear-goal', lsid),
    onGoalEvaluated: (cb: (data: any) => void) => { ipcRenderer.on('claude:goal-evaluated', (_, data) => cb(data)) },
    onGoalAchieved: (cb: (data: any) => void) => { ipcRenderer.on('claude:goal-achieved', (_, data) => cb(data)) },
    removeAllListeners: () => {
      ['claude:system', 'claude:delta', 'claude:blocks', 'claude:notice', 'claude:task', 'claude:result', 'claude:error', 'claude:aborted', 'claude:dialog-request', 'claude:dialog-resolved', 'claude:remote-user-message', 'claude:user-message', 'claude:context-usage', 'claude:backend-task', 'claude:builtin-result', 'claude:subagent-output', 'claude:notification', 'claude:goal-evaluated', 'claude:goal-achieved', 'update:state']
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
    save: (snap: any) => ipcRenderer.invoke('projects:save', snap),
    // 主→渲染：远程控制（手机新建/归档会话）改变了 projects.json，渲染端据此重新 HYDRATE 同步。
    // 远程控制是独立数据通路（直读写快照，绕过 renderer reducer），故需主动通知避免数据分叉。
    onWorkspaceChanged: (cb: () => void) => {
      const channel = 'workspace:changed'
      const handler = () => cb()
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
  },
  cc: {
    mcp: {
      get: () => ipcRenderer.invoke('cc:mcp:get'),
      save: (servers: any) => ipcRenderer.invoke('cc:mcp:save', servers),
      getJson: () => ipcRenderer.invoke('cc:mcp:get-json') as Promise<string>,
    },
    plugins: {
      get: () => ipcRenderer.invoke('cc:plugins:get'),
      setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('cc:plugin:set-enabled', id, enabled),
      install: (pluginId: string) => ipcRenderer.invoke('cc:plugin:install', pluginId),
      uninstall: (pluginId: string) => ipcRenderer.invoke('cc:plugin:uninstall', pluginId),
    },
    marketplaces: {
      get: () => ipcRenderer.invoke('cc:marketplace:get'),
      getPlugins: (name: string) => ipcRenderer.invoke('cc:marketplace:get-plugins', name),
      search: (query: string) => ipcRenderer.invoke('cc:marketplace:search', query),
      add: (source: string, options?: any) => ipcRenderer.invoke('cc:marketplace:add', source, options),
      remove: (name: string) => ipcRenderer.invoke('cc:marketplace:remove', name),
      refresh: (name: string) => ipcRenderer.invoke('cc:marketplace:refresh', name),
      refreshAll: () => ipcRenderer.invoke('cc:marketplace:refresh-all'),
      setAutoUpdate: (name: string, enabled: boolean) => ipcRenderer.invoke('cc:marketplace:set-auto-update', name, enabled),
    },
    skills: {
      get: () => ipcRenderer.invoke('cc:skills:get'),
      getFile: (id: string) => ipcRenderer.invoke('cc:skill:get', id),
      saveFile: (id: string, content: string) => ipcRenderer.invoke('cc:skill:save', id, content),
      setEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('cc:skill:set-enabled', name, enabled),
    },
    commands: {
      get: () => ipcRenderer.invoke('cc:commands:get'),
      create: (name: string, description: string) => ipcRenderer.invoke('cc:command:create', name, description),
      getFile: (source: string, name: string) => ipcRenderer.invoke('cc:command:get-file', source, name),
      saveFile: (name: string, content: string) => ipcRenderer.invoke('cc:command:save', name, content),
      delete: (name: string) => ipcRenderer.invoke('cc:command:delete', name),
    },
    hooks: {
      get: () => ipcRenderer.invoke('cc:hooks:get'),
      save: (hooks: any) => ipcRenderer.invoke('cc:hooks:save', hooks),
      getJson: () => ipcRenderer.invoke('cc:hooks:get-json'),
      saveJson: (jsonText: string) => ipcRenderer.invoke('cc:hooks:save-json', jsonText),
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
    statKind: (filePath: string) => ipcRenderer.invoke('fs:stat-kind', filePath),
  },
  git: {
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, scope: string, filePath?: string) => ipcRenderer.invoke('git:diff', cwd, scope, filePath),
    add: (cwd: string, paths: string[]) => ipcRenderer.invoke('git:add', cwd, paths),
    restore: (cwd: string, paths: string[], staged: boolean) => ipcRenderer.invoke('git:restore', cwd, paths, staged),
    commit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', cwd, message),
    resetHard: (cwd: string) => ipcRenderer.invoke('git:reset-hard', cwd),
    generateCommitMessage: (cwd: string) => ipcRenderer.invoke('git:generate-commit-message', cwd),
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
  setDevTools: (enabled: boolean) => ipcRenderer.invoke('app:set-devtools', enabled),
  remote: {
    getConfig: () => ipcRenderer.invoke('remote:get-config'),
    saveConfig: (patch: any) => ipcRenderer.invoke('remote:save-config', patch),
    // 生成配对码 + 二维码（返回 { code, qr, expiresAt } 或 { error }）
    pair: () => ipcRenderer.invoke('remote:pair'),
    // 取消尚未被消费的配对码（v1：码在中继侧 60s 自动过期，桌面端仅清本地展示态）
    cancelPair: () => ipcRenderer.invoke('remote:cancel-pair'),
    // 解绑设备：通知中继删绑定 + 清本地 pairedDevices
    unpair: (deviceId: string) => ipcRenderer.invoke('remote:unpair', deviceId),
    // 创建分享链接（返回 { token, url, qr, expiresAt } 或 { error }）
    createShareLink: (expiresInDays: number) => ipcRenderer.invoke('remote:create-share-link', expiresInDays),
    // 撤销分享链接（本地删除 + 通知中继 revoke）
    revokeShareLink: (token: string) => ipcRenderer.invoke('remote:revoke-share-link', token),
    // 主→渲染：配对相关事件（如手机配对成功通知，刷新已配对列表）
    onPairEvent: (cb: (data: any) => void) => {
      const channel = 'remote:pair-event'
      const handler = (_: any, data: any) => cb(data)
      ipcRenderer.on(channel, handler)
      // 返回 unsubscribe，防监听器累加（沿用 onArchiveTick 模式）
      return () => ipcRenderer.removeListener(channel, handler)
    },
    // 主→渲染：bridge 连接状态变更（connected: boolean）
    onState: (cb: (s: { connected: boolean }) => void) => {
      const channel = 'remote:state'
      const handler = (_: any, s: any) => cb(s)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    removeAllListeners: () => {
      ['remote:pair-event', 'remote:state'].forEach(ch => ipcRenderer.removeAllListeners(ch))
    },
  },
})
