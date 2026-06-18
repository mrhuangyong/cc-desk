// Monaco 环境配置：loader 指向本地 node_modules（非 CDN）、主题映射、语言映射。
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// 让 Monaco 从打包的本地资源加载，不依赖 CDN
loader.config({ monaco })

// cc-desk 主题 → Monaco 内置主题
export function monacoThemeFor(themeId: string): string {
  return themeId === 'codex-dark' ? 'vs-dark' : 'vs'
}

// 扩展名 → Monaco 语言 id
const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown', '.markdown': 'markdown',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.html': 'html', '.htm': 'html',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
}

export function monacoLanguageFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  const ext = filePath.slice(dot).toLowerCase()
  return LANG_BY_EXT[ext] ?? 'plaintext'
}
