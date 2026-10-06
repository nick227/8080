// The two structured calls a workflow may make (doc/12 §7). Strict JSON-schema output,
// validated and clipped on return — never trust the model's shape. Providers are
// swappable; tests use a fake (setAssistantProvider).
import { assistantConfig, type AssistantConfig } from './config'
import { WRITING_RULES } from './style'
import { JOBS, type Job } from './budget'

export const AREAS = ['local', 'regional', 'national', 'global'] as const
export const VOICES = ['professional', 'friendly', 'bold', 'technical'] as const

/** Company facts as the model reads or proposes them. null / [] = unknown. */
export type Facts = {
  name: string | null
  location: string | null
  serviceArea: (typeof AREAS)[number] | null
  purpose: string | null
  brandVoice: (typeof VOICES)[number] | null
  offerings: string[]
  customers: string[]
  differentiators: string[]
}
export type ExtractInput = { text: string; known: Facts }
export type DraftInput = {
  documentType: 'company-description'
  profile: Facts
  /** The person's own words, question by question. */
  answers: { question: string; answer: string }[]
  brief: { audience: string; length: 'short' | 'medium' | 'detailed'; voice: string | null }
  /** A second pass: rewrite `previous`, fixing exactly these problems. */
  revise?: { previous: Draft; problems: string[] }
}
export type Draft = { title: string; paragraphs: string[] }

/** What a business note says (doc/13 §10). Every value must be grounded in the note
 *  (see grounding.ts); the model's guesses never reach a record. */
export type NoteReading = {
  person: { firstName: string | null; lastName: string | null; title: string | null; email: string | null; phone: string | null }
  company: { name: string | null; domain: string | null }
  followUp: { date: string | null; quote: string | null }
  facts: { key: 'need' | 'timing' | 'budget' | 'other'; value: string; quote: string }[]
}
export type NoteInput = { note: string; today: string; weekday: string }

/** One piece of evidence the brief may cite (doc/13 D3). `when` is a plain date. */
export type Evidence = { id: string; kind: 'contact' | 'account' | 'note' | 'activity' | 'message' | 'document'; when: string | null; title: string; text: string }
export type Claim = { text: string; evidence: string[] }
/** A structured brief: facts cite evidence; nextStep is labelled inference. */
export type Brief = {
  summary: Claim[]
  need: Claim[]
  recent: Claim[]
  commitments: Claim[]
  openQuestions: Claim[]
  nextStep: { text: string; basis: string[] } | null
}
export type BriefInput = { contact: string; today: string; evidence: Evidence[] }
export type Usage = { promptTokens: number; completionTokens: number }
/** A spreadsheet request read into the whitelisted sheet query (doc/13 §12, A1).
 *  `query` is raw: the caller validates it like any other input. */
export type SheetPlanInput = { request: string; today: string; weekday: string; categories: string[] }
export type SheetPlan = { supported: boolean; reason: string | null; title: string | null; query: Record<string, unknown> | null }

export interface AssistantProvider {
  readonly name: string
  readonly model: string | null
  extract(input: ExtractInput, signal: AbortSignal): Promise<{ facts: Facts; usage?: Usage }>
  draft(input: DraftInput, signal: AbortSignal): Promise<{ patch: Facts; document: Draft; usage?: Usage }>
  readNote?(input: NoteInput, signal: AbortSignal): Promise<{ reading: NoteReading; usage?: Usage }>
  brief?(input: BriefInput, signal: AbortSignal): Promise<{ brief: Brief; usage?: Usage }>
  planSheet?(input: SheetPlanInput, signal: AbortSignal): Promise<{ plan: SheetPlan; usage?: Usage }>
}

// ─── validation ───────────────────────────────────────────────────────────────

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null)
const list = (v: unknown, max = 12) => {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of v) {
    const t = text(item, 500)
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t) }
  }
  return out.slice(0, max)
}
const oneOf = <T extends readonly string[]>(v: unknown, options: T) => (options.includes(v as string) ? (v as T[number]) : null)

export function validateFacts(raw: any): Facts {
  return {
    name: text(raw?.name, 200),
    location: text(raw?.location, 200),
    serviceArea: oneOf(raw?.serviceArea, AREAS),
    purpose: text(raw?.purpose, 1000),
    brandVoice: oneOf(raw?.brandVoice, VOICES),
    offerings: list(raw?.offerings),
    customers: list(raw?.customers),
    differentiators: list(raw?.differentiators, 6),
  }
}

/** A usable draft or null: a title and 1–8 non-empty paragraphs, clipped. */
export function validateDraft(raw: any): Draft | null {
  const title = text(raw?.title, 160)
  const paragraphs = Array.isArray(raw?.paragraphs) ? raw.paragraphs.map((p: unknown) => (typeof p === 'string' ? p.trim().slice(0, 2000) : '')).filter(Boolean).slice(0, 8) : []
  return title && paragraphs.length ? { title, paragraphs } : null
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

const str = { type: ['string', 'null'] }
const strs = { type: 'array', items: { type: 'string' } }
const FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'location', 'serviceArea', 'purpose', 'brandVoice', 'offerings', 'customers', 'differentiators'],
  properties: {
    name: str, location: str, purpose: str,
    serviceArea: { type: ['string', 'null'], enum: [...AREAS, null] },
    brandVoice: { type: ['string', 'null'], enum: [...VOICES, null] },
    offerings: strs, customers: strs, differentiators: strs,
  },
}

const EXTRACT_SYSTEM = [
  'You read a business owner\'s own description of their company and return structured facts.',
  'Only include what they stated or clearly implied; use null or an empty list for anything else — never guess.',
  'Keep their wording where you can; tidy grammar only. name = the company name. location = where they are based.',
  'serviceArea = local | regional | national | global, only if implied. purpose = one plain sentence of what the company does.',
  'offerings = products or services, short items. customers = who they sell to, short items. differentiators = what makes them different.',
  'brandVoice only if they say how they want to sound. `known` holds facts already on file; do not repeat them unless the text changes them.',
  'Tidy values into plain words; never add marketing language or claims they did not make.',
].join(' ')

const NOTE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['person', 'company', 'followUp', 'facts'],
  properties: {
    person: { type: 'object', additionalProperties: false, required: ['firstName', 'lastName', 'title', 'email', 'phone'], properties: { firstName: str, lastName: str, title: str, email: str, phone: str } },
    company: { type: 'object', additionalProperties: false, required: ['name', 'domain'], properties: { name: str, domain: str } },
    followUp: { type: 'object', additionalProperties: false, required: ['date', 'quote'], properties: { date: str, quote: str } },
    facts: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['key', 'value', 'quote'], properties: { key: { type: 'string', enum: ['need', 'timing', 'budget', 'other'] }, value: { type: 'string' }, quote: { type: 'string' } } },
    },
  },
}

const NOTE_SYSTEM = [
  'You read one note a person wrote about a business contact and return only what it states.',
  'person = the one contact the note is about (first and last name exactly as written, title, email, phone — null if not written).',
  'company = the organisation they belong to, exactly as written; domain only if written.',
  'followUp = a next contact the note asks for: date as YYYY-MM-DD resolved against `today` (and `weekday`), and quote = the exact words, e.g. "call Friday". null if none.',
  'facts = what they want (need), when (timing), how much (budget), or other concrete business facts; value = a short plain restatement, quote = the exact words from the note.',
  'Copy quotes character for character from the note. Do not guess: no lead status, qualification, industry, probability or anything not written. Use null and [] freely.',
].join(' ')

const CLAIMS = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'evidence'], properties: { text: { type: 'string' }, evidence: strs } } }
const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'need', 'recent', 'commitments', 'openQuestions', 'nextStep'],
  properties: {
    summary: CLAIMS, need: CLAIMS, recent: CLAIMS, commitments: CLAIMS, openQuestions: CLAIMS,
    nextStep: { type: ['object', 'null'], additionalProperties: false, required: ['text', 'basis'], properties: { text: { type: 'string' }, basis: strs } },
  },
}

const BRIEF_SYSTEM = [
  'You brief a salesperson before they contact someone, using only the `evidence` list (each item has an id).',
  'Return short items, each citing the ids it rests on in `evidence`. A claim without evidence will be discarded.',
  'summary = who they are and their company (1–2 items). need = what they want or asked for. recent = what has happened, with dates from the evidence.',
  'commitments = what either side promised or agreed to do. openQuestions = information that is missing and matters (e.g. no email, budget unclear) — cite the evidence that shows the gap.',
  'nextStep = one suggested next action. It is your recommendation, not a fact; still give the ids it is based on in `basis`. null if nothing sensible.',
  'Never state a name, number, amount or date that is not in the evidence you cite. Empty lists are fine. Prefer fewer, more useful items.',
  '',
  WRITING_RULES,
].join('\n')

const nul = <T>(schema: T) => ({ anyOf: [schema, { type: 'null' }] })
const CONTACT_COLS = ['name', 'company', 'title', 'email', 'phone', 'leadStatus', 'leadSource', 'nextFollowUp', 'lastActivity', 'owner', 'created']
const INVENTORY_COLS = ['name', 'sku', 'category', 'price', 'quantity', 'lowStockThreshold', 'stockValue', 'location', 'available', 'status', 'updated']
const SHEET_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['supported', 'reason', 'title', 'query'],
  properties: {
    supported: { type: 'boolean' }, reason: str, title: str,
    query: nul({
      type: 'object', additionalProperties: false, required: ['source', 'columns', 'groupBy', 'contactFilters', 'inventoryFilters', 'sort', 'limit'],
      properties: {
        source: { type: 'string', enum: ['contacts', 'inventory'] },
        columns: { type: 'array', items: { type: 'string', enum: [...new Set([...CONTACT_COLS, ...INVENTORY_COLS])] } },
        groupBy: nul({ type: 'string', enum: ['leadStatus', 'leadSource', 'owner', 'category'] }),
        contactFilters: nul({
          type: 'object', additionalProperties: false, required: ['leadStatus', 'followUpFrom', 'followUpTo', 'noFollowUp', 'quietSince', 'q'],
          properties: { leadStatus: nul({ type: 'array', items: { type: 'string', enum: ['new', 'contacting', 'connected', 'qualified', 'customer', 'lost'] } }), followUpFrom: str, followUpTo: str, noFollowUp: nul({ type: 'boolean' }), quietSince: str, q: str },
        }),
        inventoryFilters: nul({
          type: 'object', additionalProperties: false, required: ['q', 'category', 'stock', 'available', 'priceMin', 'priceMax', 'includeArchived'],
          properties: { q: str, category: str, stock: nul({ type: 'string', enum: ['low', 'out', 'low-or-out'] }), available: nul({ type: 'boolean' }), priceMin: nul({ type: 'number' }), priceMax: nul({ type: 'number' }), includeArchived: nul({ type: 'boolean' }) },
        }),
        sort: nul({ type: 'object', additionalProperties: false, required: ['field', 'direction'], properties: { field: { type: 'string', enum: ['name', 'nextFollowUp', 'lastActivity', 'created', 'price', 'quantity', 'stockValue', 'updated'] }, direction: { type: 'string', enum: ['asc', 'desc'] } } }),
        limit: nul({ type: 'integer' }),
      },
    }),
  },
}
const SHEET_SYSTEM = [
  'Turn a spreadsheet request into a query over Contacts or Inventory (the schema lists the fields). You never see the data; code runs the query.',
  'Contacts: "open leads" = new, contacting, connected, qualified; followUpFrom/To = next follow-up, inclusive days; noFollowUp = none set; quietSince = no activity since that day; q = name contains; group by leadStatus, leadSource or owner for counts.',
  'Inventory: stockValue = price × quantity; category must be one of `categories`; stock low | out | low-or-out; group by category for totals.',
  'Dates are YYYY-MM-DD from `today` and `weekday`; "this week" ends Sunday. limit only for "top N". Grouped: columns [] and sort null. Listing: the 3–7 columns that answer it. Fill only the chosen source\'s filters.',
  'Needs other data (deals, revenue, orders, emails, tasks) or not a sheet request: supported false, query null, reason = one plain sentence. title = a short plain name.',
].join(' ')

const DRAFT_SYSTEM = [
  'You write a company description for the business in `profile` and `answers`, for the audience and voice in `brief`.',
  'Use only those facts. The person\'s own words in `answers` are the best source of concrete detail: use their real examples.',
  'Before writing, decide what a reader in this audience most needs to know about this company, and lead with that.',
  'Output: a title "<company name> — Company Description" and plain paragraphs (no headings, lists or bullet points).',
  '',
  WRITING_RULES,
  '',
  'Also return profilePatch: the same facts, tidied into clean short values (e.g. a long answer about services → a list of',
  'services), in the same plain words. Use null / [] for anything you would not change.',
  '',
  'If `revise` is present: rewrite `revise.previous`, fixing exactly the listed problems and changing nothing else.',
].join('\n')

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['profilePatch', 'document'],
  properties: {
    profilePatch: FACTS_SCHEMA,
    document: {
      type: 'object', additionalProperties: false, required: ['title', 'paragraphs'],
      properties: { title: { type: 'string' }, paragraphs: strs },
    },
  },
}

/** Each job's fixed prompt: system text, schema name and output schema. */
const PROMPTS: Record<Job, { system: string; name: string; schema: object }> = {
  'company.extract': { system: EXTRACT_SYSTEM, name: 'company_facts', schema: FACTS_SCHEMA },
  'company.draft': { system: DRAFT_SYSTEM, name: 'company_document', schema: DRAFT_SCHEMA },
  'note.read': { system: NOTE_SYSTEM, name: 'note_reading', schema: NOTE_SCHEMA },
  'contact.brief': { system: BRIEF_SYSTEM, name: 'contact_brief', schema: BRIEF_SCHEMA },
  'sheet.plan': { system: SHEET_SYSTEM, name: 'sheet_query', schema: SHEET_SCHEMA },
}
/** The fixed part of each job's input (system prompt + schema), counted in its budget. */
export const PROMPT_CHARS = Object.fromEntries(Object.entries(PROMPTS).map(([job, p]) => [job, p.system.length + JSON.stringify(p.schema).length])) as Record<Job, number>

export class OpenAIAssistant implements AssistantProvider {
  readonly name = 'openai'
  constructor(private readonly cfg: AssistantConfig = assistantConfig()) {}
  get model() { return this.cfg.model }

  async extract(input: ExtractInput, signal: AbortSignal) {
    const { json, usage } = await this.complete('company.extract', input, signal, 0)
    return { facts: validateFacts(json), usage }
  }

  async draft(input: DraftInput, signal: AbortSignal) {
    const { json, usage } = await this.complete('company.draft', input, signal, 0.3)
    const document = validateDraft(json?.document)
    if (!document) throw new Error('invalid draft')
    return { patch: validateFacts(json?.profilePatch), document, usage }
  }

  // Low temperature: the same facts should read the same way (extraction: none at all).
  async readNote(input: NoteInput, signal: AbortSignal) {
    const { json, usage } = await this.complete('note.read', input, signal, 0)
    return { reading: json as NoteReading, usage }
  }

  async brief(input: BriefInput, signal: AbortSignal) {
    const { json, usage } = await this.complete('contact.brief', input, signal, 0.2)
    return { brief: json as Brief, usage }
  }

  async planSheet(input: SheetPlanInput, signal: AbortSignal) {
    const { json, usage } = await this.complete('sheet.plan', input, signal, 0)
    return { plan: json as SheetPlan, usage }
  }

  private async complete(job: Job, input: unknown, signal: AbortSignal, temperature: number) {
    const { system, name, schema } = PROMPTS[job]
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        temperature,
        max_tokens: JOBS[job].outputTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      }),
    })
    if (!res.ok) throw new Error(`openai ${res.status}`)
    const body: any = await res.json()
    if (body?.choices?.[0]?.finish_reason === 'length') throw new Error(`output over budget (${JOBS[job].outputTokens} tokens)`)
    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('openai: no content')
    const usage = body?.usage ? { promptTokens: Number(body.usage.prompt_tokens) || 0, completionTokens: Number(body.usage.completion_tokens) || 0 } : undefined
    return { json: JSON.parse(content), usage }
  }
}

/** The model's nullable shape → the sheet query's optional one (nulls dropped). */
export function sheetFromModel(plan: any): SheetPlan | null {
  if (!plan || typeof plan !== 'object' || typeof plan.supported !== 'boolean') return null
  const reason = typeof plan.reason === 'string' && plan.reason.trim() ? plan.reason.trim().slice(0, 300) : null
  const title = typeof plan.title === 'string' && plan.title.trim() ? plan.title.trim().replace(/\s+/g, ' ').slice(0, 120) : null
  const q = plan.query
  if (!plan.supported || !q || typeof q !== 'object') return { supported: false, reason, title: null, query: null }
  const drop = (o: Record<string, unknown> | null | undefined) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) : {})
  const cf = drop(q.contactFilters)
  const filters = q.source === 'contacts'
    ? drop({ leadStatus: cf.leadStatus, followUp: cf.followUpFrom || cf.followUpTo ? drop({ from: cf.followUpFrom, to: cf.followUpTo }) : null, noFollowUp: cf.noFollowUp === true ? true : null, quietSince: cf.quietSince, q: cf.q })
    : drop({ ...drop(q.inventoryFilters), includeArchived: q.inventoryFilters?.includeArchived === true ? true : null })
  const grouped = q.groupBy !== null && q.groupBy !== undefined
  const query: Record<string, unknown> = {
    source: q.source,
    ...(grouped ? { groupBy: q.groupBy } : { columns: Array.isArray(q.columns) ? q.columns : [] }),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(!grouped && q.sort ? { sort: q.sort } : {}),
    ...(Number.isInteger(q.limit) ? { limit: q.limit } : {}),
  }
  return { supported: true, reason, title, query }
}

let override: AssistantProvider | null | undefined
/** Tests: swap the provider (null = none, undefined = back to config). */
export function setAssistantProvider(provider: AssistantProvider | null | undefined) {
  override = provider
}

/** The active provider, or null when the assistant is off or unconfigured. */
export function assistantProvider(): AssistantProvider | null {
  if (override !== undefined) return override // a fake, honoured under NODE_ENV=test
  const cfg = assistantConfig()
  if (!cfg.enabled || !cfg.apiKey || !cfg.model) return null
  return new OpenAIAssistant(cfg)
}
