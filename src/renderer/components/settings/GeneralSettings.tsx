import { useState } from 'react'
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

const selectStyle: React.CSSProperties = { padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)' }
const inputStyle: React.CSSProperties = { padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 280 }
const saveBtnStyle: React.CSSProperties = { padding: '5px 12px', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'transparent', color: 'var(--text)' }

export function GeneralSettings() {
  const { state, dispatch } = useStore()

  // 本地状态（原型不持久化）
  const [theme, setTheme] = useState(state.theme)
  const [lang, setLang] = useState('zh-CN')
  const [zoom, setZoom] = useState('normal')
  const [inheritTerminal, setInheritTerminal] = useState(true)
  const [terminalFont, setTerminalFont] = useState('MesloLGS NF, monospace')
  const [proxy, setProxy] = useState('http://127.0.0.1:7890')
  const [taskNotify, setTaskNotify] = useState(true)
  const [notifySound, setNotifySound] = useState(true)
  const [queueMode, setQueueMode] = useState('queue')
  const [showThinking, setShowThinking] = useState(false)
  const [showTodo, setShowTodo] = useState(false)
  const [autoArchive, setAutoArchive] = useState(true)
  const [archiveDays, setArchiveDays] = useState('7')
  const [dataPath] = useState('/Users/mrhua')

  const applyTheme = (t: string) => {
    setTheme(t as never)
    dispatch({ type: 'SET_THEME', theme: t as never })
  }

  return (
    <SettingsLayout title="常规">
      {/* 外观 */}
      <SettingsCard>
        <SettingsRow title="界面主题" desc="切换应用界面使用的主题外观。">
          <select value={theme} onChange={e => applyTheme(e.target.value)} style={selectStyle}>
            <option value="dark-warm">暖色暗夜</option>
            <option value="dark-cool">冷峻深空</option>
            <option value="light-editorial">纸感明亮</option>
            <option value="dark-acid">酸性极客</option>
          </select>
        </SettingsRow>
        <SettingsRow title="界面语言" desc="选择应用 UI 的显示语言。">
          <select value={lang} onChange={e => setLang(e.target.value)} style={selectStyle}>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </SettingsRow>
        <SettingsRow title="界面缩放" desc="调整当前窗口中文本和控件的整体显示大小。" noBorder>
          <Segmented
            value={zoom}
            onChange={setZoom}
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
          <Toggle on={inheritTerminal} onChange={setInheritTerminal} />
        </SettingsRow>
        <SettingsRow title="终端字体" desc="配置自定义终端系统终端配置，填写后作为字体覆盖。" noBorder>
          <span style={{ display: 'flex', gap: 6 }}>
            <input value={terminalFont} onChange={e => setTerminalFont(e.target.value)} style={inputStyle} />
            <button style={saveBtnStyle}>保存</button>
          </span>
        </SettingsRow>
      </SettingsCard>

      {/* HTTP 代理 */}
      <SettingsCard>
        <SettingsRow title="HTTP 代理" desc="模型、MCP 与命令工具的出口流量将经此代理。" noBorder>
          <span style={{ display: 'flex', gap: 6 }}>
            <input value={proxy} onChange={e => setProxy(e.target.value)} style={inputStyle} />
            <button style={saveBtnStyle}>保存</button>
          </span>
        </SettingsRow>
      </SettingsCard>

      {/* 通知 */}
      <SettingsCard>
        <SettingsRow title="任务通知" desc="任务完成、失败或需要确认时发送桌面通知。">
          <Toggle on={taskNotify} onChange={setTaskNotify} />
        </SettingsRow>
        <SettingsRow title="通知声音" desc="通知开启后，可单独关闭任务通知提示音。" noBorder>
          <Toggle on={notifySound} onChange={setNotifySound} />
        </SettingsRow>
      </SettingsCard>

      {/* 交互行为 */}
      <SettingsCard>
        <SettingsRow title="交互行为" desc="在 ZCode 运行时将后续操作加入队列。">
          <select value={queueMode} onChange={e => setQueueMode(e.target.value)} style={selectStyle}>
            <option value="queue">队列</option>
            <option value="interrupt">中断</option>
          </select>
        </SettingsRow>
        <SettingsRow title="显示思考过程" desc="在消息流中展示模型思考内容。">
          <Toggle on={showThinking} onChange={setShowThinking} />
        </SettingsRow>
        <SettingsRow title="显示待办" desc="在消息流中展示 Todo 工具卡片。" noBorder>
          <Toggle on={showTodo} onChange={setShowTodo} />
        </SettingsRow>
      </SettingsCard>

      {/* 自动归档 */}
      <SettingsCard>
        <SettingsRow title="自动归档旧任务" desc="定时扫描已打开工作区，将已完成、无未读、未置顶任务归档。">
          <Toggle on={autoArchive} onChange={setAutoArchive} />
        </SettingsRow>
        <SettingsRow title="归档保留时长" desc="任务最后更新时间早于该时长后进入自动归档候选。" noBorder>
          <select value={archiveDays} onChange={e => setArchiveDays(e.target.value)} style={selectStyle}>
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
            <input value={dataPath} readOnly style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }} />
            <button style={saveBtnStyle}>选择文件夹</button>
            <button style={saveBtnStyle}>保存</button>
          </span>
        </SettingsRow>
      </SettingsCard>

      {/* 引导 */}
      <SettingsCard>
        <SettingsRow title="引导" desc="重新打开引导弹窗，查看迁移选项并导入设置。" noBorder>
          <button style={saveBtnStyle}>打开引导</button>
        </SettingsRow>
      </SettingsCard>
    </SettingsLayout>
  )
}
