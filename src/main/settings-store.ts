// src/main/settings-store.ts
import Store from 'electron-store'

export interface AppSettings {
  apiKey: string
  model: string
  cwd: string
}

const defaults: AppSettings = {
  apiKey: '',
  model: 'sonnet',
  cwd: process.env.HOME || '',
}

const store = new Store<{ settings: AppSettings }>({
  defaults: { settings: defaults },
})

export function getSettings(): AppSettings {
  return store.get('settings', defaults)
}

export function saveSettings(partial: Partial<AppSettings>): void {
  const current = getSettings()
  store.set('settings', { ...current, ...partial })
}
