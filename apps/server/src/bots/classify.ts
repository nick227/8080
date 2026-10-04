// Deterministic Phase 1 classifier (doc/08 R15): rule tables from the pack.
import type { Pack } from './pack'

export type Classified = { intents: { intent: string; score: number }[]; version: string }

export function classify(text: string, classifier: Pack['classifier']): Classified {
  const best = new Map<string, number>()
  for (const rule of classifier.rules) {
    if (rule.patterns.some((p) => p.test(text))) best.set(rule.intent, Math.max(best.get(rule.intent) ?? 0, rule.score))
  }
  const intents = [...best].map(([intent, score]) => ({ intent, score })).sort((a, b) => b.score - a.score || a.intent.localeCompare(b.intent))
  return { intents, version: classifier.version }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Which seated bots a text summons. Longest alias first, and a matched span is
 * consumed — "marketing chatbot" summons the marketing bot only, never also
 * "chatbot" (doc/08 R11).
 */
export function mentionedBots(text: string, bots: { id: string; aliases: string[] }[]): Set<string> {
  const aliases = bots.flatMap((b) => b.aliases.map((alias) => ({ id: b.id, alias: alias.toLowerCase() })))
  aliases.sort((a, b) => b.alias.length - a.alias.length)
  let rest = text.toLowerCase()
  const found = new Set<string>()
  for (const { id, alias } of aliases) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])@?${escape(alias)}(?=$|[^\\p{L}\\p{N}_])`, 'gu')
    if (re.test(rest)) {
      found.add(id)
      rest = rest.replace(re, (m) => ' '.repeat(m.length))
    }
  }
  return found
}
