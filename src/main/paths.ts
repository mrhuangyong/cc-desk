// src/main/paths.ts
// 应用数据的统一根目录：~/.cc-desk
// 所有自有持久化（settings / projects / 模型供应商配置 / 日志）均落在此目录下，
// 不再散落到 electron 默认的 userData 目录，也不再用 dataPath 机制改写存储位置。
import { join } from 'path'
import { homedir } from 'os'

export const CC_DESK_DIR = join(homedir(), '.cc-desk')
