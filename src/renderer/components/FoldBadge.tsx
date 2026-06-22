// 折叠态数量角标：卡片折叠成单个图标时，在图标右上角显示总数，
// 让用户一眼知道该类有多少项，无需展开即可感知。0 时不渲染。
export function FoldBadge({ count }: { count: number }) {
  if (!count || count < 1) return null
  return (
    <span style={{
      position: 'absolute', top: -4, right: -6,
      minWidth: 15, height: 15, padding: '0 4px',
      borderRadius: 8, background: 'var(--accent, #2563eb)', color: '#fff',
      fontSize: 9.5, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
      boxShadow: '0 0 0 1.5px var(--surface-1)',
    }}>
      {count > 99 ? '99+' : count}
    </span>
  )
}
