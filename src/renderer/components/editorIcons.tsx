// 内置应用图标：VS Code / Trae / Zed 品牌路径 + terminal/folder/custom 走 lucide。
// 标题栏按钮与设置页共用，避免重复维护两份 SVG。
import { FolderOpen, AppWindow, SquareTerminal } from 'lucide-react'

// 内置应用的近似品牌色，仅用于图标点缀；主体跟随主题变量。
export const APP_COLORS: Record<string, string> = {
  vscode: '#007acc',
  trae: '#0a7cff',
  zed: '#1348dc',
  terminal: '#4a4a4a',
  folder: '#1fa0ec',
}

function VsCodeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden focusable="false">
      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  )
}

function TraeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden focusable="false">
      <path d="M24 20.541H3.428v-3.426H0V3.4h24V20.54zM3.428 17.115h17.144V6.827H3.428v10.288zm8.573-5.196l-2.425 2.424-2.424-2.424 2.424-2.424 2.425 2.424zm6.857-.001l-2.424 2.423-2.425-2.423 2.425-2.425 2.424 2.425z" />
    </svg>
  )
}

function ZedIcon({ size }: { size: number }) {
  // Zed logomark 简化几何：向右上方冲刺的折角箭头 / 闪电形。
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden focusable="false">
      <path d="M2 4.5h13L9.5 11H22l-8.5 8.5H2l5.5-6.5H2V4.5z" />
    </svg>
  )
}

// 统一应用图标：内置 id 渲染对应品牌 SVG；自定义渲染通用图标。
export function AppIcon({ id, size }: { id: string; size: number }) {
  switch (id) {
    case 'vscode': return <VsCodeIcon size={size} />
    case 'trae': return <TraeIcon size={size} />
    case 'zed': return <ZedIcon size={size} />
    case 'terminal': return <SquareTerminal size={size} strokeWidth={1.8} />
    case 'folder': return <FolderOpen size={size} strokeWidth={1.8} />
    default: return <AppWindow size={size} strokeWidth={1.8} />
  }
}
