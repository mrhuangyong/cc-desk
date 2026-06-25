export type FileKind = 'binary' | 'image' | 'text'

const BINARY_EXTS = new Set([
  // 压缩 / 打包
  '.dmg', '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz',
  // 可执行 / 库
  '.exe', '.msi', '.dll', '.so', '.dylib', '.class', '.jar', '.bin',
  // Office 文档（二进制格式）
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 字体
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // 音视频
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.flac', '.wav', '.aac', '.ogg', '.webm',
  // 数据库 / 其它
  '.sqlite', '.db', '.lock', '.pyc', '.o',
])

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'])

export function fileKindOf(filePath: string): FileKind {
  const dot = filePath.lastIndexOf('.')
  if (dot <= 0) return 'text'                         // 无扩展名或点开头文件 → text
  const ext = filePath.slice(dot).toLowerCase()       // 大小写不敏感
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'text'
}

// 绝对路径 → file:// URL（跨平台，处理反斜杠/盘符）
export function toFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  return /^([a-zA-Z]:)/.test(normalized)
    ? `file:///${normalized}`
    : `file://${normalized}`
}
