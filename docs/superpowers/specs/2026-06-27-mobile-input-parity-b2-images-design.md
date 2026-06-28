# 移动端输入框对齐 — 子项目 B2:图片附件

**日期**:2026-06-27
**状态**:设计阶段
**关联**:移动端输入框全面对齐。A(协议层)/B1(权限思考控件)已完成。本文档是 B2。

## Context(背景与目标)

子项目 A 已打通 images 协议层:`sendMessage` 接受 `images?: { mediaType: string; data: string; name?: string }[]`(data 纯 base64),session.message → dispatcher → claude.send 全链路透传,主进程 pushMessage 支持 images。桌面端 collectImages(InputBar.tsx:45-49)是参考实现。移动端目前无任何附件代码。

**B2 目标**:移动端输入框左侧加"＋"按钮 → 弹菜单"拍照/从相册选" → 读成 base64 → 输入框上方缩略图 chip 横排(带 ×删除) → 发送时随 images 透传 → 发送后清空。让移动端能给 Claude 发图片。

**不在 B2 范围**:多选(YAGNI,先单张跑通核心闭环)、粘贴图片(移动端 PWA 场景少)、大小/数量限制(后续按需)、草稿持久化(B3)、编辑重发(B4)、排队(B5)。

## 设计决策(已与用户确认)

1. **图片来源**:"＋"按钮弹菜单分"拍照/从相册选"两项。用两个隐藏 `<input type="file" accept="image/*">`,一个带 `capture="environment"`(调起相机),一个普通(相册)。
2. **chip 展示**:输入框上方缩略图 + × 横排(与桌面 AttachmentChip 一致),多张时横向滚动。
3. **状态管理**:App.tsx 持有 `attachments` 状态(与 currentPermission/currentThinking 同层),发送时转 images 传 sendMessage 并清空。
4. **范围**:只做核心闭环(选图/chip/发送/清空)。不做多选、粘贴、大小限制。
5. **读图逻辑**:拆成纯函数(file → base64 的 Promise),独立单测,ChatPage 只调用。

## 改动方案

### 层 1:纯函数 — 文件读成 base64(可独立单测)

新建 `web/src/lib/read-image.ts`:

```ts
/**
 * 把单个图片 File 读成 { mediaType, data: 纯base64, name }。
 * data 去掉 data URL 前缀(与桌面 collectImages 一致,主进程 images 字段契约要求纯 base64)。
 * 非图片文件拒绝(返回 rejected promise)。
 */
export function readImageAsAttachment(file: File): Promise<{ mediaType: string; data: string; name?: string }> {
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

### 层 2:App.tsx — attachments 状态 + 发送清空

- 加 `const [attachments, setAttachments] = useState<{ mediaType: string; data: string; name?: string }[]>([])`
- 加回调:
  - `addImages(files: File[])`:对每个 file 调 readImageAsAttachment,Promise.all 后 append 到 attachments
  - `removeImage(index: number)`:按 index 过滤删除
- handleSend 改造:发送时 `chat.sendMessage(lsId, text, { permission, thinking, images: attachments.length ? attachments : undefined })`,发送后 `setAttachments([])` 清空
- 透传 attachments/addImages/removeImage 给 ChatPage

### 层 3:ChatPage.tsx — "＋"按钮 + chip 栏

- ChatPageProps 加:`attachments?: { mediaType: string; data: string; name?: string }[]` / `onAddImages?: (files: File[]) => void` / `onRemoveImage?: (index: number) => void`
- footer 输入框左侧加"＋"按钮,点击触发菜单(用隐藏 input)
- 两个隐藏 `<input type="file" accept="image/*">` ref,一个 `capture="environment"`,点"＋"弹菜单选哪个 input.click()
  - 菜单实现:简单的两个按钮浮层,或用 `window.confirm`/原生 action sheet。**初版用两个小按钮浮层**(可控、可测)
- 控件栏下方(B1 的 select 控件栏下、textarea 上)加附件 chip 横排:每张图 `<img src={data:image/mediaType;base64,data}>` 缩略图 + × 按钮(onRemoveImage(index))

### 层 4:styles.css

- `.attach-add-btn`("＋"按钮,与 send-icon-btn 风格协调)
- `.attach-menu`(拍照/相册两按钮浮层)
- `.attach-chips`(横排容器,overflow-x auto)
- `.attach-chip`(缩略图 + ×)

## 关键点

- **images data 是纯 base64**(去 data URL 前缀),与桌面 collectImages / 主进程 claude.send 契约一致——readImageAsAttachment 负责剥离前缀
- **状态在 App**,ChatPage 只渲染 + 回调,符合现有架构(useSessionChat/useDialogQueue 都是 App 聚合 props 下发)
- **发送后清空 attachments**(handleSend 里 setAttachments([]))
- **菜单用两按钮浮层**(不用 window.confirm,可测、体验好)
- **mediaType 来自 file.type**(image/png 等),SDK image content block 需要

## 测试策略

1. **read-image.ts 纯函数单测**(`web/src/lib/read-image.test.ts`):
   - 正常图片 file → 返回 {mediaType, data(纯base64无前缀), name}
   - 非图片 file(text/plain)→ reject
   - 需 mock FileReader(jsdom 不实现 readAsDataURL 的真实读取,mock onload 回调)
2. **ChatPage.test.tsx**:
   - 传入 attachments → 渲染对应数量 chip 缩略图
   - 点 × → onRemoveImage(index)
   - 点"＋" → 弹菜单(拍照/相册两按钮可见)
3. 现有测试不破坏(新 props 可选)

## 验证

- `cd web && npx vitest run`(全套含新增)
- `cd web && npx tsc --noEmit`
- 手动 smoke(用户做):pnpm web:dev,移动端选图/拍照,chip 显示,发送后观察桌面端 SDK 收到图片(可能需真机 e2e 验证 SDK image 处理)
