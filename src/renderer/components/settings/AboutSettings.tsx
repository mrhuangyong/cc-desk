import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { useI18n } from '../../i18n/useI18n'
import { SettingsLayout } from './SettingsLayout'

const REPO_URL = 'https://github.com/mrhuangyong/cc-desk'

export function AboutSettings() {
  const { state } = useStore()
  const { t } = useI18n()
  const s = state.updateStatus
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api?.appVersion?.get?.().then((v) => setVersion(v.version)).catch(() => {})
  }, [])

  const isMac = navigator.userAgent.includes('Macintosh')

  const renderUpdateAction = () => {
    switch (s.state) {
      case 'idle':
        return <button onClick={() => window.api.update.check()}>{t('about.checkUpdate')}</button>
      case 'checking':
        return <button disabled>{t('about.checking')}</button>
      case 'available':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{t('about.newVersion')} v{s.version}</span>
            {isMac ? (
              <button onClick={() => window.api.update.downloadAndOpen()}>{t('about.downloadOpen')}</button>
            ) : (
              <span>{t('about.downloading')}</span>
            )}
          </div>
        )
      case 'downloading':
        return <span>{t('about.downloading')} {s.percent}%</span>
      case 'ready':
        return (
          <button
            onClick={() => window.api.update.install()}
            style={{ background: '#1f9d55', color: '#fff' }}
          >
            {t('about.installRestart')}
          </button>
        )
      case 'error':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'crimson' }}>{s.message}</span>
            <button onClick={() => window.api.update.check()}>{t('about.retry')}</button>
          </div>
        )
    }
  }

  return (
    <SettingsLayout title={t('about.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>cc-desk</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {t('about.version')}：{version || '—'}
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>{t('about.desc')}</p>
        <div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{t('about.repo')}</div>
          <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 13 }}>
            {REPO_URL}
          </a>
        </div>
        <div style={{ marginTop: 8 }}>{renderUpdateAction()}</div>
      </div>
    </SettingsLayout>
  )
}
