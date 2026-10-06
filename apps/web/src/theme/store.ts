import { create } from 'zustand'
import { resolveTheme, type ThemeId } from './registry'

export const THEME_STORAGE_KEY = '8080.theme'

function savedTheme(): ThemeId {
  try {
    return resolveTheme(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return resolveTheme(null)
  }
}

export const useTheme = create<{ theme: ThemeId; setTheme: (value: string) => void }>(set => ({
  theme: savedTheme(),
  setTheme: value => {
    const theme = resolveTheme(value)
    document.documentElement.dataset.theme = theme
    set({ theme })
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Theme selection still works when browser storage is unavailable.
    }
  },
}))

/** Called before React mounts, so the first application render uses the saved theme. */
export function initializeTheme(): () => void {
  document.documentElement.dataset.theme = useTheme.getState().theme
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
    if (event.storageArea !== localStorage) return
    const theme = resolveTheme(event.newValue)
    document.documentElement.dataset.theme = theme
    useTheme.setState({ theme })
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
