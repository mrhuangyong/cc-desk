// src/renderer/components/settings/RemoteSettings.tsx
// 远程控制设置区块：开关、中继地址、配对（码+二维码）、已配对设备列表、连接状态。
//
// 数据流：
// - 配置（enabled/relayUrl/pairedDevices）经 window.api.remote.get/saveConfig 读写，存 ~/.cc-desk/config.json
// - 配对码 + 二维码经 window.api.remote.pair() 从中继 /pair 端点实时申请（非 mock）
// - 连接状态经 window.api.remote.onState 订阅（bridge bind 握手成功 → connected）
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { SettingsLayout } from './SettingsLayout'
import { SettingsCard } from './SettingsCard'
import { SettingsRow } from './SettingsRow'
import { Toggle } from './Toggle'

interface RemoteConfig {
  enabled: boolean
  relayUrl: string
  deviceId: string
  deviceKey: string
  pairedDevices: string[]
  shareLinks?: { token: string; url: string; createdAt: number; expiresAt: number }[]
}

interface PairResult {
  code?: string
  qr?: string
  expiresAt?: number
  error?: string
}

interface ShareLinkResult {
  token?: string
  url?: string
  qr?: string
  expiresAt?: number
  error?: string
}

interface ShareLinkItem {
  token: string
  url: string
  createdAt: number
  expiresAt: number
  qr?: string
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--bg-sidebar)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12,
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--accent)', color: 'var(--accent-text)',
}

const mutedStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }

export function RemoteSettings() {
  const { t } = useI18n()
  const [cfg, setCfg] = useState<RemoteConfig | null>(null)
  const [connected, setConnected] = useState(false)
  const [pair, setPair] = useState<PairResult | null>(null)
  const [pairing, setPairing] = useState(false)
  const [relayDraft, setRelayDraft] = useState('')
  // 分享链接
  const [shareLinks, setShareLinks] = useState<ShareLinkItem[]>([])
  const [creatingShare, setCreatingShare] = useState(false)
  const [shareExpiry, setShareExpiry] = useState<number>(30)
  const [shareError, setShareError] = useState('')
  const [shareQrMap, setShareQrMap] = useState<Record<string, string>>({})
  const [copiedToken, setCopiedToken] = useState('')

  // 拉取配置
  const refresh = useCallback(() => {
    window.api.remote.getConfig().then((c: RemoteConfig) => {
      setCfg(c)
      setRelayDraft(c.relayUrl)
      setShareLinks((c.shareLinks ?? []).map(l => ({ ...l, qr: shareQrMap[l.token] })))
    }).catch(() => {})
  }, [shareQrMap])

  useEffect(() => { refresh() }, [refresh])

  // 订阅连接状态 + 配对事件（unmount 时自动解绑，防监听器累加）
  useEffect(() => {
    const offState = window.api.remote.onState((s: { connected: boolean }) => setConnected(s.connected))
    const offPairEvent = window.api.remote.onPairEvent((data: { kind: string; deviceId?: string }) => {
      // 配对成功 / 解绑事件 → 刷新已配对列表
      if (data?.kind === 'paired' || data?.kind === 'unpaired') refresh()
    })
    return () => { offState(); offPairEvent() }
  }, [refresh])

  // 配对码倒计时
  const [remain, setRemain] = useState(0)
  useEffect(() => {
    if (!pair?.expiresAt) return
    const tick = () => {
      const left = Math.max(0, Math.floor((pair.expiresAt! - Date.now()) / 1000))
      setRemain(left)
      if (left <= 0) setPair(null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [pair?.expiresAt])

  if (!cfg) return null

  const update = (patch: Partial<RemoteConfig>) => {
    window.api.remote.saveConfig(patch)
    setCfg({ ...cfg, ...patch })
  }

  const onToggle = (enabled: boolean) => {
    update({ enabled })
    if (!enabled) setPair(null)
  }

  const onSaveRelay = () => {
    if (relayDraft.trim() && relayDraft !== cfg.relayUrl) update({ relayUrl: relayDraft.trim() })
  }

  const onPair = async () => {
    setPairing(true)
    setPair(null)
    try {
      const r: PairResult = await window.api.remote.pair()
      setPair(r)
    } catch (e) {
      setPair({ error: String(e) })
    } finally {
      setPairing(false)
    }
  }

  const onUnpair = (deviceId: string) => {
    window.api.remote.unpair(deviceId)
  }

  const onCreateShareLink = async () => {
    setCreatingShare(true)
    setShareError('')
    try {
      const r: ShareLinkResult = await window.api.remote.createShareLink(shareExpiry)
      if (r.error) {
        setShareError(r.error)
        return
      }
      if (r.token && r.url) {
        // 把刚生成的二维码存入 map，refresh 时回填
        setShareQrMap(prev => ({ ...prev, [r.token!]: r.qr ?? '' }))
        refresh()
      }
    } catch (e) {
      setShareError(String(e))
    } finally {
      setCreatingShare(false)
    }
  }

  const onRevokeShareLink = async (token: string) => {
    try {
      await window.api.remote.revokeShareLink(token)
      setShareQrMap(prev => {
        const next = { ...prev }
        delete next[token]
        return next
      })
      refresh()
    } catch { /* noop */ }
  }

  const onCopy = async (token: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(''), 1500)
    } catch { /* noop */ }
  }

  // 格式化过期时间
  const fmtExpiry = (expiresAt: number) => {
    if (!expiresAt || expiresAt > Date.now() + 1000 * 60 * 60 * 24 * 365 * 50) return t('remote.neverExpires')
    const left = expiresAt - Date.now()
    if (left <= 0) return t('remote.expired')
    const days = Math.floor(left / (1000 * 60 * 60 * 24))
    const hrs = Math.floor((left % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    return days > 0 ? `${days}天${hrs}小时` : `${hrs}小时`
  }

  return (
    <SettingsLayout title={t('remote.title')}>
      <SettingsCard>
        <SettingsRow title={t('remote.enable')} desc={t('remote.enableDesc')}>
          <Toggle on={cfg.enabled} onChange={onToggle} aria-label={t('remote.enable')} />
        </SettingsRow>
        <SettingsRow title={t('remote.status')} desc={t('remote.statusDesc')}>
          <span style={{ ...mutedStyle, color: connected ? 'var(--accent)' : 'var(--text-muted)' }}>
            {connected ? t('remote.connected') : (cfg.enabled ? t('remote.connecting') : t('remote.disconnected'))}
          </span>
        </SettingsRow>
        <SettingsRow title={t('remote.relayUrl')} desc={t('remote.relayUrlDesc')} noBorder>
          <div style={{ display: 'flex', gap: 8, width: 320 }}>
            <input
              value={relayDraft}
              onChange={(e) => setRelayDraft(e.target.value)}
              placeholder="https://ccdesk.mrhua.top"
              style={inputStyle}
            />
            <button onClick={onSaveRelay} style={{ ...btnStyle, background: 'var(--bg)', color: 'var(--text)' }}>
              {t('remote.save')}
            </button>
          </div>
        </SettingsRow>
      </SettingsCard>

      {cfg.enabled && (
        <SettingsCard>
          <SettingsRow title={t('remote.shareLinks')} desc={t('remote.shareLinksDesc')}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={shareExpiry}
                onChange={(e) => setShareExpiry(Number(e.target.value))}
                style={{ ...inputStyle, width: 'auto' }}
              >
                <option value={7}>{t('remote.expiry7')}</option>
                <option value={30}>{t('remote.expiry30')}</option>
                <option value={0}>{t('remote.expiryForever')}</option>
              </select>
              <button onClick={onCreateShareLink} disabled={creatingShare} style={{ ...btnStyle, opacity: creatingShare ? 0.6 : 1 }}>
                {creatingShare ? t('remote.pairing') : t('remote.genShareLink')}
              </button>
            </div>
          </SettingsRow>
          {shareError && (
            <SettingsRow title={t('remote.shareFailed')} noBorder>
              <span style={{ ...mutedStyle, color: 'var(--danger, #c0392b)' }}>{shareError}</span>
            </SettingsRow>
          )}
          {shareLinks.map((l, idx) => {
            const expired = l.expiresAt && l.expiresAt <= Date.now()
            return (
              <SettingsRow key={l.token} title={t('remote.shareCreated')} desc={fmtExpiry(l.expiresAt)} noBorder={idx === shareLinks.length - 1}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', maxWidth: 460 }}>
                  {l.qr && (
                    <img src={l.qr} alt={t('remote.pairQr')} style={{ width: 120, height: 120, borderRadius: 'var(--radius)', opacity: expired ? 0.4 : 1 }} />
                  )}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', maxWidth: '100%' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                      {l.url}
                    </span>
                    <button
                      onClick={() => onCopy(l.token, l.url)}
                      style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text-muted)' }}
                    >
                      {copiedToken === l.token ? t('remote.copied') : t('remote.copy')}
                    </button>
                    <button
                      onClick={() => onRevokeShareLink(l.token)}
                      style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--danger, #c0392b)' }}
                    >
                      {t('remote.delete')}
                    </button>
                  </div>
                  {expired && <span style={{ ...mutedStyle, color: 'var(--danger, #c0392b)' }}>{t('remote.expired')}</span>}
                </div>
              </SettingsRow>
            )
          })}
          {shareLinks.length > 0 && (
            <SettingsRow title="" noBorder>
              <span style={mutedStyle}>{t('remote.scanShareTip')}</span>
            </SettingsRow>
          )}
        </SettingsCard>
      )}

      {cfg.enabled && (
        <SettingsCard>
          <SettingsRow title={t('remote.pair')} desc={t('remote.pairDesc')}>
            <button onClick={onPair} disabled={pairing} style={{ ...btnStyle, opacity: pairing ? 0.6 : 1 }}>
              {pairing ? t('remote.pairing') : t('remote.genPair')}
            </button>
          </SettingsRow>
          {pair?.error && (
            <SettingsRow title={t('remote.pairFailed')} noBorder>
              <span style={{ ...mutedStyle, color: 'var(--danger, #c0392b)' }}>{pair.error}</span>
            </SettingsRow>
          )}
          {pair?.code && (
            <SettingsRow title={t('remote.pairCode')} desc={`${t('remote.expiresIn')} ${remain}s`} noBorder>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, letterSpacing: 4, color: 'var(--text)' }}>
                  {pair.code}
                </div>
                {pair.qr && (
                  <img src={pair.qr} alt={t('remote.pairQr')} style={{ width: 120, height: 120, borderRadius: 'var(--radius)' }} />
                )}
              </div>
            </SettingsRow>
          )}
          {pair?.code && (
            <SettingsRow title="" noBorder>
              <span style={mutedStyle}>{t('remote.scanTip')}</span>
            </SettingsRow>
          )}
        </SettingsCard>
      )}

      {cfg.enabled && cfg.pairedDevices.length > 0 && (
        <SettingsCard>
          <SettingsRow title={t('remote.pairedDevices')} desc={t('remote.pairedDevicesDesc')} noBorder>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              {cfg.pairedDevices.map((d) => (
                <span key={d} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{d.slice(0, 8)}…</span>
                  <button
                    onClick={() => onUnpair(d)}
                    style={{ padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', color: 'var(--text-muted)' }}
                  >
                    {t('remote.unpair')}
                  </button>
                </span>
              ))}
            </span>
          </SettingsRow>
        </SettingsCard>
      )}
    </SettingsLayout>
  )
}
