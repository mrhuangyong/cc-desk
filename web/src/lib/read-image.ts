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
