// 对话区文本里的 URL / 文件路径识别与点击打开。
// URL 走内置浏览器（OPEN_TAB），文件路径走文件预览（OPEN_FILE_TAB）。
// 相对路径基于当前会话所属项目的 cwd 解析；识别后异步校验是否存在，
// 只有真实存在的路径才可点击，避免把普通文本误判成链接。

import { useStore } from '../state/store'
import { URL_RE, cleanUrl } from './url'

// 文件路径匹配（绝对路径 / 相对路径，可选 :行号 后缀由 splitLine 解析）。
// 必须含路径分隔符 [\\/] 才会被当作路径，避免普通单词误判。
export const PATH_RE = new RegExp(
  String.raw`(?:[A-Za-z]:[\\/][^\s<>)\]"'` + '`' + String.raw`，。、；：！？）】》|]+)` +
  String.raw`|(?:\./|\.\./|\.\.\\)?(?:[^\s<>)\]"'` + '`' + String.raw`，。、；：！？）】》|\\]*?[\\/][^\s<>)\]"'` + '`' + String.raw`，。、；：！？）】》|]+)`,
  'g'
)

// 可识别为可点击「文档」路径的扩展名白名单。
// 代码文件名（.ts/.js/.py 等）在文档正文里频繁被提及，全量识别会把整段文档底部刷成「打开」卡片，
// 噪声远大于价值。故仅保留 markdown 类文档——它们适合用内置预览打开，与 FileTab 的 isMarkdown 一致。
export const DOC_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd']

// 从路径匹配里剥离行号后缀，返回 { path, line }
export function splitLine(raw: string): { path: string; line?: number } {
  const m = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(raw)
  if (!m) return { path: raw }
  const line = m[2] ? Number(m[2]) : undefined
  return { path: m[1], line }
}

// 判断路径是否为 markdown 类文档（按扩展名白名单）。代码文件名（.ts/.js 等）返回 false，
// 避免文档正文里被频繁提及的代码文件刷成「打开」卡片。
export function isDocPath(p: string): boolean {
  const ext = p.split(/[\\/]/).pop()?.split('.').pop()
  return !!ext && DOC_EXTENSIONS.includes(ext.toLowerCase())
}

// 解析相对路径到绝对路径（渲染进程，不依赖 node path 模块）
export function resolvePath(p: string, cwd: string): string {
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')) return p
  if (!cwd) return p
  const base = cwd.replace(/[\\/]+$/, '')
  const stripped = p.startsWith('./') || p.startsWith('.\\')
    ? base + '/' + p.slice(2)
    : p.startsWith('../') || p.startsWith('..\\')
      ? base + '/' + p
      : base + '/' + p
  return normalize(stripped)
}

function normalize(p: string): string {
  const isWin = /^[A-Za-z]:[\\/]/.test(p)
  const sep = isWin ? '\\' : '/'
  const parts = p.split(/[\\/]/)
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  let res = out.join(sep)
  if (p.startsWith('/') && !isWin) res = '/' + res
  if (isWin) res = res.replace(/\//g, sep)
  return res
}

export interface LinkToken {
  kind: 'url' | 'path' | 'text'
  raw: string
  href?: string  // url 模式
  path?: string  // path 模式：原始路径（可能相对）
  line?: number
}

// 把一段文本切成 token 序列：URL / 文件路径 / 纯文本。
// 文件路径不在此处校验存在性（同步函数），由渲染层异步校验。
export function tokenizeLinks(text: string): LinkToken[] {
  type Hit = { start: number; end: number; token: LinkToken }
  const hits: Hit[] = []

  URL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = URL_RE.exec(text)) !== null) {
    const url = cleanUrl(m[0])
    hits.push({ start: m.index, end: m.index + m[0].length, token: { kind: 'url', raw: m[0], href: url } })
  }

  PATH_RE.lastIndex = 0
  while ((m = PATH_RE.exec(text)) !== null) {
    const raw = m[0]
    if (raw.length < 3) continue
    if (!/[\\/]/.test(raw)) continue
    // 跳过已被 URL 命中的区间
    if (hits.some(h => m!.index >= h.start && m!.index < h.end)) continue
    // 修剪尾部标点
    const trimmed = raw.replace(/[,;:!?)>*]+$/, '')
    const sl = splitLine(trimmed)
    // 仅保留 markdown 类文档路径：代码文件名（.ts/.js 等）在正文里频繁出现，
    // 全量识别会让文档底部刷出大量「打开」卡片，噪声过大。
    if (!isDocPath(sl.path)) continue
    hits.push({ start: m.index, end: m.index + trimmed.length, token: { kind: 'path', raw: trimmed, path: sl.path, line: sl.line } })
  }

  hits.sort((a, b) => a.start - b.start)
  const tokens: LinkToken[] = []
  let cursor = 0
  for (const h of hits) {
    if (h.start < cursor) continue // 重叠跳过
    if (h.start > cursor) tokens.push({ kind: 'text', raw: text.slice(cursor, h.start) })
    tokens.push(h.token)
    cursor = h.end
  }
  if (cursor < text.length) tokens.push({ kind: 'text', raw: text.slice(cursor) })
  return tokens
}

// 打开 URL：内置浏览器 tab
export function useOpenUrl() {
  const { dispatch } = useStore()
  return (url: string) => dispatch({ type: 'OPEN_TAB', tabType: 'browser', url })
}

// 打开文件：文件预览 tab
export function useOpenFile() {
  const { dispatch } = useStore()
  return (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    dispatch({ type: 'OPEN_FILE_TAB', filePath, fileName })
  }
}

export { cleanUrl, URL_RE }
