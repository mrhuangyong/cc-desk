// 拨动开关：[●]=on / [○]=off。设置页各子页共用。
interface Props {
  on: boolean
  onChange: (v: boolean) => void
  'aria-label'?: string
}

export function Toggle({ on, onChange, ...rest }: Props) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={rest['aria-label']}
      style={{
        width: 36, height: 20, borderRadius: 999, cursor: 'pointer',
        border: '1px solid var(--border)', padding: 0, position: 'relative',
        background: on ? 'var(--accent)' : 'var(--bg)'
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14,
        borderRadius: '50%', background: on ? 'var(--accent-text)' : 'var(--text-muted)',
        transition: 'left .12s'
      }} />
    </button>
  )
}
