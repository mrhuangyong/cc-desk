// src/renderer/editor/goalParse.ts
// /goal 命令三态解析(纯函数):set/check/clear。
// 供 InputBar doSend 和 remote dispatcher 复用,保证两端口径一致。

const CLEAR_ALIASES = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])

export type GoalCommand =
  | { kind: 'set'; condition: string }
  | { kind: 'check' }
  | { kind: 'clear' }

// 解析 /goal 命令。非 /goal 开头返回 null。
// - '/goal' 或 '/goal  '(仅空白) → check
// - '/goal clear' / '/goal stop' / ... 别名 → clear
// - '/goal <条件>' → set(条件为 clear 别名时不视作 set,优先 clear)
export function parseGoalCommand(input: string): GoalCommand | null {
  const trimmed = input.trim()
  if (trimmed !== '/goal' && !trimmed.startsWith('/goal ')) return null
  // 提取 /goal 之后的参数
  const arg = trimmed.slice('/goal'.length).trim()
  if (arg === '') return { kind: 'check' }
  if (CLEAR_ALIASES.has(arg.toLowerCase())) return { kind: 'clear' }
  return { kind: 'set', condition: arg }
}
