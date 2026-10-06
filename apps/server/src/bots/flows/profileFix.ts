// "Fix a fact" (doc/13 D1): a deterministic flow that turns a person's correction into
// a proposal card — the same Apply / Not now / Undo every later kind uses. Anyone in
// the workspace may propose; applying stays with owners and admins (the kind's rule).
//   [Fix a fact] or typing "fix a fact" → which fact? (buttons)
//   → the new value: buttons where the options are fixed, otherwise a typed line
//   → a proposal posted in the channel.
import { db, type Prisma } from '@project/db'
import { authorize } from '../../services/workspacePolicy'
import { CompanyProfileService } from '../../services/CompanyProfileService'
import { proposals } from '../../services/ProposalService'
import { COMPANY_PROFILE_FACT, FIELD_LABELS, type FactChange } from '../../services/proposalKinds'
import { splitList } from './companyProfile'
import type { ChoiceFlow, FlowSay } from './registry'

export const PROFILE_FIX = 'profile-fix'
type Field = FactChange['field']

const options = (pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }))
const CHOICES: Partial<Record<Field, { mode?: 'one' | 'many'; options: { id: string; label: string }[]; value: (ids: string[], labels: string[]) => FactChange['value'] }>> = {
  serviceArea: { options: options([['local', 'Local'], ['regional', 'Regional'], ['national', 'National'], ['global', 'Global']]), value: (ids) => ids[0]! },
  brandVoice: { options: options([['professional', 'Professional'], ['friendly', 'Friendly'], ['bold', 'Bold'], ['technical', 'Technical']]), value: (ids) => ids[0]! },
  customers: { mode: 'many', options: options([['consumers', 'Consumers'], ['businesses', 'Businesses'], ['government', 'Government'], ['nonprofits', 'Nonprofits']]), value: (_ids, labels) => labels },
}
const LIST_FIELDS: Field[] = ['offerings', 'customers', 'differentiators']
const profiles = new CompanyProfileService()

export const FIX_WORDS = /^\s*fix (a |the )?(fact|profile)\s*[.!]?\s*$/i

// Option ids are slugs (lib/choice.ts): serviceArea ↔ service-area.
const slug = (field: string) => field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const fieldOf = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as Field

export function whichFact(userId: string): FlowSay {
  return {
    text: 'Which fact should change?',
    offer: { step: 'field', options: Object.entries(FIELD_LABELS).map(([field, label]) => ({ id: slug(field), label })), forUserId: userId },
  }
}

async function workspaceOf(roomId: string) {
  return (await db.workspaceChannel.findUnique({ where: { roomId } }))?.workspaceId ?? null
}

async function askValue(tx: Prisma.TransactionClient, ws: string, roomId: string, userId: string, field: Field): Promise<FlowSay[]> {
  const p = await profiles.current(ws, tx)
  const listKind = { offerings: 'offering', customers: 'customer', differentiators: 'differentiator' }[field as string]
  const current = listKind ? p.facts.filter((f) => f.kind === listKind).map((f) => f.value).join(', ') : ((p as Record<string, unknown>)[field] as string | null)
  const says = current ? `${FIELD_LABELS[field]} says: ${current}.` : `${FIELD_LABELS[field]} is empty.`
  const choice = CHOICES[field]
  if (choice) return [{ text: `${says} What should it be?`, offer: { step: `value:${field}`, mode: choice.mode, options: choice.options, forUserId: userId } }]
  // A typed answer: one waiting run per person (a newer fix replaces an older one).
  const member = await tx.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: ws, userId } }, select: { id: true } })
  await tx.workflowRun.updateMany({ where: { workflowKey: PROFILE_FIX, roomId, userId, status: 'waiting' }, data: { status: 'done' } })
  await tx.workflowRun.create({ data: { workspaceId: ws, memberId: member.id, userId, roomId, workflowKey: PROFILE_FIX, version: 1, stepId: 'value', status: 'waiting', state: { field } } })
  return [{ text: `${says} What should it say?${LIST_FIELDS.includes(field) ? ' Separate items with commas.' : ''}` }]
}

/** Creates the proposal (its card is the reply). Problems are said plainly. */
async function proposeFix(roomId: string, userId: string, change: FactChange): Promise<FlowSay[]> {
  const ws = await workspaceOf(roomId)
  if (!ws) return []
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } })
  try {
    await proposals.propose({ user, origin: 'assistant' }, ws, { kind: COMPANY_PROFILE_FACT, targetId: ws, change })
    return []
  } catch (error) {
    const e = error as { code?: string; message?: string }
    if (e.code === 'NO_CHANGE') return [{ text: "That's what it already says." }]
    if (e.code === 'INVALID_VALUE') return [{ text: `${e.message}.` }]
    throw error
  }
}

export const profileFixFlow: ChoiceFlow = {
  async canChoose({ roomId, userId }) {
    const ws = await workspaceOf(roomId)
    return !!ws && authorize(userId, ws, 'companyProfile.read').then(() => true, () => false)
  },
  async advance(tx, ctx) {
    if (ctx.step === 'fix') return [whichFact(ctx.userId)]
    if (ctx.step === 'field') {
      const ws = await workspaceOf(ctx.roomId)
      const field = fieldOf(ctx.optionIds[0]!)
      return ws && field in FIELD_LABELS ? askValue(tx, ws, ctx.roomId, ctx.userId, field) : []
    }
    return [] // value:<field> — proposed after the answer commits
  },
  async afterCommit(ctx) {
    if (!ctx.step.startsWith('value:')) return []
    const field = ctx.step.slice('value:'.length) as Field
    const choice = CHOICES[field]
    if (!choice) return []
    const labels = choice.options.filter((o) => ctx.optionIds.includes(o.id)).map((o) => o.label)
    return proposeFix(ctx.roomId, ctx.userId, { field, value: choice.value(ctx.optionIds, labels) })
  },
}

/** A typed line in the channel: the value a waiting fix asked for, or "fix a fact". */
export async function profileFixText(item: { roomId: string; itemId: string; actorId: string; text: string | null }): Promise<FlowSay[] | null> {
  const text = item.text?.trim() ?? ''
  const field = await db.$transaction(async (tx) => {
    const [run] = await tx.$queryRaw<{ id: string; state: unknown }[]>`
      SELECT id, state FROM WorkflowRun WHERE workflowKey = ${PROFILE_FIX} AND roomId = ${item.roomId} AND userId = ${item.actorId} AND status = 'waiting'
      ORDER BY createdAt DESC LIMIT 1 FOR UPDATE`
    if (!run || !text) return null
    const state = (typeof run.state === 'string' ? JSON.parse(run.state) : run.state) as { field: Field }
    await tx.workflowAnswer.create({ data: { runId: run.id, stepId: 'value', kind: 'text', itemId: item.itemId, raw: text } })
    await tx.workflowRun.update({ where: { id: run.id }, data: { status: 'done', stepId: 'done' } })
    return state.field
  })
  if (field) return proposeFix(item.roomId, item.actorId, { field, value: LIST_FIELDS.includes(field) ? splitList(text) : text })
  if (!FIX_WORDS.test(text)) return null
  const ws = await workspaceOf(item.roomId)
  const allowed = ws && (await authorize(item.actorId, ws, 'companyProfile.read').then(() => true, () => false))
  return allowed ? [whichFact(item.actorId)] : null
}
