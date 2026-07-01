import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useStore } from '../state/store'
import { useResizableWidth } from '../hooks/useResizableWidth'
import { FileExplorerPanel } from './FileExplorerPanel'
import { FileEditorPane } from './FileEditorPane'
import type { FileEditorPaneHandle } from './FileEditorPane'

export interface FileTabHandle {
  save: () => Promise<boolean>
}

interface Props {
  tabId: string
  filePath?: string
}

export const FileTab = forwardRef<FileTabHandle, Props>(function FileTab({ tabId, filePath }, ref) {
  const { state } = useStore()
  const [currentFilePath, setCurrentFilePath] = useState<string | undefined>(filePath)
  useEffect(() => { setCurrentFilePath(filePath) }, [filePath])

  const activeProject = state.projects.find(p => p.sessions.some(s => s.id === state.activeSessionId))
  const cwd = activeProject?.path || state.settings?.cwd

  const editorRef = useRef<FileEditorPaneHandle>(null)

  // save() 转发给内部 FileEditorPane，保持 TabBar 关闭确认流程可用
  useImperativeHandle(ref, () => ({
    save: async () => editorRef.current?.save() ?? false,
  }), [])

  const openFile = (path: string) => {
    if (state.dirtyTabIds?.[tabId]) {
      const ok = window.confirm('当前文件有未保存改动，是否丢弃并切换？')
      if (!ok) return
    }
    setCurrentFilePath(path)
  }

  const { width: treeWidth, dragging: treeDragging, onPointerDown: onTreeResize, registerApply } = useResizableWidth({
    initial: 220,
    min: 160,
    max: 500,
    side: 'right',
    storageKey: 'cc-desk-file-tree-width',
  })

  const treeRef = useRef<HTMLDivElement>(null)
  const treeRefCallback = useCallback((node: HTMLDivElement | null) => {
    (treeRef as React.MutableRefObject<HTMLDivElement | null>).current = node
    if (node) registerApply((w: number) => { node.style.width = `${w}px` })
  }, [registerApply])

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0, minWidth: 0 }}>
      <div
        ref={treeRefCallback}
        style={{
          width: treeWidth, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-sidebar)',
          display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
        }}
      >
        <FileExplorerPanel cwd={cwd} currentFilePath={currentFilePath} onOpenFile={openFile} />
      </div>
      {/* 拖拽手柄：文件树右边缘 */}
      <div
        onPointerDown={onTreeResize}
        style={{
          width: 5, flexShrink: 0, cursor: 'col-resize', zIndex: 10,
          background: treeDragging ? 'var(--accent)' : 'transparent',
          transition: treeDragging ? 'none' : 'background .15s',
        }}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FileEditorPane ref={editorRef} filePath={currentFilePath} tabId={tabId} />
      </div>
    </div>
  )
})
