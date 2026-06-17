import { useEffect, useState } from 'react'
import { EntryListSection } from './EntryListSection'

export function CommandSettings() {
  const [entries, setEntries] = useState<{ id: string; name: string; desc: string; enabled: boolean }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api?.cc?.commands.get().then(list => { setEntries(list); setLoading(false) })
  }, [])

  return (
    <EntryListSection title="命令" entries={entries} loading={loading} desc="来自已启用插件的 commands/ 目录 + 用户级 ~/.claude/commands/。" />
  )
}
