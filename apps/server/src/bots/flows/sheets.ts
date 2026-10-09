// Spreadsheets from the channel (doc/13 §12 A1, §14). "Create a spreadsheet of …" is
// created at once and linked: familiar asks match a preset by code; anything else is
// planned by the model into the whitelisted query and checked by the server. Data,
// counts and totals are code (services/sheetQuery.ts). Created here = workspace-visible,
// like the channel it was asked in (doc/12 §5.4). "Create spreadsheet" alone → presets.
import { db } from '@project/db'
import { authorize } from '../../services/workspacePolicy'
import { sheetArtifacts } from '../../services/SheetArtifactService'
import { SHEET_PRESETS, todayIn, validateSheetQuery } from '../../services/sheetQuery'
import { presetIn, spreadsheetRequest } from './requests'
import type { WorkspaceCtx } from '../../services/WorkspaceService'
import { assistantAvailable, planSheet } from '../assistant/calls'
import type { ChoiceFlow, FlowSay } from './registry'
import type { SheetQuery } from '@project/shared'

export const SHEET_FLOW = 'sheet-query'

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

/** A listing always leads with the name: code decides usability, not the model. */
const withName = (q: SheetQuery): SheetQuery =>
  q.groupBy || !q.columns || (q.columns as string[]).includes('name') ? q : ({ ...q, columns: ['name', ...q.columns] } as SheetQuery)

/** Creates the spreadsheet and links it; a refusal (too large, no match) is said plainly. */
async function make(userId: string, workspaceId: string, input: { preset?: string; query?: SheetQuery; title?: string | null }, key: string): Promise<FlowSay[]> {
  try {
    const doc = await sheetArtifacts.create(await ctxOf(userId), workspaceId, {
      ...(input.preset ? { preset: input.preset } : { query: input.query }), ...(input.title ? { title: input.title } : {}),
      idempotencyKey: key, workspaceAccess: 'viewer', refuseEmpty: true,
    })
    const recipe = doc.provenance as { rowCount: number; query: SheetQuery; summary: string }
    return [{ text: `Created “${doc.title}” in Documents: ${unit(recipe.query, recipe.rowCount)}. Includes: ${recipe.summary}.`, links: [{ type: 'document', id: doc.id, workspaceId, title: doc.title }] }]
  } catch (error) {
    const e = error as { statusCode?: number; message?: string }
    if (e.statusCode && e.statusCode < 500) return [{ text: e.message?.endsWith('.') ? e.message : `${e.message ?? 'That spreadsheet could not be created'}.` }]
    throw error
  }
}

export const sheetFlow: ChoiceFlow = {
  advance: () => [],
  async afterCommit(ctx) {
    const ws = await workspaceOf(ctx.roomId)
    if (!ws || ctx.step !== 'preset') return []
    const pick = ctx.optionIds[0]!
    return make(ctx.userId, ws, { preset: pick }, `sheet:${ctx.itemId}:${pick}`)
  },
}

/** "Create a spreadsheet of …" (or "sheet: …") in the channel → the spreadsheet, at once.
 *  Common asks match a preset by their words (no model); anything else is planned by
 *  the model into the whitelisted query, checked, and created. Nothing to confirm:
 *  creating a document changes no records. Null if the line isn't a request. */
export async function sheetText(item: { roomId: string; itemId: string; actorId: string; text: string | null }): Promise<FlowSay[] | null> {
  const request = spreadsheetRequest(item.text ?? '')
  if (request === null) return null
  const workspaceId = await workspaceOf(item.roomId)
  if (!workspaceId) return null
  const actor = await authorize(item.actorId, workspaceId, 'record.read')
  if (request.length > 300) return [presetOffer('That request is too long. Describe it in one sentence, or choose one:', item.actorId)]
  if (!request) return [presetOffer('Choose a spreadsheet:', item.actorId)]
  const key = `sheet:${item.itemId}`
  const preset = presetIn(request)
  // Short, familiar asks ("low stock", "price list") need no model.
  if (preset && request.split(/\s+/).length <= 5) return make(item.actorId, workspaceId, { preset }, key)
  if (!(await assistantAvailable(workspaceId))) {
    return preset ? make(item.actorId, workspaceId, { preset }, key) : [presetOffer('These spreadsheets are available:', item.actorId)]
  }
  const today = todayIn(actor.workspace.timezone)
  const categories = (await db.inventory.findMany({ where: { workspaceId, status: 'active', category: { not: null } }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' }, take: 30 })).map((c) => c.category!)
  // Stages are workspace vocabulary: the model picks keys from these, never from memory.
  const stages = (await db.pipelineStage.findMany({ where: { workspaceId, archived: false }, orderBy: [{ position: 'asc' }, { key: 'asc' }], take: 20 }))
    .map((s) => ({ key: s.key, label: s.label, open: s.kind === 'open' }))
  const planned = await planSheet({ workspaceId, runId: null }, { request, today, weekday: WEEKDAY(today), categories, stages })
  if (!planned) return preset ? make(item.actorId, workspaceId, { preset }, key) : [presetOffer('I couldn’t read that request. These spreadsheets are available:', item.actorId)]
  if (!planned.plan.supported || !planned.plan.query) {
    return [presetOffer(`I can’t create that spreadsheet${planned.plan.reason ? `: ${planned.plan.reason.replace(/\.$/, '')}` : ''}. I can use Contacts and Inventory. These are available:`, item.actorId)]
  }
  let query: SheetQuery
  try { query = withName(validateSheetQuery(planned.plan.query)) } catch {
    return [presetOffer('I couldn’t build that from Contacts or Inventory. These are available:', item.actorId)]
  }
  return make(item.actorId, workspaceId, { query, title: planned.plan.title }, key)
}
