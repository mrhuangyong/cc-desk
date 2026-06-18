// 临时调试用：将日志写入 ~/.cc-desk/logs/bg-probe.log
import { appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const LOG_PATH = join(homedir(), '.cc-desk', 'logs', 'bg-probe.log')

export function bgLog(msg: string): void {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}
