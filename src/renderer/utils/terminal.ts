// 终端 tab 的 cwd 解析：优先当前激活会话所属项目目录，回退全局 settings.cwd。
// 同时被 TabBar（点 + 新增终端）和 App 层（Cmd/Ctrl+J 快捷键）使用，
// 避免两处各自重写导致 cwd 选取口径不一致。
import type { AppState } from '../state/reducer'

export function resolveTerminalCwd(state: AppState): string | undefined {
  const project = state.projects.find(p =>
    p.sessions.some(sess => sess.id === state.activeSessionId)
  )
  return project?.path || state.settings.cwd || undefined
}
