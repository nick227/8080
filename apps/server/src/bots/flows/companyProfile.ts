// The company-profile workflow, AI off (doc/12 §6, Slice B). The server owns the
// order of questions; a choice or a typed answer moves the run one step, inside a
// transaction that holds the run's row lock. Every answer is stored as given
// (WorkflowAnswer). When the interview is complete, the answers become one profile
// revision, a template Company Description is created as a native block document,
// linked to the channel, and the bot posts the link.
import { db, type Prisma, type WorkflowStatus } from '@project/db'
import { conflict } from '../../lib/errors'
import { authorize } from '../../services/workspacePolicy'
import { CompanyProfileService, type ProfileUpdate } from '../../services/CompanyProfileService'
import { DocumentService } from '../../services/DocumentService'
import { DocumentContentService } from '../../services/DocumentContentService'
import { companyDescription, list, type Audience, type Length, type ServiceArea, type Voice } from './companyDescription'
import type { ChoiceFlow, FlowSay } from './registry'

type Tx = Prisma.TransactionClient

export const COMPANY_PROFILE = 'company-profile'
const VERSION = 1

export type Draft = {
  name?: string
  serviceArea?: ServiceArea
  location?: string
  purpose?: string
  offerings?: string[]
  customers?: string[]
  differentiators?: string[]
  brandVoice?: Voice
  audience?: Audience
  length?: Length
}
type Field = keyof Draft
export type RunState = { draft: Draft; sources: Partial<Record<Field, string>>; documentId?: string; error?: string }

type Option = { id: string; label: string }
type ChoiceStep = { id: string; kind: 'choice'; field: Field; mode?: 'one' | 'many'; options: Option[]; ask: (d: Draft) => string; value: (ids: string[]) => Draft[Field] }
type TextStep = { id: string; kind: 'text'; field: Field; max: number; ask: (d: Draft) => string; value: (text: string) => Draft[Field] }
type Step = ChoiceStep | TextStep

const options = (pairs: [string, string][]): Option[] => pairs.map(([id, label]) => ({ id, label }))
const AREAS = options([['local', 'Local'], ['regional', 'Regional'], ['national', 'National'], ['global', 'Global']])
const CUSTOMERS = options([['consumers', 'Consumers'], ['businesses', 'Businesses'], ['government', 'Government'], ['nonprofits', 'Nonprofits']])
const VOICES = options([['professional', 'Professional'], ['friendly', 'Friendly'], ['bold', 'Bold'], ['technical', 'Technical']])
const AUDIENCES = options([['customers', 'Customers'], ['prospects', 'Prospects'], ['partners', 'Partners'], ['investors', 'Investors'], ['general', 'General public']])
const LENGTHS = options([['short', 'Short'], ['medium', 'Medium'], ['detailed', 'Detailed']])
const START = options([['setup', 'Set up company profile'], ['later', 'Later']])

const labels = (opts: Option[], ids: string[]) => opts.filter((o) => ids.includes(o.id)).map((o) => o.label)
const tidy = (text: string) => text.trim().replace(/\s+/g, ' ')
/** "Web design, SEO; hosting" → three offerings. Only explicit separators split. */
export const splitList = (text: string) => text.split(/[,;\n]/).map(tidy).filter(Boolean).slice(0, 12)
const called = (d: Draft) => d.name ?? 'your company'

// The fixed interview. A step whose field is already known (from the stored profile)
// is skipped, so a later run only asks what is missing; the brief is always asked.
export const STEPS: Step[] = [
  { id: 'name', kind: 'text', field: 'name', max: 200, ask: () => "What's your company called?", value: tidy },
  { id: 'area', kind: 'choice', field: 'serviceArea', options: AREAS, ask: (d) => `Where does ${called(d)} work?`, value: (ids) => ids[0] as ServiceArea },
  { id: 'location', kind: 'text', field: 'location', max: 200, ask: () => 'Where are you based? A city, region or country is fine.', value: tidy },
  { id: 'purpose', kind: 'text', field: 'purpose', max: 1000, ask: (d) => `In a sentence, what does ${called(d)} do?`, value: tidy },
  { id: 'offerings', kind: 'text', field: 'offerings', max: 1000, ask: () => 'What are your main products or services? Separate them with commas.', value: splitList },
  { id: 'customers', kind: 'choice', field: 'customers', mode: 'many', options: CUSTOMERS, ask: (d) => `Who does ${called(d)} sell to? Pick all that apply.`, value: (ids) => labels(CUSTOMERS, ids) },
  { id: 'differentiator', kind: 'text', field: 'differentiators', max: 1000, ask: (d) => `What makes ${called(d)} different?`, value: (t) => [tidy(t)] },
  { id: 'tone', kind: 'choice', field: 'brandVoice', options: VOICES, ask: () => 'How should it sound?', value: (ids) => ids[0] as Voice },
  { id: 'audience', kind: 'choice', field: 'audience', options: AUDIENCES, ask: () => 'Who is this description for?', value: (ids) => ids[0] as Audience },
  { id: 'length', kind: 'choice', field: 'length', options: LENGTHS, ask: () => 'How long should it be?', value: (ids) => ids[0] as Length },
]
const STEP = new Map(STEPS.map((s) => [s.id, s]))

const known = (d: Draft, field: Field) => {
  const v = d[field]
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''
}
export const nextStep = (d: Draft) => STEPS.find((s) => !known(d, s.field)) ?? null

function ask(step: Step, d: Draft, userId: string): FlowSay {
  return step.kind === 'choice'
    ? { text: step.ask(d), offer: { step: step.id, mode: step.mode, options: step.options, forUserId: userId } }
    : { text: step.ask(d) }
}

/** The welcome the creator sees (doc/12 §3), opening the run's first step. */
export function startOffer(name: string, userId: string): FlowSay {
  return {
    text: `Welcome, ${name}. I'm chatbot, the host of this channel — what I do here, everyone in the workspace can see. I can write a company description for you from a few quick questions. Want to set up the company profile?`,
    offer: { step: 'start', options: START, forUserId: userId },
  }
}

// ─── runs ─────────────────────────────────────────────────────────────────────

const OPEN: WorkflowStatus[] = ['waiting', 'paused', 'working', 'failed']
type LockedRun = { id: string; workspaceId: string; memberId: string; userId: string; roomId: string; stepId: string; status: WorkflowStatus; state: RunState }

// A locking read returns the latest committed row whatever snapshot the transaction
// already holds (ChoiceService reads before calling us), so the step check is exact.
async function lockRun(tx: Tx, roomId: string, userId: string): Promise<LockedRun | null> {
  const rows = await tx.$queryRaw<(Omit<LockedRun, 'state'> & { state: unknown })[]>`
    SELECT id, workspaceId, memberId, userId, roomId, stepId, status, state FROM WorkflowRun
    WHERE workflowKey = ${COMPANY_PROFILE} AND roomId = ${roomId} AND userId = ${userId} AND status IN ('waiting', 'paused', 'working', 'failed')
    ORDER BY createdAt DESC LIMIT 1 FOR UPDATE`
  const row = rows[0]
  if (!row) return null
  return { ...row, state: (typeof row.state === 'string' ? JSON.parse(row.state) : row.state) as RunState }
}

const profiles = new CompanyProfileService()

/** Starts the creator's run, its draft pre-filled from what the profile already knows. */
export async function startRun(input: { workspaceId: string; memberId: string; userId: string; roomId: string }) {
  const p = await profiles.current(input.workspaceId)
  const facts = (kind: string) => p.facts.filter((f) => f.kind === kind).map((f) => f.value)
  const draft: Draft = {
    name: p.name ?? undefined,
    serviceArea: p.serviceArea ?? undefined,
    location: p.location ?? undefined,
    purpose: p.purpose ?? undefined,
    brandVoice: p.brandVoice ?? undefined,
    offerings: facts('offering'),
    customers: facts('customer'),
    differentiators: facts('differentiator'),
  }
  const state: RunState = { draft, sources: {} }
  return db.workflowRun.create({ data: { ...input, workflowKey: COMPANY_PROFILE, version: VERSION, stepId: 'start', status: 'waiting', state: state as Prisma.InputJsonValue } })
}

type Answer = { stepId: string; kind: 'choice'; optionIds: string[] } | { stepId: string; kind: 'text'; text: string; itemId: string }
type Advanced = { says: FlowSay[]; generate: boolean }

async function save(tx: Tx, run: LockedRun, stepId: string, status: WorkflowStatus, state: RunState) {
  await tx.workflowRun.update({ where: { id: run.id }, data: { stepId, status, state: state as unknown as Prisma.InputJsonValue } })
}

async function answer(tx: Tx, run: LockedRun, a: Answer): Promise<Advanced> {
  if (run.stepId !== a.stepId) throw conflict('That question was already answered', 'STEP_CLOSED')
  const record = await tx.workflowAnswer.create({
    data: { runId: run.id, stepId: a.stepId, kind: a.kind, ...(a.kind === 'choice' ? { optionIds: a.optionIds } : { itemId: a.itemId, raw: a.text }) },
  })
  const state: RunState = { ...run.state, draft: { ...run.state.draft }, sources: { ...run.state.sources } }

  if (a.stepId === 'start' || a.stepId === 'retry') {
    if (a.kind !== 'choice') throw conflict('That question takes a button', 'STEP_CLOSED')
    if (a.stepId === 'retry') {
      await save(tx, run, 'generate', 'working', state)
      return { says: [{ text: 'Trying again.' }], generate: true }
    }
    if (a.optionIds[0] === 'later') {
      await save(tx, run, 'start', 'paused', state)
      return { says: [{ text: "No problem. Whenever you're ready:", offer: { step: 'start', options: START.slice(0, 1), forUserId: run.userId } }], generate: false }
    }
  } else {
    const step = STEP.get(a.stepId)
    if (!step || step.kind !== a.kind || run.status !== 'waiting') throw conflict('That question was already answered', 'STEP_CLOSED')
    const value = a.kind === 'choice' ? (step as ChoiceStep).value(a.optionIds) : (step as TextStep).value(a.text)
    ;(state.draft as Record<string, unknown>)[step.field] = value
    state.sources[step.field] = record.id
  }

  const next = nextStep(state.draft)
  if (next) {
    await save(tx, run, next.id, 'waiting', state)
    return { says: [ask(next, state.draft, run.userId)], generate: false }
  }
  await save(tx, run, 'generate', 'working', state)
  return { says: [{ text: 'Thanks — writing your company description now.' }], generate: true }
}

// ─── generation (AI off: the template) ────────────────────────────────────────

const documents = new DocumentService()
const contents = new DocumentContentService()

const learned = (d: Draft) =>
  list([
    'your name',
    'where you work',
    'what you do',
    d.offerings?.length ? `${d.offerings.length} ${d.offerings.length === 1 ? 'offering' : 'offerings'}` : '',
    d.customers?.length ? 'who you sell to' : '',
    d.differentiators?.length ? 'what makes you different' : '',
    d.brandVoice ? `a ${d.brandVoice} voice` : '',
  ].filter(Boolean))

/** Runs the post-interview work once (the claim is atomic) and says how it went. */
export async function generate(roomId: string, userId: string): Promise<FlowSay[]> {
  const run = await db.workflowRun.findFirst({ where: { workflowKey: COMPANY_PROFILE, roomId, userId, status: 'working', stepId: 'generate' }, orderBy: { createdAt: 'desc' } })
  if (!run) return []
  const claimed = await db.workflowRun.updateMany({ where: { id: run.id, status: 'working', stepId: 'generate' }, data: { stepId: 'generating' } })
  if (claimed.count === 0) return []
  const state = run.state as unknown as RunState
  const d = state.draft
  try {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } })
    const ctx = { user, origin: 'assistant' as const }
    const update: ProfileUpdate = {
      name: d.name, location: d.location, serviceArea: d.serviceArea, purpose: d.purpose, brandVoice: d.brandVoice,
      offerings: d.offerings, customers: d.customers, differentiators: d.differentiators,
      sources: state.sources as ProfileUpdate['sources'], runId: run.id,
    }
    const { revision } = await profiles.apply(ctx, run.workspaceId, update, `wf:${run.id}:profile`)
    const brief = { audience: d.audience ?? 'general', length: d.length ?? 'medium' }
    const { title, blocks } = companyDescription(
      { name: d.name!, location: d.location!, serviceArea: d.serviceArea ?? null, purpose: d.purpose!, brandVoice: d.brandVoice ?? null, offerings: d.offerings ?? [], customers: d.customers ?? [], differentiators: d.differentiators ?? [] },
      brief,
    )
    const doc = await documents.create(
      ctx, run.workspaceId,
      { title, descriptor: { surface: 'blocks', source: { kind: 'native', schemaVersion: 1 } }, idempotencyKey: `wf:${run.id}:doc` },
      undefined,
      // Generated from the workspace's profile by a workspace workflow, so it belongs to
      // the workspace's audience from the start — the link below is only posted once
      // that is in place (doc/12 §5.4). Owners and admins can narrow or broaden it.
      { provenance: { kind: 'chatbot_workflow', workflow: COMPANY_PROFILE, version: VERSION, runId: run.id, profileRevision: revision, generator: 'template', brief }, workspaceAccess: 'viewer' },
    )
    await contents.save(ctx, run.workspaceId, doc.id, { expectedVersion: 0, content: blocks }).catch((error) => {
      if ((error as { code?: string }).code !== 'DOCUMENT_CONTENT_CONFLICT') throw error // already written by an earlier try
    })
    await documents.roomLink(ctx, run.workspaceId, doc.id, roomId, false)
    await db.workflowRun.update({ where: { id: run.id }, data: { status: 'done', stepId: 'done', state: { ...state, documentId: doc.id } as unknown as Prisma.InputJsonValue } })
    return [{
      text: `I created ${doc.title} and saved what I learned to the company profile: ${learned(d)}. It's a template draft — edit it like any document.`,
      links: [{ type: 'document', id: doc.id, workspaceId: run.workspaceId, title: doc.title }],
    }]
  } catch (error) {
    console.error(`[flow] ${COMPANY_PROFILE}: generation failed`, error)
    await db.workflowRun.update({ where: { id: run.id }, data: { status: 'failed', stepId: 'retry', state: { ...state, error: error instanceof Error ? error.message : String(error) } as unknown as Prisma.InputJsonValue } })
    return [{ text: "I couldn't create the document just now.", offer: { step: 'retry', options: [{ id: 'retry', label: 'Try again' }], forUserId: userId } }]
  }
}

// ─── entry points ─────────────────────────────────────────────────────────────

/** Button answers. Only the run's person, and only while they may edit the profile. */
export const companyProfileFlow: ChoiceFlow = {
  async canChoose({ roomId, userId }) {
    const run = await db.workflowRun.findFirst({ where: { workflowKey: COMPANY_PROFILE, roomId, userId, status: { in: OPEN } } })
    if (!run) return false
    return authorize(userId, run.workspaceId, 'companyProfile.edit').then(() => true, () => false)
  },
  async advance(tx, ctx) {
    const run = await lockRun(tx, ctx.roomId, ctx.userId)
    if (!run) throw conflict('That question was already answered', 'STEP_CLOSED')
    return (await answer(tx, run, { stepId: ctx.step, kind: 'choice', optionIds: ctx.optionIds })).says
  },
  afterCommit: (ctx) => generate(ctx.roomId, ctx.userId),
}

/** A typed message in the channel. Consumed only when that person's run is waiting
 *  on a text question; anything else is ordinary chat. */
export async function textAnswer(item: { roomId: string; itemId: string; actorId: string; text: string | null; hasMedia: boolean }): Promise<Advanced | null> {
  return db.$transaction(async (tx) => {
    const run = await lockRun(tx, item.roomId, item.actorId)
    if (!run || run.status !== 'waiting') return null
    const step = STEP.get(run.stepId)
    if (!step || step.kind !== 'text') return null
    const text = item.text?.trim() ?? ''
    if (!text) return item.hasMedia ? { says: [{ text: 'For now, please type your answer.' }], generate: false } : null
    if (text.length > step.max) return { says: [{ text: `That's a bit long — can you keep it under ${step.max} characters?` }], generate: false }
    return answer(tx, run, { stepId: step.id, kind: 'text', text, itemId: item.itemId })
  })
}
