// 审查 tab：展示当前已修改文件的 diff（依赖 git）。
// 原型阶段用 mock diff 内容演示，不接真实 git。
const MOCK_DIFF = `diff --git a/src/renderer/components/TitleBar.tsx b/src/renderer/components/TitleBar.tsx
index 1a2b3c4..5d6e7f8 100644
--- a/src/renderer/components/TitleBar.tsx
+++ b/src/renderer/components/TitleBar.tsx
@@ -10,7 +10,9 @@ export function TitleBar({ projectName }: { projectName: string }) {
-  const { state } = useStore()
+  const { state, dispatch } = useStore()
   return (
-    <button title="设置">⚙</button>
+    <button title="设置" onClick={() => dispatch({ type: 'SET_SETTINGS_SECTION', section: 'general' })}>⚙</button>
   )
diff --git a/src/renderer/state/reducer.ts b/src/renderer/state/reducer.ts
index 9e8f7a6..b2c3d4e 100644
--- a/src/renderer/state/reducer.ts
+++ b/src/renderer/state/reducer.ts
@@ -14,6 +14,8 @@ export interface AppState {
   theme: ThemeId
+  currentView: AppView
+  activeSettingsSection: SettingsSection
 }`

function DiffLine({ line }: { line: string }) {
  // + 行绿色、- 行红色、@@ 行蓝、其余默认
  let color = 'var(--text-muted)'
  if (line.startsWith('+++') || line.startsWith('---')) color = 'var(--text)'
  else if (line.startsWith('+')) color = '#3fb950'
  else if (line.startsWith('-')) color = '#f85149'
  else if (line.startsWith('@@')) color = '#58a6ff'
  const bg = line.startsWith('+') ? 'rgba(63,185,80,0.08)'
    : line.startsWith('-') ? 'rgba(248,81,73,0.08)'
    : 'transparent'
  return (
    <div style={{ color, background: bg, padding: '0 12px', whiteSpace: 'pre', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.7 }}>
      {line || ' '}
    </div>
  )
}

export function ReviewTab() {
  const lines = MOCK_DIFF.split('\n')
  const changedFiles = MOCK_DIFF.split('\n').filter(l => l.startsWith('diff --git')).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12 }}>
        已修改 {changedFiles} 个文件 · 基于 git diff
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {lines.map((l, i) => <DiffLine key={i} line={l} />)}
      </div>
    </div>
  )
}
