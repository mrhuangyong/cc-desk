import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// 消息流中的图片块。
// 渲染为缩略图（固定高度，圆角，cursor:zoom-in），点击弹出全屏 lightbox 预览大图，
// 点击背景或 ESC 关闭。lightbox 用 createPortal 渲染到 body，逃离气泡的 overflow/拖拽区。
//
// 同时承载用户发送的图片（用户气泡内）与 assistant 返回的图片——两者都用缩略图 + 预览，
// 避免大图撑爆气泡/对话流。
export function ImageBlock({ source }: { source: string }) {
  const [open, setOpen] = useState(false)
  if (!source) return null
  const src = source.startsWith('data:') || source.startsWith('http') ? source : `data:image/png;base64,${source}`

  return (
    <>
      {/* 缩略图：固定高度，等比缩放，点击放大 */}
      <img
        src={src}
        alt=""
        onClick={() => setOpen(true)}
        style={{
          height: 160,
          maxWidth: '100%',
          width: 'auto',
          objectFit: 'contain',
          borderRadius: 8,
          cursor: 'zoom-in',
          display: 'block',
        }}
      />
      {open && <ImageLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  )
}

// 全屏图片预览：黑色背景 + 居中大图 + 右上关闭钮。点击背景或 ESC 关闭。
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32,
      }}
    >
      {/* 关闭钮 */}
      <button
        onClick={onClose}
        aria-label="关闭"
        style={{
          position: 'absolute', top: 16, right: 16,
          width: 36, height: 36, borderRadius: '50%',
          border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <X size={18} />
      </button>
      {/* 大图：受限在视口内，点击图片不关（stopPropagation） */}
      <img
        src={src}
        alt=""
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain',
          borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      />
    </div>,
    document.body,
  )
}
