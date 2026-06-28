# 移动端输入框对齐 — 子项目 B2:图片附件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移动端输入框加图片附件能力——"＋"按钮选图/拍照 → base64 → 缩略图 chip 横排 → 随消息发送 → 发送后清空。

**Architecture:** 三任务递进——纯函数 readImageAsAttachment(可独立单测) → App 持有 attachments 状态 + handleSend 透传 images 并清空 → ChatPage 渲染"＋"按钮/菜单/chip 栏接回调。images 协议层 A 阶段已通,无需改协议。

**Tech Stack:** React + TypeScript + FileReader API + @testing-library/react + vitest(web 子项目)

## Global Constraints

- images 类型:`{ mediaType: string; data: string; name?: string }[]`,**data 是纯 base64(去掉 `data:...;base64,` 前缀)**,与桌面 collectImages / 主进程 claude.send 契约一致
- mediaType 来自 file.type(如 `image/png`)
- 状态在 App.tsx(与 currentPermission/currentThinking 同层),ChatPage 只渲染+回调
- 发送后清空 attachments(handleSend 内 setAttachments([]))
- 只做核心闭环(选图/chip/发送/清空),不做多选/粘贴/大小限制
- 测试用 web 子项目 vitest:工作目录在 web/ 下(`cd web && npx vitest run ...`)
- FileReader 在 jsdom 需 mock(用 vi.stubGlobal 或测试里覆盖 onload)
- Conventional Commits 提交

参考 spec: `docs/superpowers/specs/2026-06-27-mobile-input-parity-b2-images-design.md`

---

## File Structure

- Create: `web/src/lib/read-image.ts` — 文件读成 base64 附件的纯函数(可独立单测)
- Create: `web/src/lib/read-image.test.ts` — 纯函数单测(mock FileReader)
- Modify: `web/src/App.tsx` — attachments 状态 + addImages/removeImage 回调 + handleSend 透传 images 并清空 + ChatPage props 下发
- Modify: `web/src/pages/ChatPage.tsx` — "＋"按钮 + 拍照/相册菜单 + chip 栏渲染 + 新 props 解构
- Modify: `web/src/styles.css` — "＋"按钮/菜单/chip 栏样式
- Modify: `web/src/pages/ChatPage.test.tsx` — chip 渲染/删除/菜单测试

无需改: `web/src/hooks/useSessionChat.ts`(A 阶段已支持 images opts)、协议层。

---

## Task 1: 纯函数 readImageAsAttachment(file → base64 附件)

**Files:**
- Create: `web/src/lib/read-image.ts`
- Create: `web/src/lib/read-image.test.ts`

**Interfaces:**
- Consumes: 无(纯函数,无前置依赖)
- Produces: `readImageAsAttachment(file: File): Promise<{ mediaType: string; data: string; name?: string }>` — data 为纯 base64(无 data URL 前缀)。后续 Task 2 的 addImages 调用它。

- [ ] **Step 1: 写失败测试 — readImageAsAttachment**

创建 `web/src/lib/read-image.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readImageAsAttachment } from './read-image'

// jsdom 不实现 FileReader 的真实读取,这里 mock:实例化后存引用,测试手动触发 onload
class MockFileReader {
  result: string | ArrayBuffer | null = null
  error: any = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsDataURL(_file: File) { /* 测试手动调 onload 前设置 this.result */ }
}
let mockReader: MockFileReader
beforeEach(() => {
  mockReader = new MockFileReader()
  vi.stubGlobal('FileReader', function () { return mockReader })
})

describe('readImageAsAttachment', () => {
  it('图片文件 → {mediaType, data(纯base64无前缀), name}', async () => {
    const file = new File(['blob'], 'x.png', { type: 'image/png' })
    const p = readImageAsAttachment(file)
    // 手动触发 onload,设置 data URL 结果
    mockReader.result = 'data:image/png;base64,iVBORw0KGgo='
    mockReader.onload!()
    const r = await p
    expect(r.mediaType).toBe('image/png')
    expect(r.data).toBe('iVBORw0KGgo=') // 去掉 data URL 前缀,纯 base64
    expect(r.name).toBe('x.png')
  })

  it('非图片文件 → reject', async () => {
    const file = new File(['text'], 'a.txt', { type: 'text/plain' })
    await expect(readImageAsAttachment(file)).rejects.toThrow(/非图片/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/lib/read-image.test.ts`
Expected: FAIL(`read-image.ts` 不存在,import 报错)

- [ ] **Step 3: 实现 — readImageAsAttachment**

创建 `web/src/lib/read-image.ts`:

```typescript
// web/src/lib/read-image.ts
// 把单个图片 File 读成 attachments 项(data 纯 base64,与桌面 collectImages / 主进程
// claude.send 的 images 契约一致)。纯函数,可独立单测(jsdom 需 mock FileReader)。

/** attachments 项 / sendMessage opts.images 的元素类型(与 useSessionChat 一致)。 */
export interface ImageAttachment {
  mediaType: string
  data: string       // 纯 base64(无 data URL 前缀)
  name?: string
}

/**
 * 把图片 File 读成 { mediaType, data: 纯base64, name }。
 * data 去掉 data URL 前缀(主进程 images 字段契约要求纯 base64,非 data URL)。
 * 非图片文件拒绝(reject)。
 */
export function readImageAsAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`非图片文件: ${file.type}`))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') { reject(new Error('FileReader 未返回字符串')); return }
      // data URL 形如 "data:image/png;base64,iVBOR..." → 取逗号后的纯 base64
      const commaIdx = result.indexOf(',')
      const data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result
      resolve({ mediaType: file.type, data, name: file.name })
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd web && npx vitest run src/lib/read-image.test.ts`
Expected: 2 测试 PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/read-image.ts web/src/lib/read-image.test.ts
git commit -m "feat: 移动端 readImageAsAttachment 纯函数(图片 File → 纯 base64 附件)

为图片附件能力做准备:File 读成 {mediaType, data(纯base64去前缀), name}。
与桌面 collectImages / 主进程 claude.send 的 images 契约一致。非图片文件 reject。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: App.tsx 持有 attachments 状态 + handleSend 透传 images 并清空

**Files:**
- Modify: `web/src/App.tsx`(state + addImages/removeImage 回调 + handleSend 改造 + ChatPage props 下发)

**Interfaces:**
- Consumes: Task 1 的 `readImageAsAttachment(file: File): Promise<ImageAttachment>`、A 阶段 sendMessage 的 `images` opts
- Produces: App 透传给 ChatPage 的 3 个新 props(在 Task 3 的 ChatPageProps 里声明):`attachments: ImageAttachment[]` / `onAddImages: (files: File[]) => void` / `onRemoveImage: (index: number) => void`

- [ ] **Step 1: 实现 — App.tsx 加 attachments 状态 + 回调**

修改 `web/src/App.tsx`。先在顶部 import 区加(找到现有 import,加一行):

```typescript
import { readImageAsAttachment, type ImageAttachment } from './lib/read-image'
```

在 state 声明区(找到 `const [currentThinking, setCurrentThinking]` 那行,约第 86 行)之后加:

```typescript
  // 图片附件(对齐桌面 store.draft.attachments)。App 持有状态,ChatPage 渲染 chip + 回调。
  // 发送时转成 images 透传(sendMessage opts,协议层 A 阶段已通),发完清空。
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
```

在 handleSend 定义之前(约第 230 行附近,handleSend 上方)加两个回调:

```typescript
  const addImages = useCallback(async (files: File[]) => {
    const items = await Promise.all(files.map(readImageAsAttachment))
    setAttachments((prev) => [...prev, ...items])
  }, [])

  const removeImage = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])
```

- [ ] **Step 2: 实现 — handleSend 透传 images 并清空**

修改 `web/src/App.tsx` 的 handleSend(约第 231-239 行):

```typescript
  const handleSend = useCallback(() => {
    if (view.kind !== 'chat') return
    const text = inputValue
    setInputValue('')
    const imagesToSend = attachments.length ? attachments : undefined
    void chat.sendMessage(view.localSessionId, text, {
      permission: currentPermission,
      thinking: currentThinking,
      images: imagesToSend,
    })
    if (attachments.length) setAttachments([])
  }, [view, inputValue, chat, currentPermission, currentThinking, attachments])
```

- [ ] **Step 3: 实现 — ChatPage props 下发**

修改 `web/src/App.tsx` 渲染 ChatPage 处(约第 268-293 行),在 `onThinkingChange={setCurrentThinking}` 之后加 3 个 props:

```typescript
          onThinkingChange={setCurrentThinking}
          attachments={attachments}
          onAddImages={addImages}
          onRemoveImage={removeImage}
          headerExtra={themeToggle}
```

- [ ] **Step 4: 类型检查(此时 ChatPageProps 还没声明新 props,会报错——预期)**

Run: `cd web && npx tsc --noEmit`
Expected: 报错(ChatPageProps 缺 attachments/onAddImages/onRemoveImage)——Task 3 会修复。**这是预期的,Task 2 不单独验证 tsc,合并到 Task 3 后验证。**

- [ ] **Step 5: 提交(注释说明 Task 3 接 ChatPageProps)**

```bash
git add web/src/App.tsx
git commit -m "feat: 移动端 App 持有 attachments 状态 + handleSend 透传 images 并清空

加 attachments state + addImages(读图readImageAsAttachment)/removeImage 回调。
handleSend 把 attachments 转 images 透传 sendMessage(A协议层已支持),发完清空。
ChatPageProps 接线在下一个 commit(Task 3)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: ChatPage 渲染"＋"按钮/拍照相册菜单/chip 栏 + 样式

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`(props 接口 + 解构 + footer UI)
- Modify: `web/src/styles.css`(按钮/菜单/chip 样式)
- Modify: `web/src/pages/ChatPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 App 下发的 props: `attachments: ImageAttachment[]` / `onAddImages: (files: File[]) => void` / `onRemoveImage: (index: number) => void`。ImageAttachment 类型从 Task 1 的 `web/src/lib/read-image.ts` import。
- Produces: 无(UI 终点)

- [ ] **Step 1: 写失败测试 — chip 渲染 + 删除 + 菜单**

在 `web/src/pages/ChatPage.test.tsx` 末尾追加新 describe 块:

```typescript
describe('ChatPage - 图片附件', () => {
  const baseProps = {
    title: 't', messages: [], running: false,
    inputValue: '', onInputChange: () => {}, onSend: () => {},
    onInterrupt: () => {}, onBack: () => {},
  }

  it('传入 attachments → 渲染对应数量的缩略图 chip + 删除按钮', () => {
    const attachments = [
      { mediaType: 'image/png', data: 'aaa', name: 'a.png' },
      { mediaType: 'image/jpeg', data: 'bbb', name: 'b.jpg' },
    ]
    render(
      <ChatPage
        {...baseProps}
        attachments={attachments}
        onAddImages={() => {}}
        onRemoveImage={() => {}}
      />,
    )
    // 两张缩略图(data URL 形式)
    const imgs = screen.getAllByRole('img') as HTMLImageElement[]
    expect(imgs.length).toBe(2)
    expect(imgs[0].src).toContain('data:image/png;base64,aaa')
    // 两个删除按钮
    expect(screen.getAllByLabelText(/删除|移除/).length).toBe(2)
  })

  it('点 chip 的删除按钮 → onRemoveImage(index)', () => {
    const onRemoveImage = vi.fn()
    render(
      <ChatPage
        {...baseProps}
        attachments={[{ mediaType: 'image/png', data: 'aaa' }]}
        onAddImages={() => {}}
        onRemoveImage={onRemoveImage}
      />,
    )
    fireEvent.click(screen.getAllByLabelText(/删除|移除/)[0])
    expect(onRemoveImage).toHaveBeenCalledWith(0)
  })

  it('点「＋」→ 弹出拍照/相册菜单', () => {
    render(
      <ChatPage
        {...baseProps}
        attachments={[]}
        onAddImages={() => {}}
        onRemoveImage={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText(/添加|附件|图片/))
    expect(screen.getByText(/拍照/)).toBeInTheDocument()
    expect(screen.getByText(/相册/)).toBeInTheDocument()
  })

  it('未传 onAddImages 时不渲染「＋」按钮(向后兼容)', () => {
    render(<ChatPage {...baseProps} />)
    expect(screen.queryByLabelText(/添加|附件|图片/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 4 个新测试 FAIL(新 props 未声明/未渲染)

- [ ] **Step 3: 实现 — ChatPageProps 加 3 个可选 props + ImageAttachment import**

修改 `web/src/pages/ChatPage.tsx`。顶部 import 区加(找到现有 import):

```typescript
import type { ImageAttachment } from '../lib/read-image'
```

修改 ChatPageProps 接口(找到 `onThinkingChange?: ...` 那行,约第 60 行)之后加:

```typescript
  /** 已选图片附件(App 状态)。渲染缩略图 chip。 */
  attachments?: ImageAttachment[]
  /** 选图回调(App 的 addImages)。 */
  onAddImages?: (files: File[]) => void
  /** 删除指定 index 的附件(App 的 removeImage)。 */
  onRemoveImage?: (index: number) => void
```

- [ ] **Step 4: 实现 — 解构新 props + 菜单状态**

修改 ChatPage 组件解构(找到 `onThinkingChange,` 那行,约第 134 行)之后加:

```typescript
    onThinkingChange,
    attachments,
    onAddImages,
    onRemoveImage,
  } = props
```

在组件内 `const canSend = ...` 附近(约第 128 行后)加菜单状态和两个 input ref:

```typescript
  // 图片附件菜单(拍照/相册)开合态 + 两个隐藏 file input ref
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)  // capture=environment,调相机
  const albumInputRef = useRef<HTMLInputElement | null>(null)   // 普通相册选择
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) onAddImages?.(files)
    e.target.value = ''  // 重置,允许重复选同一文件
    setShowAttachMenu(false)
  }
```

- [ ] **Step 5: 实现 — footer 渲染 chip 栏 + "＋"按钮 + 菜单 + 隐藏 input**

修改 `web/src/pages/ChatPage.tsx` 的 footer。在 B1 控件栏 `<div className="chat-input-controls">...</div>` 之后(约第 333 行 `)}` 之后)、`<div className="chat-input-wrap">` 之前,加 chip 栏:

```tsx
        {attachments && attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((att, i) => (
              <div className="attach-chip" key={i}>
                <img src={`data:${att.mediaType};base64,${att.data}`} alt={att.name || '附件'} />
                {onRemoveImage && (
                  <button
                    className="attach-chip-remove"
                    onClick={() => onRemoveImage(i)}
                    aria-label="删除附件"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}
```

修改 `<div className="chat-input-wrap">` 内部,在 `<textarea>` 之前加"＋"按钮 + 菜单 + 隐藏 input(找到 `<textarea` 那行,约第 335 行,在它之前插入):

```tsx
        <div className="chat-input-wrap">
          {onAddImages && (
            <>
              <button
                className="attach-add-btn"
                onClick={() => setShowAttachMenu((v) => !v)}
                aria-label="添加图片"
              >＋</button>
              {showAttachMenu && (
                <div className="attach-menu">
                  <button onClick={() => cameraInputRef.current?.click()}>拍照</button>
                  <button onClick={() => albumInputRef.current?.click()}>从相册选</button>
                </div>
              )}
              {/* 拍照:capture=environment 调起相机;相册:普通选择 */}
              <input
                ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                style={{ display: 'none' }} onChange={handleFilePick}
              />
              <input
                ref={albumInputRef} type="file" accept="image/*"
                style={{ display: 'none' }} onChange={handleFilePick}
              />
            </>
          )}
          <textarea
```

- [ ] **Step 6: 实现 — styles.css 加样式**

在 `web/src/styles.css` 末尾追加(参考现有 `.send-icon-btn` / `.model-select` 风格):

```css
/* 图片附件 */
.attach-add-btn {
  background: transparent; border: 0; color: var(--text-muted);
  font-size: 22px; line-height: 1; padding: 0 8px; cursor: pointer;
  flex-shrink: 0; align-self: flex-end; margin-bottom: 4px;
}
.attach-menu {
  position: absolute; bottom: 100%; left: 0; margin-bottom: 6px;
  display: flex; flex-direction: column; gap: 2px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--r-sm); padding: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.15);
  z-index: 10;
}
.attach-menu button {
  background: transparent; border: 0; padding: 8px 14px; text-align: left;
  cursor: pointer; color: var(--text); border-radius: var(--r-sm); font-size: 14px;
}
.attach-menu button:hover { background: var(--bg-sunken); }
.attach-chips {
  display: flex; gap: 6px; overflow-x: auto; padding: 0 0 6px 0;
}
.attach-chip {
  position: relative; flex-shrink: 0; width: 48px; height: 48px;
  border-radius: var(--r-sm); overflow: hidden; border: 1px solid var(--border);
}
.attach-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
.attach-chip-remove {
  position: absolute; top: -4px; right: -4px; width: 18px; height: 18px;
  border-radius: 50%; background: var(--text); color: var(--bg);
  border: 0; font-size: 12px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd web && npx vitest run src/pages/ChatPage.test.tsx`
Expected: 所有测试 PASS(含 4 个新测试 + 原有测试)

- [ ] **Step 8: 类型检查 + 全套回归**

Run: `cd web && npx tsc --noEmit`
Expected: exit 0

Run: `cd web && npx vitest run`
Expected: 全 PASS(含 Task 1 的 read-image 测试 + ChatPage 新测试,未破坏其他)

- [ ] **Step 9: 提交**

```bash
git add web/src/pages/ChatPage.tsx web/src/styles.css web/src/pages/ChatPage.test.tsx
git commit -m "feat: 移动端输入框图片附件 UI(＋按钮/拍照相册菜单/缩略图chip栏)

ChatPage 渲染「＋」按钮→弹拍照/相册菜单(隐藏 file input,capture=environment 调相机)→
选中图后 App 读成 base64 attachments→输入框上方缩略图 chip 横排(×删除)→发送时透传。
接 Task 2 的 App props。协议层 A 阶段已通 images 透传。条件渲染向后兼容。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ "＋"按钮弹菜单分拍照/相册 — Task 3 Step 5(两个隐藏 input, capture=environment)
- ✅ 缩略图 chip 横排 + × — Task 3 Step 5(chip 栏 + attach-chip-remove)
- ✅ App 持有 attachments 状态,发送后清空 — Task 2 Step 1-2(state + handleSend setAttachments([]))
- ✅ 读图拆纯函数单测 — Task 1(readImageAsAttachment + 2 测试)
- ✅ data 纯 base64(去前缀) — Task 1 Step 3(commaIdx 剥离)+ Task 1 测试断言
- ✅ 只做核心闭环 — 无多选/粘贴/限制代码
- ✅ 非图片拒绝 — Task 1 Step 3(startsWith 检查)+ 测试

**2. Placeholder scan:** 无 TODO/TBD,每个 step 有完整代码或精确命令。

**3. Type consistency:**
- `ImageAttachment = { mediaType: string; data: string; name?: string }` — Task 1 定义,Task 2 import,Task 3 import,三处一致
- `readImageAsAttachment(file: File): Promise<ImageAttachment>` — Task 1 定义,Task 2 addImages 调用,签名一致
- App 透传 `attachments={attachments}` / `onAddImages={addImages}` / `onRemoveImage={removeImage}` — Task 2 下发,Task 3 ChatPageProps 声明,字段名一致
- `addImages(files: File[])` / `removeImage(index: number)` — Task 2 定义,Task 3 ChatPageProps `(files: File[]) => void` / `(index: number) => void`,签名一致
- chip img src `data:${mediaType};base64,${data}` — Task 3 渲染,与 Task 1 测试断言(data:image/png;base64,aaa)一致

**注意点(实现时留意):**
- Task 2 Step 4 tsc 会报错(ChatPageProps 还没接新 props),这是预期,Task 3 接好后 Step 8 验证
- Task 3 Step 5 的 footer 插入有两处:chip 栏在控件栏后/chat-input-wrap 前;"＋"按钮在 chat-input-wrap 内 textarea 前。按注释定位
- Task 1 测试用 `vi.stubGlobal('FileReader', ...)` mock,注意每个 beforeEach 重建 mockReader 避免测试间污染
