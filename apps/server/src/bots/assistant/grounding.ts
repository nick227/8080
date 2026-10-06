// The deterministic check between a model's reading of a note and any record
// (doc/13 §10 rule 7): every value must be in the note itself, or carry a quote that
// is. What fails is dropped, not guessed at. Pure.
import type { NoteReading } from './provider'

const fold = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
const inNote = (note: string, value: string | null | undefined) => !!value && value.trim().length > 0 && fold(note).includes(fold(value))
const digits = (s: string) => s.replace(/\D/g, '')
const ISO = /^\d{4}-\d{2}-\d{2}$/

export type Grounded = NoteReading & { dropped: string[] }

/** Keeps what the note supports. `today` bounds a follow-up date to a sensible window. */
export function ground(note: string, raw: unknown, today: string): Grounded {
  const r = (raw ?? {}) as Partial<NoteReading>
  const dropped: string[] = []
  const keep = (label: string, value: unknown, ok: (v: string) => boolean, max = 200): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null
    const v = value.trim().replace(/\s+/g, ' ').slice(0, max)
    if (ok(v)) return v
    dropped.push(label)
    return null
  }
  const text = (label: string, v: unknown, max?: number) => keep(label, v, (x) => inNote(note, x), max)
  const email = keep('email', r.person?.email, (x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) && inNote(note, x), 254)
  const phone = keep('phone', r.person?.phone, (x) => digits(x).length >= 7 && digits(note).includes(digits(x)), 40)

  let followUp: NoteReading['followUp'] = { date: null, quote: null }
  if (r.followUp?.date || r.followUp?.quote) {
    const date = r.followUp?.date ?? ''
    const t0 = Date.parse(`${today}T00:00:00Z`)
    const t = Date.parse(`${date}T00:00:00Z`)
    if (ISO.test(date) && inNote(note, r.followUp?.quote) && t >= t0 - 86_400_000 && t <= t0 + 400 * 86_400_000) {
      followUp = { date, quote: r.followUp!.quote!.trim() }
    } else dropped.push('followUp')
  }

  const facts: NoteReading['facts'] = []
  for (const f of Array.isArray(r.facts) ? r.facts.slice(0, 10) : []) {
    if (!f || !['need', 'timing', 'budget', 'other'].includes(f.key) || typeof f.value !== 'string' || !f.value.trim() || !inNote(note, f.quote)) { dropped.push(`fact:${f?.key ?? '?'}`); continue }
    facts.push({ key: f.key, value: f.value.trim().slice(0, 300), quote: f.quote.trim().slice(0, 300) })
  }

  return {
    person: {
      firstName: text('firstName', r.person?.firstName, 80),
      lastName: text('lastName', r.person?.lastName, 80),
      title: text('title', r.person?.title, 120),
      email,
      phone,
    },
    company: { name: text('company', r.company?.name, 160), domain: text('domain', r.company?.domain, 255) },
    followUp,
    facts,
    dropped,
  }
}
