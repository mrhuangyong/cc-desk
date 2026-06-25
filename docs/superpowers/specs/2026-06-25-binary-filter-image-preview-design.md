# 文件树二进制过滤 + 图片预览 设计

- 日期：2026-06-25
- 状态：待实现
- 关联组件：`src/renderer/components/FileExplorerPanel.tsx`、`src/renderer/components/FileEditorPane.tsx`、`src/renderer/components/fileKind.ts`（新增）

## 1. 背景与问题

「文件 tab 改造」交付后，文件树点击任意文件都会触发 `onOpenFile`，右栏用 Monaco 加载。问题：
- **二进制文件**（dmg/zip/exe/pdf/字体/音视频等）被塞进 Monaco → 显示乱码、无意义，且 `readFileContent` 的 >200KB 限制会让很多二进制直接报错。
- **图片**（png/jpg 等）当前也被当文本 → 同样乱码。用户希望图片能直接预览。

## 2. 目标与非目标

### 目标
1. 新增纯函数 `fileKindOf(filePath): 'binary' | 'image' | 'text'`，按扩展名分类。
2. **二进制拦截**：文件树点击二进制文件 → 不触发 `onOpenFile`（不打开）；文件名灰显提示。
3. **图片预览**：点击图片文件 → 右栏用 `<img>` 居中预览（不走 Monaco）。
4. **文本默认可打开**：不在黑名单的文件（含无扩展名文件、各种源码后缀）默认走 Monaco。
5. **binary 兜底**：若 binary 类型被外部投喂到 FileEditorPane → 显示「不支持预览」，不塞进 Monaco。

### 非目标（YAGNI）
- 不做图片点击放大/缩放交互（仅居中 contain 显示，大图滚动）。
- 不做二进制文件的 hex 预览。
- 不给二进制文件加特殊图标或 tooltip（灰显足够）。
- 不改主进程 IPC、不改 `readFileContent`。
- 不做文件内容嗅探（magic bytes），仅按扩展名判定。
- 不改左栏老 `FileTree.tsx`（其 `OPEN_FILE_TAB` 流程保持原样，不在本次加过滤——本次只管右栏文件 tab 内的 `FileExplorerPanel`）。

## 3. 判定逻辑（纯函数）

新增 `src/renderer/components/fileKind.ts`，无 React 依赖、可独立单测：

```ts
export type FileKind = 'binary' | 'image' | 'text'

const BINARY_EXTS = new Set([
  // 压缩 / 打包
  '.dmg','.zip','.rar','.7z','.tar','.gz','.bz2','.xz','.tgz',
  // 可执行 / 库
  '.exe','.msi','.dll','.so','.dylib','.class','.jar','.bin',
  // Office 文档（二进制格式）
  '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
  // 字体
  '.woff','.woff2','.ttf','.otf','.eot',
  // 音视频
  '.mp3','.mp4','.mov','.avi','.mkv','.flac','.wav','.aac','.ogg','.webm',
  // 数据库 / 其它
  '.sqlite','.db','.lock','.pyc','.o',
])

const IMAGE_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.svg','.webp','.bmp','.ico'])

export function fileKindOf(filePath: string): FileKind {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'text'                       // 无扩展名 → 文本
  const ext = filePath.slice(dot).toLowerCase()    // 大小写不敏感
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (BINARY_EXTS.has(ext)) return 'binary'
  return 'text'
}
```

**判定策略：黑名单（二进制）+ 图片白名单 + 默认文本**。理由：二进制无法穷举，但「默认可打开」符合直觉（各种源码、配置、无扩展名文件都能打开）；漏网的二进制最多在 Monaco 里显示乱码，不会崩溃，可接受。图片单独白名单以触发预览分支。

## 4. 图片 src 方案：file:// 协议

`webPreferences` 为 `nodeIntegration:false` + `contextIsolation:true`（`src/main/index.ts:250-256`），渲染端不能直接 `readFileSync`；`readFileContent` 是 utf-8 文本读 + >200KB 抛错（`file-service.ts`），不能用于图片。

**方案：`<img src="file://<绝对路径>">`。** 依据：
- index.html 无 CSP meta，Electron 默认不强制 CSP，渲染端允许 `file://` 加载本地资源。
- FileNode.path 本就是绝对路径。
- 无需新 IPC、无需 base64 转码，大图秒开、省内存。

新增轻量工具（同 fileKind.ts 或 FileEditorPane 内）：

```ts
// 绝对路径 → file:// URL（跨平台，处理反斜杠/盘符）
function toFileUrl(absPath: string): string {
  // Windows: C:\a\b → file:///C:/a/b ；posix: /a/b → file:///a/b
  const normalized = absPath.replace(/\\/g, '/')
  return /^([a-zA-Z]:)/.test(normalized)
    ? `file:///${normalized}`
    : `file://${normalized}`
}
```

## 5. 消费点改动

### 5.1 FileExplorerPanel（点击拦截 + 灰显）

```tsx
import { fileKindOf } from './fileKind'

// 节点点击
onClick={() => {
  if (fileKindOf(node.path) === 'binary') return   // 二进制：拦截
  onOpenFile(node.path)
}}

// 文件名颜色（文件行）
const isBinary = fileKindOf(node.path) === 'binary'
<span style={{ fontSize: 13, color: isBinary ? 'var(--text-faint)' : 'var(--text)' }}>{node.name}</span>
```

### 5.2 FileEditorPane（图片预览分支 + binary 兜底）

在现有 markdown 切换 / Monaco 逻辑**之前**插入图片分支：

```tsx
import { fileKindOf, toFileUrl } from './fileKind'

const [imgError, setImgError] = useState(false)
const kind = filePath ? fileKindOf(filePath) : 'text'

// filePath 变化时重置图片错误态
useEffect(() => { setImgError(false) }, [filePath])

if (kind === 'image') {
  if (imgError) {
    return <div style={{ padding:12, color:'var(--text-muted)' }}>图片加载失败</div>
  }
  return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center',
                  overflow:'auto', padding:16, minHeight:0, background:'var(--bg)' }}>
      <img src={toFileUrl(filePath!)} alt={filePath}
           onError={() => setImgError(true)}
           style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
    </div>
  )
}

if (kind === 'binary') {
  return <div style={{ padding:12, color:'var(--text-muted)' }}>该文件类型不支持预览</div>
}

// ... 原有 markdown 预览切换 / Monaco 逻辑不变
```

## 6. 错误处理与边界

| 场景 | 处理 |
|------|------|
| 二进制点击 | 不触发 onOpenFile，文件名灰显 |
| 图片加载失败（不存在/损坏/CSP 拦截） | `<img onError>` → 「图片加载失败」提示 |
| binary 被外部投喂到 FileEditorPane | 「不支持预览」，不塞 Monaco |
| 无扩展名文件 | 当文本，走 Monaco |
| 大小写不同（.JPG/.Zip） | 扩展名 toLowerCase 后匹配 |
| Windows 路径 | toFileUrl 处理反斜杠/盘符 |

## 7. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/renderer/components/fileKind.ts` | 新增 | `fileKindOf` + `toFileUrl` 纯函数 |
| `src/renderer/components/FileExplorerPanel.tsx` | 改 | 点击拦截 + 二进制文件名灰显 |
| `src/renderer/components/FileEditorPane.tsx` | 改 | 图片预览分支 + binary 兜底 |
| `tests/fileKind.test.ts` | 新增 | `fileKindOf` / `toFileUrl` 单测 |
| `tests/FileExplorerPanel.test.tsx` | 改 | 补「点二进制不触发 onOpenFile」用例 |
| `tests/FileEditorPane.test.tsx` | 改 | 补「图片类型渲染 img」「binary 显示不支持」用例 |

## 8. 测试计划

- **`fileKind.test.ts`（纯函数，node 环境，无需 mock）**：
  - 图片：`.png/.JPG/.svg/.webp` → `image`
  - 二进制：`.zip/.dmg/.pdf/.woff/.exe` → `binary`
  - 文本：`.ts/.md/.json/无扩展名/.rs` → `text`
  - `toFileUrl('/a/b.png')` → `file:///a/b.png`；`toFileUrl('C:\\a\\b.png')` → `file:///C:/a/b.png`
- **`FileExplorerPanel.test.tsx`（jsdom）**：mock readTree 返回含 `.zip` 与 `.png` 节点，验证点 `.zip` 不触发 onOpenFile、点 `.png` 触发。
- **`FileEditorPane.test.tsx`（jsdom）**：filePath 为 `.png` → 渲染 `<img>`（断言 img 存在、src 含 file://）；filePath 为 `.zip` → 文案「不支持预览」。

## 9. 风险与注意事项

- **CSP 兜底**：若某些环境下 `file://` 被拦（理论上当前无 CSP），`<img onError>` 会兜底显示「图片加载失败」，不会崩溃。如未来加 CSP 需在 `img-src` 放行 `file:`。
- **`svg` 的特殊性**：svg 是文本也是图片，本设计按图片处理（预览渲染）。若用户想编辑 svg 源码，可后续加「svg 预览/编辑切换」，本次不做。
- **不改左栏 FileTree**：本次范围限定右栏文件 tab 的 FileExplorerPanel。左栏老 FileTree 的过滤可作为后续独立小改动。
