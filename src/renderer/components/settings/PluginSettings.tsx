import { mockPlugins } from '../../state/mockData'
import { EntryListSection } from './EntryListSection'
export function PluginSettings() { return <EntryListSection title="插件" entries={mockPlugins} /> }
