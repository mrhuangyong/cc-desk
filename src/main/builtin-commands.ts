// src/main/builtin-commands.ts
// 内置 slash 命令静态注册表 + 权限/思考映射。纯逻辑，无副作用，便于单测。
import type { BuiltinAction } from '../renderer/editor/types'

// 主进程与渲染端共享的命令形态（SlashMenuItem 的 builtin 子集）
export interface ClaudeBuiltinCommand {
  kind: 'builtin'
  id: string
  name: string              // 含斜杠，如 '/init'
  desc: string
  builtinAction: BuiltinAction
}

// 权限：中文标签 → SDK permissionMode code
export const PERMISSION_MODE_MAP: Record<string, string> = {
  '变更前确认': 'default',
  '自动编辑':   'acceptEdits',
  '计划模式':   'plan',
  '完全访问':   'bypassPermissions',
}

export function getPermissionMode(label: string | null | undefined): string {
  return (label && PERMISSION_MODE_MAP[label]) || 'default'
}

// 17 条内置命令
export const BUILTIN_COMMANDS: ClaudeBuiltinCommand[] = [
  // 跳设置面板
  { kind: 'builtin', id: 'builtin:config', name: '/config', desc: '应用设置', builtinAction: { type: 'open-settings', section: 'general' } },
  { kind: 'builtin', id: 'builtin:model', name: '/model', desc: '切换模型', builtinAction: { type: 'open-settings', section: 'model' } },
  { kind: 'builtin', id: 'builtin:mcp', name: '/mcp', desc: 'MCP 服务器', builtinAction: { type: 'open-settings', section: 'mcp' } },
  { kind: 'builtin', id: 'builtin:hooks', name: '/hooks', desc: '钩子配置', builtinAction: { type: 'open-settings', section: 'hooks' } },
  { kind: 'builtin', id: 'builtin:permissions', name: '/permissions', desc: '权限模式', builtinAction: { type: 'open-permission-menu' } },
  // 会话操作
  { kind: 'builtin', id: 'builtin:clear', name: '/clear', desc: '清空当前会话', builtinAction: { type: 'clear-session' } },
  { kind: 'builtin', id: 'builtin:compact', name: '/compact', desc: '压缩上下文（流式中禁用）', builtinAction: { type: 'compact' } },
  { kind: 'builtin', id: 'builtin:cost', name: '/cost', desc: '本会话费用统计', builtinAction: { type: 'show-cost' } },
  // 主进程 IPC
  { kind: 'builtin', id: 'builtin:init', name: '/init', desc: '生成 CLAUDE.md', builtinAction: { type: 'init-project' } },
  { kind: 'builtin', id: 'builtin:export', name: '/export', desc: '导出会话为 Markdown', builtinAction: { type: 'export-session' } },
  { kind: 'builtin', id: 'builtin:add-dir', name: '/add-dir', desc: '追加可访问目录', builtinAction: { type: 'add-dir' } },
  // 渲染端纯逻辑
  { kind: 'builtin', id: 'builtin:status', name: '/status', desc: '当前状态', builtinAction: { type: 'show-status' } },
  { kind: 'builtin', id: 'builtin:resume', name: '/resume', desc: '恢复历史会话', builtinAction: { type: 'resume' } },
  // 插入文本
  { kind: 'builtin', id: 'builtin:review', name: '/review', desc: '审查当前改动', builtinAction: { type: 'run-review' } },
  { kind: 'builtin', id: 'builtin:release-notes', name: '/release-notes', desc: '查看更新日志', builtinAction: { type: 'insert-text' } },
  { kind: 'builtin', id: 'builtin:feedback', name: '/feedback', desc: '提交反馈', builtinAction: { type: 'insert-text' } },
  { kind: 'builtin', id: 'builtin:bug', name: '/bug', desc: '提交 Bug', builtinAction: { type: 'insert-text' } },
]
