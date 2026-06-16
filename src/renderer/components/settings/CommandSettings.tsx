import { mockCommands } from '../../state/mockData'
import { EntryListSection } from './EntryListSection'
export function CommandSettings() { return <EntryListSection title="命令" entries={mockCommands} /> }
