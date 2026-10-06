// Monthly marketing budget in the channel (doc/13 §12, A3). Four inputs, asked one at
// a time, each owned by what should own it: the profile (or the person's words) for
// the business, the person's typed amount (parsed by code), a goal button, and up to
// three channel buttons. Then the person confirms, and code builds the sheet; the
// model only writes the per-channel notes. A run is a WorkflowRun "marketing-budget".
//
//   channel: "budget" → business? → amount → goal → priorities → [Make the budget]
import { db, type Prisma } from '@project/db'
import { parseCell } from '@project/shared'
import { authorize } from '../../services/workspacePolicy'
import { CompanyProfileService } from '../../services/CompanyProfileService'
import {
  CHANNELS, CHANNEL_LABEL, GOALS, GOAL_LABEL, createBudget, describeBudget, money, validateInputs,
  type BudgetInputs, type Channel, type Goal,
} from '../../services/marketingBudget'
import type { WorkspaceCtx } from '../../services/WorkspaceService'
import { assistantAvailable, budgetNotes } from '../assistant/calls'
import type { ChoiceFlow, FlowSay } from './registry'

export const BUDGET_FLOW = 'marketing-budget'
const TRIGGER = /^\s*budget\s*$/i

type State = { businessType: string | null; businessSource: 'profile' | 'typed' | 'none'; currency: string; monthlyMinor?: number; goal?: Goal; priorities?: Channel[] }

const profiles = new CompanyProfileService()
async function ctxOf(userId: string): Promise<WorkspaceCtx> {
  return { user: await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }), origin: 'assistant' }
}
const workspaceOf = async (roomId: string) => (await db.workspaceChannel.findUnique({ where: { roomId } }))?.workspaceId ?? null
const save = (id: string, state: State, stepId: string, status: 'waiting' | 'done' = 'waiting') =>
  db.workflowRun.update({ where: { id }, data: { state: state as unknown as Prisma.InputJsonValue, stepId, status } })

const askAmount = (s: State): FlowSay => ({ text: `What is the monthly marketing budget, in ${s.currency}? Type an amount, for example 2,500.` })
const askGoal = (runId: string, userId: string): FlowSay => ({
  text: 'What should this money do first?',
  offer: { step: `goal:${runId}`, options: GOALS.map((g) => ({ id: g, label: GOAL_LABEL[g] })), forUserId: userId },
})
const askPriorities = (runId: string, userId: string): FlowSay => ({
  text: 'Which channels matter most right now? Pick up to three, or none.',
  offer: { step: `priorities:${runId}`, mode: 'many', options: [...CHANNELS.map((c) => ({ id: c, label: CHANNEL_LABEL[c] })), { id: 'none', label: 'No preference' }], forUserId: userId },
})
const inputsOf = (s: State) => validateInputs({ monthlyMinor: s.monthlyMinor, currency: s.currency, goal: s.goal, priorities: s.priorities ?? [], businessType: s.businessType })

/** The notes: the model's, where it wrote a usable one; templates for the rest. */
export async function notesFor(workspaceId: string, inputs: BudgetInputs) {
  if (!(await assistantAvailable(workspaceId))) return { notes: {}, source: 'template' as const, callId: null }
  const channels = CHANNELS.map((c) => ({ key: c, label: CHANNEL_LABEL[c] }))
  const res = await budgetNotes({ workspaceId, runId: null }, { businessType: inputs.businessType, goal: GOAL_LABEL[inputs.goal], priorities: inputs.priorities.map((p) => CHANNEL_LABEL[p]), channels })
  return res && Object.keys(res.notes).length ? { notes: res.notes as Partial<Record<Channel, string>>, source: 'ai' as const, callId: res.callId } : { notes: {}, source: 'template' as const, callId: null }
}

/** Builds and stores the budget sheet (API and channel). */
export async function makeBudget(ctx: WorkspaceCtx, workspaceId: string, inputs: BudgetInputs, opts: { businessSource: State['businessSource']; idempotencyKey: string; title?: string; workspaceAccess?: 'viewer' | null }) {
  const notes = await notesFor(workspaceId, inputs)
  return createBudget(ctx, workspaceId, {
    ...inputs, notes: notes.notes, title: opts.title, idempotencyKey: opts.idempotencyKey, workspaceAccess: opts.workspaceAccess ?? null,
    source: { businessType: opts.businessSource, notes: notes.source, callId: notes.callId },
  })
}

/** POST /workspaces/{id}/budgets: the same inputs, given directly. */
export async function budgetFromApi(ctx: WorkspaceCtx, workspaceId: string, body: { monthlyBudgetMinor: number; goal: string; priorities?: string[]; businessType?: string; title?: string; idempotencyKey: string }) {
  const actor = await authorize(ctx.user.id, workspaceId, 'document.create')
  let businessType = body.businessType?.trim() || null
  let businessSource: State['businessSource'] = businessType ? 'typed' : 'none'
  if (!businessType) {
    const profile = await profiles.get(ctx.user.id, workspaceId).catch(() => null)
    businessType = (profile as { purpose?: string | null } | null)?.purpose?.trim().slice(0, 120) || null
    if (businessType) businessSource = 'profile'
  }
  const inputs = validateInputs({ monthlyMinor: body.monthlyBudgetMinor, currency: actor.workspace.defaultCurrency, goal: body.goal, priorities: body.priorities ?? [], businessType })
  return makeBudget(ctx, workspaceId, inputs, { businessSource, idempotencyKey: body.idempotencyKey, title: body.title })
}

async function finish(runId: string, userId: string, state: State): Promise<FlowSay[]> {
  const inputs = inputsOf(state)
  await save(runId, state, 'confirm')
  return [{
    text: `I’d make a monthly budget: ${describeBudget(inputs)}. The split follows the goal, with more for your priorities.`,
    offer: { step: `confirm:${runId}`, options: [{ id: 'make', label: 'Make the budget' }, { id: 'cancel', label: 'Cancel' }], forUserId: userId },
  }]
}

export const budgetFlow: ChoiceFlow = {
  advance: () => [],
  async afterCommit(ctx) {
    const [kind, runId] = ctx.step.split(':')
    const workspaceId = await workspaceOf(ctx.roomId)
    if (!workspaceId || !runId) return []
    const run = await db.workflowRun.findFirst({ where: { id: runId, workspaceId, userId: ctx.userId, workflowKey: BUDGET_FLOW, status: 'waiting' } })
    if (!run) return [{ text: 'That budget request is gone. Type “budget” to start again.' }]
    const state = run.state as unknown as State
    if (kind === 'goal') {
      const goal = ctx.optionIds[0] as Goal
      await save(run.id, { ...state, goal }, 'priorities')
      return [askPriorities(run.id, ctx.userId)]
    }
    if (kind === 'priorities') {
      const picked = ctx.optionIds.filter((id) => id !== 'none') as Channel[]
      if (picked.length > 3) {
        await save(run.id, state, 'priorities')
        return [{ text: 'That’s more than three. Pick up to three.' }, askPriorities(run.id, ctx.userId)]
      }
      return finish(run.id, ctx.userId, { ...state, priorities: picked })
    }
    if (kind === 'confirm') {
      await save(run.id, state, ctx.optionIds[0] === 'make' ? 'made' : 'cancelled', 'done')
      if (ctx.optionIds[0] !== 'make') return [{ text: 'Cancelled. Nothing was made.' }]
      try {
        const doc = await makeBudget(await ctxOf(ctx.userId), workspaceId, inputsOf(state), { businessSource: state.businessSource, idempotencyKey: `budget:${run.id}`, workspaceAccess: 'viewer' })
        return [{ text: `Made “${doc.title}”: ${money(state.monthlyMinor!, state.currency)} a month across ${(doc.provenance as { rowCount: number }).rowCount} channels. Change any amount in the sheet; the totals follow.`, links: [{ type: 'document', id: doc.id, workspaceId, title: doc.title }] }]
      } catch (error) {
        const e = error as { statusCode?: number; message?: string }
        if (e.statusCode && e.statusCode < 500) return [{ text: `${e.message ?? 'That budget could not be made'}.` }]
        throw error
      }
    }
    return []
  },
}

/** "budget" starts a run; while one waits for typed text (business, amount), this answers it. */
export async function budgetText(item: { roomId: string; actorId: string; text: string | null }): Promise<FlowSay[] | null> {
  const text = item.text?.trim() ?? ''
  if (!text) return null
  const workspaceId = await workspaceOf(item.roomId)
  if (!workspaceId) return null
  if (TRIGGER.test(text)) {
    const actor = await authorize(item.actorId, workspaceId, 'document.create')
    await db.workflowRun.updateMany({ where: { workflowKey: BUDGET_FLOW, roomId: item.roomId, userId: item.actorId, status: 'waiting' }, data: { status: 'done', stepId: 'replaced' } })
    const profile = await profiles.get(item.actorId, workspaceId).catch(() => null)
    const purpose = (profile as { purpose?: string | null } | null)?.purpose?.trim() || null
    const state: State = { businessType: purpose ? purpose.slice(0, 120) : null, businessSource: purpose ? 'profile' : 'none', currency: actor.workspace.defaultCurrency }
    await db.workflowRun.create({
      data: { workspaceId, memberId: actor.member.id, userId: item.actorId, roomId: item.roomId, workflowKey: BUDGET_FLOW, version: 1, stepId: purpose ? 'amount' : 'business', status: 'waiting', state: state as unknown as Prisma.InputJsonValue },
    })
    return purpose
      ? [{ text: `A monthly marketing budget for ${state.businessType}, from the company profile.` }, askAmount(state)]
      : [{ text: 'What does the business do, in a few words? For example: commercial photography.' }]
  }
  const run = await db.workflowRun.findFirst({ where: { workflowKey: BUDGET_FLOW, roomId: item.roomId, userId: item.actorId, status: 'waiting', stepId: { in: ['business', 'amount'] } }, orderBy: { createdAt: 'desc' } })
  if (!run) return null
  const state = run.state as unknown as State
  if (run.stepId === 'business') {
    if (text.length > 120) return [{ text: 'Shorter, please: a few words, under 120 characters.' }]
    const next = { ...state, businessType: text.replace(/\s+/g, ' '), businessSource: 'typed' as const }
    await save(run.id, next, 'amount')
    return [askAmount(next)]
  }
  const parsed = parseCell({ type: 'money', currency: state.currency }, text)
  const usable = parsed.ok && typeof parsed.value === 'number' && (() => { try { validateInputs({ monthlyMinor: parsed.value, currency: state.currency, goal: 'leads', priorities: [] }); return true } catch { return false } })()
  if (!usable || !parsed.ok) return [{ text: `“${text}” isn’t an amount I can use. Type the monthly budget as a number, for example 2,500.` }]
  await save(run.id, { ...state, monthlyMinor: parsed.value as number }, 'goal')
  return [askGoal(run.id, item.actorId)]
}
