import { themeGroups } from '../theme/registry'
import { useTheme } from '../theme/store'

export function ThemeSwitcher() {
  const theme = useTheme(state => state.theme)
  const setTheme = useTheme(state => state.setTheme)

  return (
    <label className="theme-switcher">
      <select aria-label="Theme" value={theme} onChange={event => setTheme(event.target.value)}>
        {themeGroups.map(group => (
          <optgroup key={group.label} label={group.label}>
            {group.themes.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
