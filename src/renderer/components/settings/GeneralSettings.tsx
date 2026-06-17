import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { SettingsLayout } from './SettingsLayout'
import { SettingsCard } from './SettingsCard'
import { SettingsRow } from './SettingsRow'
import { Toggle } from './Toggle'

// 分段按钮（缩放：缩小/正常/偏大）
function Segmented({ value, options, onChange }: { value: string; options: { id: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <span style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '4px 12px', fontSize: 12, cursor: 'pointer', border: 'none',
            background: value === o.id ? 'var(--accent)' : 'transparent',
            color: value === o.id ? 'var(--accent-text)' : 'var(--text-muted)'
          }}
        >{o.label}</button>
      ))}
    </span>
  )
}

const selectStyle: React.CSSProperties = { padding: '5px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }
const inputStyle: React.CSSProperties = { padding: '6px 10px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 280 }

export function GeneralSettings() {
  const { state, dispatch } = useStore()
  const s = state.settings

  // Claude 配置（proxy，来自 ~/.claude/settings.json）
  const [ccProxy, setCcProxy] = useState('')

  useEffect(() => {
    window.api?.cc?.general.get().then(c => { setCcProxy(c.proxy) })
  }, [])

  // 桌面应用偏好持久化（electron-store，真实生效）
  const persist = (patch: Partial<typeof s>) => {
    dispatch({ type: 'SET_SETTINGS', settings: patch })
    window.api?.settings.save(patch)
  }

  // Claude 配置持久化（~/.claude/settings.json）
  const saveCc = (patch: { proxy?: string }) => {
    window.api?.cc?.general.save(patch)
    if (patch.proxy !== undefined) setCcProxy(patch.proxy)
  }

  const applyTheme = (t: string) => {
    dispatch({ type: 'SET_THEME', theme: t as never })
    persist({ theme: t })
  }

  const pickDataPath = async () => {
    const dir = await window.api?.dialog?.openDirectory()
    if (dir) persist({ dataPath: dir })
  }

  return (
    <SettingsLayout title="常规">
      {/* 工作目录 */}
      <SettingsCard>
        <SettingsRow title="工作目录" desc="新会话默认的工作目录路径。" noBorder>
          <input
            type="text"
            value={s.cwd}
            onChange={e => persist({ cwd: e.target.value })}
            placeholder="/path/to/project"
            style={{ ...inputStyle, minWidth: 320 }}
          />
        </SettingsRow>
      </SettingsCard>

      {/* 外观（桌面应用主题，localStorage 持久化） */}
      <SettingsCard>
        <SettingsRow title="界面主题" desc="切换桌面应用界面使用的主题外观。">
          <select value={s.theme} onChange={e => applyTheme(e.target.value)} style={selectStyle}>
            <option value="codex-light">Codex 浅色</option>
            <option value="codex-warm">Codex 暖白</option>
            <option value="codex-cool">Codex 冷灰</option>
            <option value="codex-paper">Codex 纸感</option>
          </select>
        </SettingsRow>
        <SettingsRow title="界面语言" desc="切换桌面应用界面的显示语言（中/英）。">
          <select value={s.lang} onChange={e => persist({ lang: e.target.value })} style={selectStyle}>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </SettingsRow>
        <SettingsRow title="界面缩放" desc="调整当前窗口中文本和控件的整体显示大小。" noBorder>
          <Segmented
            value={s.zoom}
            onChange={v => persist({ zoom: v })}
            options={[
              { id: 'small', label: '缩小' },
              { id: 'normal', label: '正常' },
              { id: 'large', label: '偏大' }
            ]}
          />
        </SettingsRow>
      </SettingsCard>

      {/* 终端 */}
      <SettingsCard>
        <SettingsRow title="继承系统终端 Profile" desc="启动内置终端时尽量继承登录 shell 环境、代理、Kube 变量等。">
          <Toggle on={s.inheritTerminal} onChange={v => persist({ inheritTerminal: v })} />
        </SettingsRow>
        <SettingsRow title="终端字体" desc="配置自定义终端字体，填写后作为字体覆盖。" noBorder>
          <input value={s.terminalFont} onChange={e => persist({ terminalFont: e.target.value })} style={inputStyle} />
        </SettingsRow>
      </SettingsCard>

      {/* HTTP 代理（读写 ~/.claude/settings.json 的 env.HTTPS_PROXY/HTTP_PROXY） */}
      <SettingsCard>
        <SettingsRow title="HTTP 代理" desc="模型、MCP 与命令工具的出口流量将经此代理（env.HTTPS_PROXY）。" noBorder>
          <input value={ccProxy} onChange={e => saveCc({ proxy: e.target.value })} placeholder="http://127.0.0.1:7890" style={inputStyle} />
        </SettingsRow>
      </SettingsCard>

      {/* 通知 */}
      <SettingsCard>
        <SettingsRow title="任务通知" desc="任务完成、失败或需要确认时发送桌面通知。">
          <Toggle on={s.taskNotify} onChange={v => persist({ taskNotify: v })} />
        </SettingsRow>
        <SettingsRow title="通知声音" desc="通知开启后，可单独关闭任务通知提示音。" noBorder>
          <Toggle on={s.notifySound} onChange={v => persist({ notifySound: v })} />
        </SettingsRow>
      </SettingsCard>

      {/* 交互行为 */}
      <SettingsCard>
        <SettingsRow title="交互行为" desc="在 Agent 运行时将后续操作加入队列。">
          <select value={s.queueMode} onChange={e => persist({ queueMode: e.target.value })} style={selectStyle}>
            <option value="queue">队列</option>
            <option value="interrupt">中断</option>
          </select>
        </SettingsRow>
        <SettingsRow title="显示思考过程" desc="在消息流中展示模型思考内容。">
          <Toggle on={s.showThinking} onChange={v => persist({ showThinking: v })} />
        </SettingsRow>
        <SettingsRow title="显示待办" desc="在消息流中展示 Todo 工具卡片。" noBorder>
          <Toggle on={s.showTodo} onChange={v => persist({ showTodo: v })} />
        </SettingsRow>
      </SettingsCard>

      {/* 自动归档 */}
      <SettingsCard>
        <SettingsRow title="自动归档旧任务" desc="定时扫描已打开工作区，将已完成、无未读、未置顶任务归档。">
          <Toggle on={s.autoArchive} onChange={v => persist({ autoArchive: v })} />
        </SettingsRow>
        <SettingsRow title="归档保留时长" desc="任务最后更新时间早于该时长后进入自动归档候选。" noBorder>
          <select value={s.archiveDays} onChange={e => persist({ archiveDays: e.target.value })} style={selectStyle}>
            <option value="1">1天后归档</option>
            <option value="7">7天后归档</option>
            <option value="30">30天后归档</option>
          </select>
        </SettingsRow>
      </SettingsCard>

      {/* 数据存储路径 */}
      <SettingsCard>
        <SettingsRow title="数据存储路径" desc="应用数据根目录（默认用户主目录）。" noBorder>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={s.dataPath} onChange={e => persist({ dataPath: e.target.value })} style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
            <button onClick={pickDataPath} style={{ padding: '5px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text)' }}>选择文件夹</button>
          </span>
        </SettingsRow>
      </SettingsCard>
    </SettingsLayout>
  )
}
