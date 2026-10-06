// The AI-off company description (doc/12 §6.4): a deterministic template over the
// company profile and the brief. Same inputs → same document. Slice C replaces the
// wording with a model draft; this stays the fallback and the test oracle.

export type ServiceArea = 'local' | 'regional' | 'national' | 'global'
export type Voice = 'professional' | 'friendly' | 'bold' | 'technical'
export type Audience = 'customers' | 'prospects' | 'partners' | 'investors' | 'general'
export type Length = 'short' | 'medium' | 'detailed'

export type ProfileFacts = {
  name: string
  location: string | null
  serviceArea: ServiceArea | null
  purpose: string | null
  brandVoice: Voice | null
  offerings: string[]
  customers: string[]
  differentiators: string[]
}
export type Brief = { audience: Audience; length: Length }
export type Section = { id: string; type: 'section'; level: 'h1' | 'body'; text: string }

const REACH: Record<ServiceArea, string> = {
  local: 'locally',
  regional: 'across the region',
  national: 'nationwide',
  global: 'around the world',
}

// One closing line per audience; the voice only colours the opening.
const CLOSING: Record<Audience, (name: string) => string> = {
  customers: (n) => `Get in touch to see how ${n} can help.`,
  prospects: (n) => `If that sounds like what you need, ${n} would like to hear from you.`,
  partners: (n) => `${n} is open to partners who share that focus.`,
  investors: (n) => `${n} is building on that focus and growing its reach.`,
  general: (n) => `That is what ${n} is about.`,
}

// `w` (where it's based) may be unknown in an assisted run that skipped asking.
const OPENING: Record<Voice, (name: string, where: string | null) => string> = {
  professional: (n, w) => (w ? `${n} is a company based in ${w}.` : `${n} is a company.`),
  friendly: (n, w) => (w ? `${n} is a team based in ${w}.` : `${n} is a team.`),
  bold: (n, w) => (w ? `${n}, based in ${w}, does things its own way.` : `${n} does things its own way.`),
  technical: (n, w) => (w ? `${n} is based in ${w}.` : `${n} is a company.`),
}

/** "a", "a and b", "a, b and c" */
export function list(items: string[]) {
  const xs = items.map((x) => x.trim()).filter(Boolean)
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`
}

// Free-text answers are quoted as sentences, not spliced into grammar we can't check.
const sentence = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  const capped = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

export function companyDescription(p: ProfileFacts, brief: Brief): { title: string; blocks: Section[] } {
  const voice = p.brandVoice ?? 'professional'
  const reach = p.serviceArea ? ` and works ${REACH[p.serviceArea]}` : ''
  const opening = OPENING[voice](p.name, p.location).replace(/\.$/, `${reach}.`)
  const serves = p.customers.length ? `It serves ${list(p.customers.map((c) => c.toLowerCase()))}.` : ''
  const offers = p.offerings.length ? `What it offers: ${list(p.offerings)}.` : ''
  const different = p.differentiators.map(sentence).join(' ')

  const paragraphs =
    brief.length === 'short'
      ? [[opening, sentence(p.purpose ?? ''), CLOSING[brief.audience](p.name)]]
      : brief.length === 'medium'
        ? [[opening, sentence(p.purpose ?? ''), serves], [offers, different, CLOSING[brief.audience](p.name)]]
        : [[opening, sentence(p.purpose ?? '')], [serves, offers], [different ? `What makes ${p.name} different: ${different}` : ''], [CLOSING[brief.audience](p.name)]]

  const body = paragraphs.map((parts) => parts.filter(Boolean).join(' ')).filter(Boolean)
  return {
    title: `${p.name.slice(0, 160)} — Company Description`,
    blocks: [
      { id: 'title', type: 'section', level: 'h1', text: p.name },
      ...body.map((text, i) => ({ id: `p${i + 1}`, type: 'section' as const, level: 'body' as const, text })),
    ],
  }
}
