// Who an @ names, shared by task comments and conversation messages.

/** People named with @ in a text: "@Ana" or "@Ana Lopez" (longest name wins). */
export function mentionedIn(text: string, members: { id: string; name: string }[]) {
  const lower = ` ${text.toLowerCase()}`
  const found = new Set<string>()
  const byLength = [...members].filter((m) => m.name.trim()).sort((x, y) => y.name.length - x.name.length)
  const firsts = new Map<string, number>()
  for (const m of byLength) {
    const first = m.name.trim().toLowerCase().split(/\s+/)[0]!
    firsts.set(first, (firsts.get(first) ?? 0) + 1)
  }
  for (const m of byLength) {
    const full = m.name.trim().toLowerCase()
    const first = full.split(/\s+/)[0]!
    // A first name alone only counts when nobody else shares it.
    for (const token of firsts.get(first) === 1 ? [full, first] : [full]) {
      const re = new RegExp(`(^|[^\\w@])@${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`)
      if (re.test(lower)) { found.add(m.id); break }
    }
  }
  return [...found]
}
