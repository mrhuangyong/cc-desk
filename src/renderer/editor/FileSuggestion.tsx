// src/renderer/editor/FileSuggestion.tsx
// @ 触发：VSCode 式扁平文件搜索。
// 项目加载时全量扫描所有文件（searchFiles），@ 触发后按 query fuzzy 过滤，
// 列表显示完整相对路径。不再用目录树逐层下钻。
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { makeSuggestionController } from './suggestionController'
import { searchFlatFiles } from './fileNav'
import { File as FileIcon } from 'lucide-react'
import type { FlatFileItem } from './fileNav'

const FILE_LIMIT = 50

// 独立 pluginKey：与 slashSuggestion 区分，避免 ProseMirror 同 key plugin 冲突。
const filePluginKey = new PluginKey('fileSuggestion')

// 渲染单个文件项：完整路径，文件名部分加粗
function renderFileItem(item: FlatFileItem) {
  const lastSep = item.relPath.lastIndexOf('/')
  const dir = lastSep >= 0 ? item.relPath.slice(0, lastSep + 1) : ''
  const fname = lastSep >= 0 ? item.relPath.slice(lastSep + 1) : item.relPath
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', overflow: 'hidden' }}>
      <FileIcon size={13} style={{ flexShrink: 0 }} />
      {dir && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{dir}</span>}
      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fname}</span>
    </span>
  )
}

export function buildFileExtension(getCwd: () => string): Extension {
  // 全量文件缓存：同一 cwd 只扫一次。cwd 变（切项目）时重扫。
  let filesCache: { cwd: string; files: string[] } | null = null

  async function getFiles(cwd: string): Promise<string[]> {
    if (filesCache && filesCache.cwd === cwd) return filesCache.files
    const files = await (window as any).api.fs.searchFiles(cwd)
    filesCache = { cwd, files: files ?? [] }
    return filesCache.files
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
          items: async ({ query }: { query: string }): Promise<FlatFileItem[]> => {
            const cwd = getCwd()
            if (!cwd) return []
            const files = await getFiles(cwd)
            const { items } = searchFlatFiles(files, query, FILE_LIMIT)
            // searchFlatFiles 返回的 absPath 是相对路径，这里拼成绝对路径供 fileChip refId 用
            const base = cwd.endsWith('/') ? cwd : cwd + '/'
            return items.map(it => ({ relPath: it.relPath, absPath: base + it.relPath }))
          },
          command: ({ editor, range, props }: { editor: any; range: any; props: FlatFileItem }) => {
            // 单次 chain：删触发符 + 插 chip，避免两次 run() 间光标/placeholder 状态异常
            const fname = props.relPath.slice(props.relPath.lastIndexOf('/') + 1)
            editor.chain().focus().deleteRange(range).insertContent({
              type: 'fileChip',
              attrs: { refId: props.absPath, label: fname },
            }).insertContent(' ').run()
          },
          render: () => makeSuggestionController<FlatFileItem>({
            renderItem: (item, _selected) => renderFileItem(item),
            emptyHint: '无匹配文件',
            buildFooter: (items) => items.length >= FILE_LIMIT
              ? <div style={{ padding: '4px 10px', color: 'var(--text-muted)', fontSize: 11 }}>…可能还有更多，输入更精确的关键字</div>
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
