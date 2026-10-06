// The two structured calls a workflow may make (doc/12 §7). Strict JSON-schema output,
// validated and clipped on return — never trust the model's shape. Providers are
// swappable; tests use a fake (setAssistantProvider).
import { assistantConfig, type AssistantConfig } from './config'

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
}
export type Draft = { title: string; paragraphs: string[] }
export type Usage = { promptTokens: number; completionTokens: number }

export interface AssistantProvider {
  readonly name: string
  readonly model: string | null
  extract(input: ExtractInput, signal: AbortSignal): Promise<{ facts: Facts; usage?: Usage }>
  draft(input: DraftInput, signal: AbortSignal): Promise<{ patch: Facts; document: Draft; usage?: Usage }>
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
].join(' ')

const DRAFT_SYSTEM = [
  'You write a company description for the business described in `profile` and `answers`.',
  'Use only those facts; do not invent clients, numbers, awards or claims. Write for the given audience, in the given voice',
  '(professional, friendly, bold or technical; default professional). Length: short = 1 paragraph, medium = 2, detailed = 3–4.',
  'No headings or bullet points inside paragraphs. Title: "<company name> — Company Description".',
  'Also return profilePatch: the same facts, tidied into clean short values (e.g. a long answer about services → a list of services).',
  'Use null / [] in profilePatch for anything you would not change.',
].join(' ')

export class OpenAIAssistant implements AssistantProvider {
  readonly name = 'openai'
  constructor(private readonly cfg: AssistantConfig = assistantConfig()) {}
  get model() { return this.cfg.model }

  async extract(input: ExtractInput, signal: AbortSignal) {
    const { json, usage } = await this.complete(EXTRACT_SYSTEM, input, 'company_facts', FACTS_SCHEMA, signal)
    return { facts: validateFacts(json), usage }
  }

  async draft(input: DraftInput, signal: AbortSignal) {
    const schema = {
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
    const { json, usage } = await this.complete(DRAFT_SYSTEM, input, 'company_document', schema, signal)
    const document = validateDraft(json?.document)
    if (!document) throw new Error('invalid draft')
    return { patch: validateFacts(json?.profilePatch), document, usage }
  }

  private async complete(system: string, input: unknown, name: string, schema: object, signal: AbortSignal) {
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      }),
    })
    if (!res.ok) throw new Error(`openai ${res.status}`)
    const body: any = await res.json()
    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('openai: no content')
    const usage = body?.usage ? { promptTokens: Number(body.usage.prompt_tokens) || 0, completionTokens: Number(body.usage.completion_tokens) || 0 } : undefined
    return { json: JSON.parse(content), usage }
  }
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
