// 共享的 bare-URL 识别与清理：MarkdownRenderer（链接化）与 TerminalTab（终端超链接）共用。
// 排除 CJK 标点避免吃掉 URL 后的中文；西文尾部标点用 cleanUrl 修剪。
export const URL_RE = /https?:\/\/[^\s<>)\]"'`，。、；：！？）】》*]+/g
// 修剪 URL 尾部常见标点（URL 内部的 . 不修剪，但末尾孤立标点要剪掉）
export const TRAIL_PUNCT = /[.,;:!?)*]+$/
export function cleanUrl(url: string): string {
  return url.replace(TRAIL_PUNCT, '')
}
