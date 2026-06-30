// src/renderer/editor/goalParse.ts
// 薄封装：从 shared 层 re-export，保持既有 import 路径（../editor/goalParse）不变。
// 实际逻辑见 src/shared/goal-parse.ts（主进程 remote-bridge 与渲染端复用同一份）。
export { parseGoalCommand, type GoalCommand } from '../../shared/goal-parse'
