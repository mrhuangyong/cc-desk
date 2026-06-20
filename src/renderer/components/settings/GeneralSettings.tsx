import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { SettingsLayout } from './SettingsLayout'
import { SettingsCard } from './SettingsCard'
import { SettingsRow } from './SettingsRow'
import { Toggle } from './Toggle'
import { useI18n } from '../../i18n/useI18n'

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
  const { t } = useI18n()
  const s = state.settings

  // Claude 配置（proxy，来自 ~/.cc-desk/claude/settings.json）
  const [ccProxy, setCcProxy] = useState('')

  useEffect(() => {
    window.api?.cc?.general.get().then(c => { setCcProxy(c.proxy) })
  }, [])

  // 桌面应用偏好持久化（electron-store，真实生效）
  const persist = (patch: Partial<typeof s>) => {
    dispatch({ type: 'SET_SETTINGS', settings: patch })
    window.api?.settings.save(patch)
  }

  // Claude 配置持久化（~/.cc-desk/claude/settings.json）
  const saveCc = (patch: { proxy?: string }) => {
    window.api?.cc?.general.save(patch)
    if (patch.proxy !== undefined) setCcProxy(patch.proxy)
  }

  const applyTheme = (t: string) => {
    dispatch({ type: 'SET_THEME', theme: t as never })
    persist({ theme: t })
  }

  return (
    <SettingsLayout title="常规">
      {/* 外观（桌面应用主题，localStorage 持久化） */}
      <SettingsCard>
        <SettingsRow title="界面主题" desc="切换桌面应用界面使用的主题外观。">
          <select value={s.theme} onChange={e => applyTheme(e.target.value)} style={selectStyle}>
            <option value="codex-light">浅色</option>
            <option value="codex-warm">暖白</option>
            <option value="codex-cool">冷灰</option>
            <option value="codex-paper">纸感</option>
            <option value="codex-dark">深色</option>
          </select>
        </SettingsRow>
        <SettingsRow title="界面语言" desc="切换桌面应用界面的显示语言（中/英）。">
          <select value={s.lang} onChange={e => persist({ lang: e.target.value })} style={selectStyle}>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </SettingsRow>
        <SettingsRow title="界面缩放" desc="调整当前窗口中文本和控件的整体显示大小。">
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
        <SettingsRow title={t('settings.chatWidth')} desc={t('settings.chatWidthDesc')} noBorder>
          <Segmented
            value={s.chatWidth}
            onChange={v => persist({ chatWidth: v })}
            options={[
              { id: 'compact', label: t('settings.chatWidthCompact') },
              { id: 'standard', label: t('settings.chatWidthStandard') },
              { id: 'wide', label: t('settings.chatWidthWide') },
              { id: 'xwide', label: t('settings.chatWidthXWide') },
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

      {/* HTTP 代理（读写 ~/.cc-desk/claude/settings.json 的 env.HTTPS_PROXY/HTTP_PROXY） */}
      <SettingsCard>
        <SettingsRow title="HTTP 代理" desc="模型、MCP 与命令工具的出口流量将经此代理（env.HTTPS_PROXY）。" noBorder>
          <input value={ccProxy} onChange={e => saveCc({ proxy: e.target.value })} placeholder="http://127.0.0.1:7890" style={inputStyle} />
        </SettingsRow>
      </SettingsCard>

      {/* 通知 */}
      <SettingsCard>
        <SettingsRow title={t('settings.notifyMaster')} desc={t('settings.notifyMasterDesc')}>
          <Toggle on={s.taskNotify} onChange={v => persist({ taskNotify: v })} />
        </SettingsRow>
        {s.taskNotify && (
          <div style={{ paddingLeft: 16 }}>
            <SettingsRow title={t('settings.notifyOnComplete')} desc={t('settings.notifyOnCompleteDesc')}>
              <Toggle on={s.notifyOnComplete} onChange={v => persist({ notifyOnComplete: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifyOnError')} desc={t('settings.notifyOnErrorDesc')}>
              <Toggle on={s.notifyOnError} onChange={v => persist({ notifyOnError: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifyOnConfirm')} desc={t('settings.notifyOnConfirmDesc')}>
              <Toggle on={s.notifyOnConfirm} onChange={v => persist({ notifyOnConfirm: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifyOnPermission')} desc={t('settings.notifyOnPermissionDesc')}>
              <Toggle on={s.notifyOnPermission} onChange={v => persist({ notifyOnPermission: v })} />
            </SettingsRow>
            <SettingsRow title={t('settings.notifySound')} desc={t('settings.notifySoundDesc')} noBorder>
              <Toggle on={s.notifySound} onChange={v => persist({ notifySound: v })} />
            </SettingsRow>
          </div>
        )}
      </SettingsCard>

      {/* 交互行为 */}
      <SettingsCard>
        <SettingsRow title={t('settings.interaction')} desc={t('settings.interactionDesc')}>
          <select value={s.queueMode} onChange={e => persist({ queueMode: e.target.value })} style={selectStyle}>
            <option value="queue">{t('settings.interactionQueue')}</option>
            <option value="guide">{t('settings.interactionGuide')}</option>
          </select>
        </SettingsRow>
        <SettingsRow title="显示思考过程" desc="在消息流中展示模型思考内容。">
          <Toggle on={s.showThinking} onChange={v => persist({ showThinking: v })} />
        </SettingsRow>
        <SettingsRow title="显示任务面板" desc="在右上角悬浮面板展示 Claude 规划的任务列表。" noBorder>
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

      {/* 开发者 */}
      <SettingsCard>
        <SettingsRow title="开发者模式" desc={`打开后可使用 DevTools 控制台调试（${navigator.userAgent.includes('Macintosh') ? '⌘⌥I' : 'F12'}）。`} noBorder>
          <Toggle on={s.devTools} onChange={v => {
            persist({ devTools: v })
            window.api?.setDevTools?.(v)
          }} />
        </SettingsRow>
      </SettingsCard>
    </SettingsLayout>
  )
}
