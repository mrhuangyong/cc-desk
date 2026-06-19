// 修复 node-pty prebuild 的 spawn-helper 缺执行权限问题。
// node-pty 1.1.0 的 Unix prebuild 二进制发布时丢失执行位（-rw-r--r--），
// 导致 pty.spawn() 报 "posix_spawnp failed."。postinstall 钩子里强制补上。
// 参考错误堆栈：UnixTerminal.js → pty.fork → posix_spawnp(spawn-helper)
const fs = require('fs')
const path = require('path')

const PREBUILD_DIRS = ['darwin-arm64', 'darwin-x64']
const nodePtyDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')

if (!fs.existsSync(nodePtyDir)) {
  // node-pty 未安装（如 CI 的某些阶段），静默跳过
  process.exit(0)
}

for (const dir of PREBUILD_DIRS) {
  const helper = path.join(nodePtyDir, dir, 'spawn-helper')
  if (!fs.existsSync(helper)) continue
  try {
    fs.chmodSync(helper, 0o755)
    console.log(`[fix-pty-perm] chmod +x ${path.relative(process.cwd(), helper)}`)
  } catch (e) {
    console.warn(`[fix-pty-perm] 无法设置 ${helper} 权限: ${e.message}`)
  }
}
