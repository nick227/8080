/** Add a preset in styles/presets/, import it in styles/themes.css, and register it here. IDs are persistent:
 * keep them stable when renaming labels. Groups become native select optgroups. */
export type ThemeDefinition = {
  id: string
  label: string
  group: string
  description?: string
}

export const themes = [
  { id: 'dark', label: 'Dark', group: 'Essentials' },
  { id: 'light', label: 'Light', group: 'Essentials' },
  { id: 'material', label: 'Material', group: 'Design systems', description: 'Tonal lilac surfaces, capsule actions, and measured elevation.' },
  { id: 'apple', label: 'Apple', group: 'Design systems', description: 'Cool porcelain, system typography, inset fields, and soft precision.' },
  { id: 'openai', label: 'OpenAI', group: 'Design systems', description: 'Warm neutral work surfaces, quiet borders, and clear rounded controls.' },
  { id: 'discord', label: 'Discord', group: 'Design systems', description: 'Layered slate channels with blurple actions and friendly rounded edges.' },
  { id: 'monokai', label: 'Monokai', group: 'Expressive', description: 'Editor charcoal, pink signals, lime actions, and cyan focus rings.' },
  { id: 'brutalist', label: 'Brutalist', group: 'Expressive', description: 'Ink on concrete, construction-yellow controls, and unapologetic hard shadows.' },
  { id: 'ultra-large', label: 'Ultra Large', group: 'Density', description: 'Large readable type, generous controls, and roomy navigation without zoom hacks.' },
  { id: 'ultra-compact', label: 'Ultra Compact', group: 'Density', description: 'A precise graphite workspace with tight rhythm and stable, readable labels.' },
  { id: 'hyper-modernism', label: 'Hyper-modernism', group: 'Expressive', description: 'Midnight indigo, electric cyan edges, and wide, crisply spaced surfaces.' },
  { id: 'bauhaus', label: 'Bauhaus', group: 'Expressive', description: 'Architectural ivory, primary red actions, cobalt focus, and geometric circles.' },
  { id: 'dream-world', label: 'Dream World', group: 'Expressive', description: 'Cloud-lilac surfaces, berry text, pill controls, and soft lavender shadows.' },
  { id: 'editorial-magazine', label: 'Editorial Magazine', group: 'Expressive', description: 'Porcelain paper, oxblood rules, book typography, and deliberate editorial spacing.' },
  { id: 'retro-terminal', label: 'Retro-terminal', group: 'Expressive', description: 'Phosphor green on deep evergreen, monospace utility, and square cursor-like controls.' },
  { id: 'zen-minimalism', label: 'Zen Minimalism', group: 'Expressive', description: 'Rice-paper surfaces, inkstone type, moss accents, and spacious quiet rhythm.' },
  { id: 'nightmare-horror', label: 'Nightmare Horror', group: 'Expressive', description: 'Bruised burgundy, bone-white serif type, and blood-red accents without flicker.' },
  { id: 'fjord', label: 'Fjord', group: 'Community inspired', description: 'Cool slate layers, glacier-blue actions, and precise humanist typography.' },
  { id: 'workshop', label: 'Workshop', group: 'Community inspired', description: 'Warm charcoal, brass actions, sturdy outlines, and practical workshop rhythm.' },
  { id: 'periwinkle', label: 'Periwinkle', group: 'Community inspired', description: 'Lavender-gray surfaces, plum typography, and rounded violet actions.' },
  { id: 'wayfinder', label: 'Wayfinder', group: 'Community inspired', description: 'Bright white, decisive navy rules, and clear blue actions with generous targets.' },
  { id: 'acid-opera', label: 'Acid Opera', group: 'Art house', description: 'Aubergine velvet, chartreuse spotlights, theatrical serif type, and sweeping curves.' },
  { id: 'cobalt-cabaret', label: 'Cobalt Cabaret', group: 'Art house', description: 'An electric-blue stage, butter-yellow lettering, coral actions, and stepped poster shadows.' },
  { id: 'bubblegum-riot', label: 'Bubblegum Riot', group: 'Art house', description: 'Hot-pink paper, black ink, lemon actions, oversized block type, and cutout geometry.' },
  { id: 'obsidian-gilt', label: 'Obsidian Gilt', group: 'Art house', description: 'Petrol-black lacquer, champagne gold, engraved rules, and architectural serif forms.' },
] as const satisfies readonly ThemeDefinition[]

if (new Set(themes.map(theme => theme.id)).size !== themes.length) {
  throw new Error('Theme registry IDs must be unique')
}

export type ThemeId = typeof themes[number]['id']
export const DEFAULT_THEME: ThemeId = 'dark'

export function resolveTheme(value: string | null): ThemeId {
  return themes.find(theme => theme.id === value)?.id ?? DEFAULT_THEME
}

export const themeGroups = Array.from(new Set(themes.map(theme => theme.group)), group => ({
  label: group,
  themes: themes.filter(theme => theme.group === group),
}))
