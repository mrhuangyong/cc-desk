import { useEffect, useState } from 'react'
import { EntryListSection } from './EntryListSection'

export function HooksSettings() {
  const [entries, setEntries] = useState<{ id: string; name: string; desc: string; enabled: boolean }[]>([])
  const [loading, setLoading] = useState(true)

  const reload = () => {
    setLoading(true)
    window.api?.cc?.hooks.get().then(list => { setEntries(list); setLoading(false) })
  }
  useEffect(() => { reload() }, [])

  const onToggle = async (name: string) => {
    const e = entries.find(x => x.name === name)
    if (!e) return
    await window.api?.cc?.hooks.setEnabled(name, !e.enabled)
    reload()
  }

  return (
    <EntryListSection
      title="hooks"
      entries={entries}
      loading={loading}
      onToggle={onToggle}
      desc="读写 ~/.claude/settings.json 的 hooks 字段。"
    />
  )
}
