// src/renderer/editor/FileSuggestion.tsx
// @ 触发：文件菜单，实时 fs.readTree + 目录导航 + 上限 50。
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { makeSuggestionController } from './suggestionController'
import { filterFileItems } from './fileNav'
import { Folder, File as FileIcon } from 'lucide-react'
import type { FileNode } from '../types'
import type { FileMenuItem } from './types'

const FILE_LIMIT = 50

// 拼接 cwd + prefix 成绝对路径（浏览器端无 path 模块，手写）
function joinDir(cwd: string, prefix: string): string {
  if (!prefix) return cwd
  const base = cwd.endsWith('/') ? cwd : cwd + '/'
  return base + prefix
}

// 独立 pluginKey：与 slashSuggestion 区分，避免 ProseMirror 同 key plugin 冲突。
const filePluginKey = new PluginKey('fileSuggestion')

export function buildFileExtension(getCwd: () => string): Extension {
  // 目录层缓存：key=目录绝对路径，value=该目录直接子节点列表。
  // 按需读取——用户进入某目录时才读该目录，不受 readTree depth 限制，可下钻到任意层级。
  const dirCache = new Map<string, FileNode[]>()

  async function listLayer(cwd: string, prefix: string): Promise<FileNode[]> {
    const absDir = joinDir(cwd, prefix)
    if (dirCache.has(absDir)) return dirCache.get(absDir)!
    const tree = await (window as any).api.fs.readTree(absDir)
    dirCache.set(absDir, tree)
    return tree
  }

  // query 解析：把 @a/b/c 拆成 { prefix: 'a/b/', filter: 'c' }
  function parseQuery(query: string): { prefix: string; filter: string } {
    const clean = query  // query 已不含 @（suggestion 自动去掉触发符）
    const idx = clean.lastIndexOf('/')
    if (idx < 0) return { prefix: '', filter: clean }
    return { prefix: clean.slice(0, idx + 1), filter: clean.slice(idx + 1) }
  }

  return Extension.create({
    name: 'fileSuggestion',
    addOptions() {
      return {
        suggestion: {
          pluginKey: filePluginKey,
          char: '@',
          startOfLine: false,
          allowSpaces: false,
          // v3 items 接收 { query, editor, signal }；只用 query
          items: async ({ query }: { query: string }): Promise<FileMenuItem[]> => {
            const cwd = getCwd()
            if (!cwd) return []
            const { prefix, filter } = parseQuery(query)
            const layer = await listLayer(cwd, prefix)
            const { items } = filterFileItems(layer, filter, FILE_LIMIT)
            return items
          },
          command: ({ editor, range, props }: { editor: any; range: any; props: FileMenuItem }) => {
            editor.chain().focus().deleteRange(range).run()
            if (props.kind === 'dir') {
              // 目录：不插节点，改写为 <目录名>/ 让用户继续钻下层
              editor.chain().focus().insertContent(props.name + '/').run()
            } else {
              // 文件：插入 fileChip
              editor.chain().focus().insertContent({
                type: 'fileChip',
                attrs: { refId: props.absPath, label: props.name },
              }).insertContent(' ').run()
            }
          },
          render: () => makeSuggestionController<FileMenuItem>({
            renderItem: (item, _selected) => {
              const isDir = item.kind === 'dir'
              const Icon = isDir ? Folder : FileIcon
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <Icon size={13} />
                  <span>{item.name}</span>
                  {isDir && <span style={{ color: 'var(--text-muted)' }}>/</span>}
                </span>
              )
            },
            emptyHint: '目录为空或无权限',
            buildFooter: (items) => items.length >= FILE_LIMIT
              ? <div style={{ padding: '4px 10px', color: 'var(--text-muted)', fontSize: 11 }}>...可能还有更多，输入更精确的关键字</div>
              : null,
          }),
        },
      }
    },
    addProseMirrorPlugins() {
      // v3 要求显式传 editor 给 Suggestion（v2 自动从 context 取）
      return [Suggestion({ ...this.options.suggestion, editor: this.editor } as any)]
    },
  })
}
