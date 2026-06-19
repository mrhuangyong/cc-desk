# cc-desk 应用图标

为 cc-desk（Claude Code 桌面客户端）设计的应用图标。

## 定稿方案：Prism C（棱镜 C）

```
cc-desk-icon.svg        主图标（浅色调 · macOS squircle 1024）
cc-desk-icon-dark.svg   深色壁纸变体（夜曲墨蓝底 + 亮 C）
cc-desk-icon-mask.svg   单色蒙版（status bar / template image）
```

## 设计概念

> **切角厚描边的「C」棱镜，开口处折射出终端尖括号 `< >`。**

一个符号叠了三层语义：

| 元素 | 语义 |
|------|------|
| **C 棱镜主体** | Claude / Code 的首字母；切角厚描边带来「棱镜/晶体」的工程质感 |
| **开口朝右** | C 的天然开口，也像对话/输入的「入口」 |
| **琥珀色 `< >`** | 折射出的终端尖括号——编程的本质符号；暖色是整个浅色图标的记忆锚点 |

### 为什么是 C + 尖括号（避开的坑）

- 不用紫色渐变 / 发光大脑 / 神经元（通用 AI 图标陈词滥调）
- 不用对话气泡 + 代码括号堆砌的俗套组合
- 不用抽象开口环（太隐晦，首字母辨识弱）
- **C 直接 = Claude/Code，尖括号直接 = 编程**——语义零歧义，且 `< >` 嵌在 C 开口里形成「字母含符号」的精巧结构

## 浅色调选择

主图标用**浅色暖纸背景**（`#fdfaf3 → #e4dccd`），呼应应用的 `codex-light`/`codex-warm` 主题：

- 浅底让深墨蓝 C 棱镜（`#33425a → #0c1424`）对比鲜明、轮廓清晰
- 暖纸色调比纯白更耐看，避免「冷冰冰的文档」感
- 琥珀括号（`#ffcf8a → #a85c1c`）作为唯一暖色锚点，在浅底上跳脱
- 在深色壁纸下可用 `cc-desk-icon-dark.svg`（夜曲墨蓝底 + 亮 C）

## 配色

| 角色 | 色值 |
|------|------|
| 背景（浅·主） | `#fdfaf3 → #e4dccd` 径向渐变 |
| C 棱镜 | `#33425a → #0c1424` 线性渐变 |
| C 内侧暗面 | `#101a2c → #060b16` |
| 琥珀括号 | `#ffcf8a → #a85c1c` 线性渐变 |
| 背景（深变体） | `#2b3850 → #070b12` |

## 几何

- C 主体：外半径 300、内半径 196（描边厚度 ~104），开口朝右、半张角 40°
- 端点坐标用三角函数精确计算（见 SVG 注释），确保左右对称
- `< >` 括号：宽 30px 圆角描边，顶点分别在 (508,512) 和 (716,512)，垂直对称
- 1024×1024 viewBox，squircle 遵循 macOS Big Sur+ app icon 规范

## 验证

经 canvas 像素采样验证：
- 浅色背景、深墨蓝 C 体、琥珀括号均正确渲染
- C 体左右对称（两端颜色一致）
- 32px dock 最小尺寸下琥珀括号 `rgb(226,170,100)` 仍清晰可辨

## 转 PNG / ICNS（构建用）

```bash
# 需 rsvg-convert + iconutils（macOS 自带）
mkdir icon.iconset
for s in 16 32 64 128 256 512 1024; do
  rsvg-convert -w $s -h $s cc-desk-icon.svg -o icon.iconset/icon_${s}x${s}.png
done
# 补 @2x 命名（16→16@2x=32 等）后：
iconutil -c icns icon.iconset -o icon.icns
```

在 `package.json` 的 electron-builder 配置中引用 `icon.icns`（macOS）/ `icon.ico`（Windows）。

## 文件

| 文件 | 说明 |
|------|------|
| `cc-desk-icon.svg` | **主图标**（浅色调） |
| `cc-desk-icon-dark.svg` | 深色壁纸变体 |
| `cc-desk-icon-mask.svg` | 单色蒙版（状态栏） |
| `study.html` | 设计方向对比稿 |
| `preview.html` | 定稿多尺寸 + 场景预览 |
