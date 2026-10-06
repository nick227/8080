// "Add notes" (doc/13 §10, D2): a messy business note → one proposal card. The model
// only reads the note (grounded); matching, planning and every write are server code
// (services/crmNote.ts). A draft (WorkflowRun "crm-note") holds the note and its
// reading while a choice is pending, so resolving it never reads the note again.
//
//   channel: "note: Met Sarah Lee from Brightside Dental …"   API: POST …/crm/notes
//   → proposed (card posted) | ambiguous (choose the person / company) | needs-person
import { db, type Prisma } from '@project/db'
import { badRequest, notFound } from '../../lib/errors'
import { authorize } from '../../services/workspacePolicy'
import { proposals } from '../../services/ProposalService'
import { CRM_NOTE, NEW_CONTACT } from '../../services/proposalKinds'
import { planNote, readingFromName, type Candidate, type Choice } from '../../services/crmNote'
import type { WorkspaceCtx } from '../../services/WorkspaceService'
import { workspaceHost } from '../../services/WorkspaceHost'
import { assistantAvailable, readNote } from '../assistant/calls'
import type { Grounded } from '../assistant/grounding'
import type { ChoiceFlow, FlowSay } from './registry'

export const NOTE_FLOW = 'crm-note'
export const NOTE_PREFIX = /^\s*note\s*:\s*/i

type Draft = { text: string; reading: Grounded | null; choice: Choice; readCallId?: string | null }
export type NoteResult =
  | { status: 'proposed'; proposal: Awaited<ReturnType<typeof proposals.get>> }
  | { status: 'ambiguous'; draftId: string; contacts?: Candidate[]; accounts?: Candidate[] }
  | { status: 'needs-person'; draftId: string }

const WEEKDAY = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

async function saveDraft(ctx: WorkspaceCtx, workspaceId: string, draft: Draft, existingId: string | null, stepId: string) {
  const state = draft as unknown as Prisma.InputJsonValue
  if (existingId) return (await db.workflowRun.update({ where: { id: existingId }, data: { state, stepId, status: 'waiting' } })).id
  const member = await db.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } }, select: { id: true } })
  const { roomId } = await workspaceHost.ensureChannel(workspaceId)
  return (await db.workflowRun.create({ data: { workspaceId, memberId: member.id, userId: ctx.user.id, roomId, workflowKey: NOTE_FLOW, version: 1, stepId, status: 'waiting', state } })).id
}

/** One step of adding a note. Give `text` to start; give `draftId` with `about`,
 *  `contactId` or `accountId` to continue. */
export async function addNote(ctx: WorkspaceCtx, workspaceId: string, input: { text?: string; draftId?: string; about?: string; contactId?: string; accountId?: string }): Promise<NoteResult> {
  await authorize(ctx.user.id, workspaceId, 'record.write')
  let draftId: string | null = null
  let draft: Draft
  if (input.draftId) {
    const run = await db.workflowRun.findFirst({ where: { id: input.draftId, workspaceId, userId: ctx.user.id, workflowKey: NOTE_FLOW, status: 'waiting' } })
    if (!run) throw notFound('That note draft is gone')
    draftId = run.id
    draft = run.state as unknown as Draft
  } else {
    const text = input.text?.trim() ?? ''
    if (!text) throw badRequest('A note needs text', 'EMPTY_NOTE')
    let reading: Grounded | null = null
    let readCallId: string | null = null
    if (!input.about && (await assistantAvailable(workspaceId))) {
      const today = new Date()
      const read = await readNote({ workspaceId, runId: null }, { note: text, today: today.toISOString().slice(0, 10), weekday: WEEKDAY(today) })
      if (read) { reading = read.reading; readCallId = read.callId }
    }
    draft = { text, reading, choice: {}, readCallId }
  }
  if (input.about?.trim()) draft = { ...draft, reading: { ...(draft.reading ?? readingFromName('')), person: readingFromName(input.about).person } }
  if (input.contactId) draft = { ...draft, choice: { ...draft.choice, contactId: input.contactId } }
  if (input.accountId) draft = { ...draft, choice: { ...draft.choice, accountId: input.accountId as Choice['accountId'] } }

  const person = draft.reading?.person
  if (!person || (!person.firstName && !person.lastName && !person.email && !person.phone)) {
    // AI off (or it found no one): ask who it is — the deterministic baseline.
    return { status: 'needs-person', draftId: await saveDraft(ctx, workspaceId, draft, draftId, 'person') }
  }
  const planned = await planNote(workspaceId, draft.text, draft.reading, draft.choice)
  if ('ambiguous' in planned) {
    return { status: 'ambiguous', draftId: await saveDraft(ctx, workspaceId, draft, draftId, 'choose'), ...planned.ambiguous }
  }
  const plan = planned.plan
  const proposal = await proposals.propose(ctx, workspaceId, {
    kind: CRM_NOTE, targetId: 'id' in plan.contact ? plan.contact.id : NEW_CONTACT, change: plan,
    evidence: { source: 'note', readCallId: draft.readCallId ?? null, dropped: draft.reading?.dropped ?? [] },
  })
  if (draftId) await db.workflowRun.update({ where: { id: draftId }, data: { status: 'done', stepId: 'done' } })
  return { status: 'proposed', proposal }
}

// ─── the channel ──────────────────────────────────────────────────────────────

const asked = (result: NoteResult, userId: string): FlowSay[] => {
  if (result.status === 'needs-person') return [{ text: 'Who is this note about? Type their name.' }]
  if (result.status !== 'ambiguous') return []
  if (result.contacts?.length) {
    return [{ text: 'Which person is this note about?', offer: { step: `contact:${result.draftId}`, options: [...result.contacts.slice(0, 6), { id: 'new', label: 'New contact' }], forUserId: userId } }]
  }
  return [{ text: 'Which company?', offer: { step: `account:${result.draftId}`, options: [...(result.accounts ?? []).slice(0, 5), { id: 'new', label: 'New company' }, { id: 'none', label: 'No company' }], forUserId: userId } }]
}
const problem = (error: unknown): FlowSay[] => {
  const e = error as { statusCode?: number; message?: string }
  if (e.statusCode && e.statusCode < 500) return [{ text: `${e.message ?? 'That note could not be added'}.`.replace(/\.\.$/, '.') }]
  throw error
}

async function ctxOf(userId: string): Promise<WorkspaceCtx> {
  return { user: await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }), origin: 'assistant' }
}
const workspaceOf = async (roomId: string) => (await db.workspaceChannel.findUnique({ where: { roomId } }))?.workspaceId ?? null

export const noteFlow: ChoiceFlow = {
  advance: () => [], // the choice is resolved after it commits
  async afterCommit(ctx) {
    const [kind, draftId] = ctx.step.split(':')
    const ws = await workspaceOf(ctx.roomId)
    if (!ws || !draftId) return []
    const pick = ctx.optionIds[0]!
    try {
      return asked(await addNote(await ctxOf(ctx.userId), ws, { draftId, ...(kind === 'contact' ? { contactId: pick } : { accountId: pick }) }), ctx.userId)
    } catch (error) { return problem(error) }
  },
}

/** A typed line in the channel: "note: …", or the name a waiting draft asked for. */
export async function noteText(item: { roomId: string; actorId: string; text: string | null }): Promise<FlowSay[] | null> {
  const text = item.text?.trim() ?? ''
  if (!text) return null
  const ws = await workspaceOf(item.roomId)
  if (!ws) return null
  try {
    if (NOTE_PREFIX.test(text)) return asked(await addNote(await ctxOf(item.actorId), ws, { text: text.replace(NOTE_PREFIX, '') }), item.actorId)
    const waiting = await db.workflowRun.findFirst({ where: { workflowKey: NOTE_FLOW, roomId: item.roomId, userId: item.actorId, status: 'waiting', stepId: 'person' }, orderBy: { createdAt: 'desc' } })
    if (!waiting) return null
    return asked(await addNote(await ctxOf(item.actorId), ws, { draftId: waiting.id, about: text }), item.actorId)
  } catch (error) { return problem(error) }
}
