// The deterministic check between a model's brief and what it may claim (doc/13 D3):
// every claim must cite evidence from the pack, and every number, amount or date it
// states must appear in what it cites. What fails is dropped and counted. Pure.
import type { Brief, Claim, Evidence } from './provider'

// Month and weekday words, each mapped to the stem looked for in the evidence.
const MONTH_WORDS: Record<string, string> = Object.fromEntries(
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    .flatMap((m) => [[m, m.slice(0, 3)], [m.slice(0, 3), m.slice(0, 3)]]),
)
MONTH_WORDS.sept = 'sep'
const WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
const fold = (s: string) => s.toLowerCase().replace(/[’']/g, "'")

/** The checkable specifics of a sentence: digit runs, month and weekday names. */
function specifics(text: string) {
  const t = fold(text)
  const numbers = (t.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]/g, '')).filter(Boolean)
  const words = t.match(/[a-z]+/g) ?? []
  return { numbers, months: words.filter((w) => w in MONTH_WORDS).map((w) => MONTH_WORDS[w]!), days: words.filter((w) => WEEKDAYS.has(w)) }
}

export type GroundedBrief = Brief & { dropped: number }

export function groundBrief(raw: unknown, pack: Evidence[]): GroundedBrief {
  const byId = new Map(pack.map((e) => [e.id, e]))
  let dropped = 0
  const supported = (text: string, ids: string[]) => {
    const cited = ids.map((id) => byId.get(id)).filter(Boolean) as Evidence[]
    if (!cited.length) return false
    const source = fold(cited.map((e) => `${e.when ?? ''} ${e.title} ${e.text}`).join(' '))
    const sourceNumbers = new Set((source.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]/g, '')))
    const s = specifics(text)
    // "$8k" is 8 thousand: accept a number when it or its thousands appear in the source.
    const numberOk = (n: string) => sourceNumbers.has(n) || (n.endsWith('000') && sourceNumbers.has(n.slice(0, -3))) || sourceNumbers.has(`${n}000`)
    return s.numbers.every(numberOk) && s.months.every((m) => source.includes(m)) && s.days.every((d) => source.includes(d))
  }
  const claims = (list: unknown): Claim[] => {
    if (!Array.isArray(list)) return []
    const out: Claim[] = []
    for (const c of list.slice(0, 8)) {
      const text = typeof c?.text === 'string' ? c.text.trim().replace(/\s+/g, ' ').slice(0, 400) : ''
      const ids = Array.isArray(c?.evidence) ? [...new Set(c.evidence.filter((id: unknown) => typeof id === 'string' && byId.has(id)))] as string[] : []
      if (text && supported(text, ids)) out.push({ text, evidence: ids })
      else dropped++
    }
    return out
  }
  const r = (raw ?? {}) as Partial<Brief>
  let nextStep: Brief['nextStep'] = null
  if (r.nextStep && typeof r.nextStep.text === 'string' && r.nextStep.text.trim()) {
    const basis = Array.isArray(r.nextStep.basis) ? [...new Set(r.nextStep.basis.filter((id) => byId.has(id)))] : []
    // Inference, but its specifics (a date, an amount) must still come from its basis.
    if (basis.length && supported(r.nextStep.text, basis)) nextStep = { text: r.nextStep.text.trim().slice(0, 300), basis }
    else dropped++
  }
  return { summary: claims(r.summary), need: claims(r.need), recent: claims(r.recent), commitments: claims(r.commitments), openQuestions: claims(r.openQuestions), nextStep, dropped }
}
