// Minimum necessary context (doc/13 §13). Every AI call is one job of one class:
//
//   extract  small source text → facts          (a note, a person's answer)
//   plan     request + tiny schema → a plan      (a sheet query)
//   compose  curated evidence pack + brief → prose
//
// AI gets language and ambiguity; code keeps identity, state, math and execution.
// Each job declares the only input fields it may receive, how many source records,
// and hard input/output token ceilings. An input that breaks its contract — extra
// fields, too many records, too large, or anything that looks like one of our database
// ids — is refused before any call is made and logged like a failed call.
export type Job = 'company.extract' | 'company.draft' | 'note.read' | 'contact.brief' | 'sheet.plan'
export type JobClass = 'extract' | 'plan' | 'compose'

type Contract = {
  class: JobClass
  /** The input's top-level fields — nothing else may be sent. */
  fields: readonly string[]
  /** Source records sent, and their ceiling (e.g. evidence items). */
  records?: { count: (input: any) => number; max: number }
  /** Ceilings in tokens; input includes the system prompt and output schema. */
  inputTokens: number
  outputTokens: number
}

export const JOBS: Record<Job, Contract> = {
  'company.extract': { class: 'extract', fields: ['text', 'known'], inputTokens: 2000, outputTokens: 600 },
  'note.read': { class: 'extract', fields: ['note', 'today', 'weekday'], inputTokens: 2000, outputTokens: 500 },
  'sheet.plan': { class: 'plan', fields: ['request', 'today', 'weekday', 'categories'], records: { count: (i) => i.categories?.length ?? 0, max: 30 }, inputTokens: 1100, outputTokens: 300 },
  'contact.brief': { class: 'compose', fields: ['contact', 'today', 'evidence'], records: { count: (i) => i.evidence?.length ?? 0, max: 20 }, inputTokens: 6000, outputTokens: 1500 },
  'company.draft': { class: 'compose', fields: ['documentType', 'profile', 'answers', 'brief', 'revise'], records: { count: (i) => i.answers?.length ?? 0, max: 12 }, inputTokens: 5000, outputTokens: 2000 },
}

/** Rough and conservative for English and JSON: about four characters a token. */
export const estimateTokens = (chars: number) => Math.ceil(chars / 4)

// Our ids: Prisma cuids (c + 24) and UUIDs. Evidence uses aliases (E1, E2, …) instead.
const ID_PATTERNS = [/\bc[a-z0-9]{24}\b/, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i]
export const containsId = (text: string) => ID_PATTERNS.some((p) => p.test(text))

/** Why this input may not be sent for this job, or null if it may. */
export function contractViolation(job: Job, input: object, promptChars: number): string | null {
  const c = JOBS[job]
  const extra = Object.keys(input).filter((k) => !c.fields.includes(k))
  if (extra.length) return `fields not allowed for ${job}: ${extra.join(', ')}`
  const n = c.records?.count(input) ?? 0
  if (c.records && n > c.records.max) return `${n} records for ${job}; at most ${c.records.max}`
  const text = JSON.stringify(input)
  if (containsId(text)) return `database id in the input for ${job}`
  const tokens = estimateTokens(text.length + promptChars)
  if (tokens > c.inputTokens) return `about ${tokens} input tokens for ${job}; at most ${c.inputTokens}`
  return null
}
