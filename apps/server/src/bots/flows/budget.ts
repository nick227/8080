// Monthly marketing budget from the channel (doc/13 §12 A3, §14). One request:
// "Create a monthly marketing budget for $2,500" → the sheet, in Documents, linked.
// Code reads the amount, goal words and channel names (requests.ts); the business type
// comes from the company profile. Only a missing amount is asked for. No confirmation:
// creating a document changes no records. The model writes only the per-channel notes.
import { db, type Prisma } from '@project/db'
import { parseCell } from '@project/shared'
import { authorize } from '../../services/workspacePolicy'
import { CompanyProfileService } from '../../services/CompanyProfileService'
import { CHANNELS, CHANNEL_LABEL, GOAL_LABEL, createBudget, money, validateInputs, type BudgetInputs, type Channel, type Goal } from '../../services/marketingBudget'
import type { WorkspaceCtx } from '../../services/WorkspaceService'
import { assistantAvailable, budgetNotes } from '../assistant/calls'
import { budgetRequest } from './requests'
import type { ChoiceFlow, FlowSay } from './registry'

export const BUDGET_FLOW = 'marketing-budget'

type State = { goal: Goal | null; priorities: Channel[]; currency: string }

const profiles = new CompanyProfileService()
async function ctxOf(userId: string): Promise<WorkspaceCtx> {
  return { user: await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }), origin: 'assistant' }
}
const workspaceOf = async (roomId: string) => (await db.workspaceChannel.findUnique({ where: { roomId } }))?.workspaceId ?? null

/** What the business does, from the company profile (never decided by AI). */
async function businessOf(userId: string, workspaceId: string) {
  const profile = await profiles.get(userId, workspaceId).catch(() => null)
  return profile?.purpose?.trim().slice(0, 120) || null
}

/** The notes: the model's, where it wrote a usable one; templates for the rest. */
export async function notesFor(workspaceId: string, inputs: BudgetInputs) {
  if (!(await assistantAvailable(workspaceId))) return { notes: {}, source: 'template' as const, callId: null }
  const channels = CHANNELS.map((c) => ({ key: c, label: CHANNEL_LABEL[c] }))
  const res = await budgetNotes({ workspaceId, runId: null }, { businessType: inputs.businessType, goal: GOAL_LABEL[inputs.goal], priorities: inputs.priorities.map((p) => CHANNEL_LABEL[p]), channels })
  return res && Object.keys(res.notes).length ? { notes: res.notes as Partial<Record<Channel, string>>, source: 'ai' as const, callId: res.callId } : { notes: {}, source: 'template' as const, callId: null }
}

/** Builds and stores the budget sheet (API and channel). */
export async function makeBudget(ctx: WorkspaceCtx, workspaceId: string, inputs: BudgetInputs, opts: { businessSource: 'profile' | 'typed' | 'none'; idempotencyKey: string; title?: string; workspaceAccess?: 'viewer' | null }) {
  const notes = await notesFor(workspaceId, inputs)
  return createBudget(ctx, workspaceId, {
    ...inputs, notes: notes.notes, title: opts.title, idempotencyKey: opts.idempotencyKey, workspaceAccess: opts.workspaceAccess ?? null,
    source: { businessType: opts.businessSource, notes: notes.source, callId: notes.callId },
  })
}

/** POST /workspaces/{id}/budgets: the same inputs, given directly. */
export async function budgetFromApi(ctx: WorkspaceCtx, workspaceId: string, body: { monthlyBudgetMinor: number; goal?: string; priorities?: string[]; businessType?: string; title?: string; idempotencyKey: string }) {
  const actor = await authorize(ctx.user.id, workspaceId, 'document.create')
  const given = body.businessType?.trim() || null
  const businessType = given ?? (await businessOf(ctx.user.id, workspaceId))
  const inputs = validateInputs({ monthlyMinor: body.monthlyBudgetMinor, currency: actor.workspace.defaultCurrency, goal: body.goal ?? 'general', priorities: body.priorities ?? [], businessType })
  return makeBudget(ctx, workspaceId, inputs, { businessSource: given ? 'typed' : businessType ? 'profile' : 'none', idempotencyKey: body.idempotencyKey, title: body.title })
}

async function create(userId: string, workspaceId: string, state: State, monthlyMinor: number, key: string): Promise<FlowSay[]> {
  try {
    const businessType = await businessOf(userId, workspaceId)
    const inputs = validateInputs({ monthlyMinor, currency: state.currency, goal: state.goal ?? 'general', priorities: state.priorities, businessType })
    const doc = await makeBudget(await ctxOf(userId), workspaceId, inputs, { businessSource: businessType ? 'profile' : 'none', idempotencyKey: key, workspaceAccess: 'viewer' })
    const rows = (doc.provenance as { rowCount: number }).rowCount
    return [{
      text: `Created “${doc.title}” in Documents: ${money(monthlyMinor, state.currency)} a month across ${rows} channels. It is a planning template using a standard split${inputs.goal === 'general' ? '' : ` for ${GOAL_LABEL[inputs.goal].toLowerCase()}`}; it does not use sales or spending data.`,
      links: [{ type: 'document', id: doc.id, workspaceId, title: doc.title }],
    }]
  } catch (error) {
    const e = error as { statusCode?: number; message?: string }
    if (e.statusCode && e.statusCode < 500) return [{ text: `${e.message ?? 'That budget could not be created'}.` }]
    throw error
  }
}

// Kept for choices offered before the flow was simplified; nothing offers them now.
export const budgetFlow: ChoiceFlow = { advance: () => [] }

/** A budget request in the channel, or the amount a waiting one asked for. Null otherwise. */
export async function budgetText(item: { roomId: string; itemId: string; actorId: string; text: string | null }): Promise<FlowSay[] | null> {
  const text = item.text?.trim() ?? ''
  if (!text) return null
  const workspaceId = await workspaceOf(item.roomId)
  if (!workspaceId) return null
  const waiting = () => db.workflowRun.findFirst({ where: { workflowKey: BUDGET_FLOW, roomId: item.roomId, userId: item.actorId, status: 'waiting', stepId: 'amount' }, orderBy: { createdAt: 'desc' } })
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { defaultCurrency: true } })
  const asked = budgetRequest(text, ws.defaultCurrency)
  if (asked) {
    const actor = await authorize(item.actorId, workspaceId, 'document.create')
    await db.workflowRun.updateMany({ where: { workflowKey: BUDGET_FLOW, roomId: item.roomId, userId: item.actorId, status: 'waiting' }, data: { status: 'done', stepId: 'replaced' } })
    const state: State = { goal: asked.goal, priorities: asked.priorities, currency: ws.defaultCurrency }
    if (asked.monthlyMinor) return create(item.actorId, workspaceId, state, asked.monthlyMinor, `budget:${item.itemId}`)
    await db.workflowRun.create({
      data: { workspaceId, memberId: actor.member.id, userId: item.actorId, roomId: item.roomId, workflowKey: BUDGET_FLOW, version: 2, stepId: 'amount', status: 'waiting', state: state as unknown as Prisma.InputJsonValue },
    })
    return [{ text: `What is the monthly budget, in ${ws.defaultCurrency}?` }]
  }
  const run = await waiting()
  if (!run) return null
  const state = run.state as unknown as State
  const parsed = parseCell({ type: 'money', currency: state.currency }, text)
  const usable = parsed.ok && typeof parsed.value === 'number' && parsed.value > 0 && (() => { try { validateInputs({ monthlyMinor: parsed.value, currency: state.currency, goal: 'general', priorities: [] }); return true } catch { return false } })()
  if (!usable || !parsed.ok) return [{ text: `“${text}” isn’t an amount. Type the monthly budget as a number, for example 2,500.` }]
  await db.workflowRun.update({ where: { id: run.id }, data: { status: 'done', stepId: 'made' } })
  return create(item.actorId, workspaceId, state, parsed.value as number, `budget:${run.id}`)
}
