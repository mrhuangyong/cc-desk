import { existsSync } from 'fs'
import { createRequire } from 'module'
import { sep } from 'path'

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'

export function toAsarUnpackedPath(filePath: string): string {
  const marker = `${sep}app.asar${sep}`
  if (!filePath.includes(marker)) return filePath
  return filePath.replace(marker, `${sep}app.asar.unpacked${sep}`)
}

function platformPackageNames(platform = process.platform, arch = process.arch): string[] {
  if (platform === 'win32') return [`${SDK_PACKAGE}-win32-${arch}`]
  if (platform === 'darwin') return [`${SDK_PACKAGE}-darwin-${arch}`]
  if (platform === 'linux') return [`${SDK_PACKAGE}-linux-${arch}`, `${SDK_PACKAGE}-linux-${arch}-musl`]
  return []
}

export function resolveClaudeCodeExecutable(): string | undefined {
  const requireFromHere = createRequire(import.meta.url)
  let requireFromSdk = requireFromHere
  try {
    requireFromSdk = createRequire(requireFromHere.resolve(SDK_PACKAGE))
  } catch {
    // 保留本模块 require 兜底；SDK 若缺失，会在 import/query 阶段给出更清晰的错误。
  }

  const suffix = process.platform === 'win32' ? 'claude.exe' : 'claude'
  for (const packageName of platformPackageNames()) {
    try {
      const resolved = requireFromSdk.resolve(`${packageName}/${suffix}`)
      const executable = toAsarUnpackedPath(resolved)
      if (existsSync(executable) || resolved.includes(`${sep}app.asar${sep}`)) return executable
    } catch {
      // 继续尝试下一个平台包候选。
    }
  }
  return undefined
}
