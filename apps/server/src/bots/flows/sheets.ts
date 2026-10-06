// Sheets in the channel (doc/13 §12, A1). "sheet" → the presets as buttons; "sheet:
// <request>" → the model fills the whitelisted sheet query, the server validates it,
// and the person sees it in plain words with [Make the sheet] before anything runs.
// Data, counts and totals are code (services/sheetQuery.ts). A sheet made here is
// workspace-visible, like the channel it was asked in (doc/12 §5.4).
//
//   channel: "sheet: open leads with no follow-up"  → confirm → document link
import { db, type Prisma } from '@project/db'
import { authorize } from '../../services/workspacePolicy'
import { sheetArtifacts } from '../../services/SheetArtifactService'
import { SHEET_PRESETS, describeSheetQuery, todayIn, validateSheetQuery } from '../../services/sheetQuery'
import type { WorkspaceCtx } from '../../services/WorkspaceService'
import { assistantAvailable, planSheet } from '../assistant/calls'
import type { ChoiceFlow, FlowSay } from './registry'
import type { SheetQuery } from '@project/shared'

export const SHEET_FLOW = 'sheet-query'
export const SHEET_PREFIX = /^\s*sheets?\s*(?::\s*(.*))?$/is

type Draft = { query: SheetQuery; title: string | null; request: string; callId: string | null }
const WEEKDAY = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

const presetOffer = (text: string, userId: string): FlowSay => ({
  text,
  offer: { step: 'preset', options: SHEET_PRESETS.map((p) => ({ id: p.key, label: p.label })), forUserId: userId },
})

async function ctxOf(userId: string): Promise<WorkspaceCtx> {
  return { user: await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }), origin: 'assistant' }
}
const workspaceOf = async (roomId: string) => (await db.workspaceChannel.findUnique({ where: { roomId } }))?.workspaceId ?? null

const unit = (q: SheetQuery, n: number) => {
  const word = q.groupBy ? (q.source === 'contacts' ? ['group', 'groups'] : ['category', 'categories']) : q.source === 'contacts' ? ['contact', 'contacts'] : ['item', 'items']
  return `${n} ${n === 1 ? word[0] : word[1]}`
}

/** Makes the sheet and says so with a link; a refusal (too large, no match) is said plainly. */
async function make(userId: string, workspaceId: string, input: { preset?: string; query?: SheetQuery; title?: string | null }, key: string): Promise<FlowSay[]> {
  try {
    const doc = await sheetArtifacts.create(await ctxOf(userId), workspaceId, {
      ...(input.preset ? { preset: input.preset } : { query: input.query }), ...(input.title ? { title: input.title } : {}),
      idempotencyKey: key, workspaceAccess: 'viewer', refuseEmpty: true,
    })
    const recipe = doc.provenance as { rowCount: number; query: SheetQuery }
    return [{ text: `Made “${doc.title}”: ${unit(recipe.query, recipe.rowCount)}. It shows the data as of now; open it later and I can make it again from current data.`, links: [{ type: 'document', id: doc.id, workspaceId, title: doc.title }] }]
  } catch (error) {
    const e = error as { statusCode?: number; message?: string }
    if (e.statusCode && e.statusCode < 500) return [{ text: e.message?.endsWith('.') ? e.message : `${e.message ?? 'That sheet could not be made'}.` }]
    throw error
  }
}

export const sheetFlow: ChoiceFlow = {
  advance: () => [],
  async afterCommit(ctx) {
    const ws = await workspaceOf(ctx.roomId)
    if (!ws) return []
    const pick = ctx.optionIds[0]!
    if (ctx.step === 'preset') return make(ctx.userId, ws, { preset: pick }, `sheet:${ctx.itemId}:${pick}`)
    const [kind, draftId] = ctx.step.split(':')
    if (kind !== 'confirm' || !draftId) return []
    const run = await db.workflowRun.findFirst({ where: { id: draftId, workspaceId: ws, userId: ctx.userId, workflowKey: SHEET_FLOW, status: 'waiting' } })
    if (!run) return [{ text: 'That sheet request is gone. Type “sheet” to start again.' }]
    await db.workflowRun.update({ where: { id: run.id }, data: { status: 'done', stepId: pick === 'make' ? 'made' : 'cancelled' } })
    if (pick !== 'make') return [{ text: 'Cancelled. Nothing was made.' }]
    const draft = run.state as unknown as Draft
    return make(ctx.userId, ws, { query: draft.query, title: draft.title }, `sheet:${run.id}`)
  },
}

/** A typed "sheet" / "sheet: …" line in the channel, or null if it isn't one. */
export async function sheetText(item: { roomId: string; actorId: string; text: string | null }): Promise<FlowSay[] | null> {
  const match = item.text?.trim().match(SHEET_PREFIX)
  if (!match) return null
  const workspaceId = await workspaceOf(item.roomId)
  if (!workspaceId) return null
  const actor = await authorize(item.actorId, workspaceId, 'record.read')
  const request = match[1]?.trim() ?? ''
  if (!request) return [presetOffer('Which sheet? Each one reads your current records.', item.actorId)]
  if (!(await assistantAvailable(workspaceId))) return [presetOffer('I can make these sheets now. Pick one:', item.actorId)]

  const today = todayIn(actor.workspace.timezone)
  const categories = (await db.inventory.findMany({ where: { workspaceId, status: 'active', category: { not: null } }, distinct: ['category'], select: { category: true }, take: 50 })).map((c) => c.category!)
  const planned = await planSheet({ workspaceId, runId: null }, { request, today, weekday: WEEKDAY(today), categories })
  if (!planned) return [presetOffer('I couldn’t read that request just now. These sheets work without it:', item.actorId)]
  if (!planned.plan.supported || !planned.plan.query) {
    return [presetOffer(`I can’t make that sheet${planned.plan.reason ? `: ${planned.plan.reason.replace(/\.$/, '')}` : ''}. I can read Contacts and Inventory. These are ready:`, item.actorId)]
  }
  let query: SheetQuery
  try { query = validateSheetQuery(planned.plan.query) } catch {
    return [presetOffer('I couldn’t turn that into a sheet I can build from Contacts or Inventory. These are ready:', item.actorId)]
  }
  const summary = await describeSheetQuery({ workspaceId, timezone: actor.workspace.timezone, currency: actor.workspace.defaultCurrency }, query)
  const draft: Draft = { query, title: planned.plan.title, request, callId: planned.callId }
  const run = await db.workflowRun.create({
    data: { workspaceId, memberId: actor.member.id, userId: item.actorId, roomId: item.roomId, workflowKey: SHEET_FLOW, version: 1, stepId: 'confirm', status: 'waiting', state: draft as unknown as Prisma.InputJsonValue },
  })
  return [{
    text: `I’d make this sheet: ${summary}.`,
    offer: { step: `confirm:${run.id}`, options: [{ id: 'make', label: 'Make the sheet' }, { id: 'cancel', label: 'Cancel' }], forUserId: item.actorId },
  }]
}
