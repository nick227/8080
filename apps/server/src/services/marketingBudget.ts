// Monthly marketing budget (doc/13 §12, A3). Deliberately boring: four inputs, each
// with its own owner, and a sheet whose shape the product already knows.
//
//   business type   the company profile (or the person's own words) — never decided by AI
//   monthly budget  typed by the person, parsed by code into minor units — never AI
//   goal            one of GOALS, read from the request by code (none → general)
//   priorities      0–3 of CHANNELS, read from the request by code
//
// It is a planning template: a standard split by goal, not an analysis. No sales,
// spending or results data exists yet, and nothing here claims any.
//
// Code owns the channels, the split, rounding, amounts, totals, currency, the sheet
// and its storage. The model may only write one short note per channel, with no
// numbers (budgetNotes in bots/flows/budget.ts); without it the notes are templates.
import { createHash } from 'crypto'
import type { Prisma } from '@project/db'
import { formatCell, minorDigits, sheetAsText, type SheetContent } from '@project/shared'
import { badRequest } from '../lib/errors'
import { authorize, permit } from './workspacePolicy'
import { memberActor, type WorkspaceCtx } from './WorkspaceService'
import { DocumentService } from './DocumentService'
import { runAction } from './actions'

const documents = new DocumentService()
const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue

export const GOALS = ['general', 'awareness', 'leads', 'sales', 'retention', 'launch'] as const
export type Goal = typeof GOALS[number]
export const GOAL_LABEL: Record<Goal, string> = { general: 'General', awareness: 'Awareness', leads: 'Leads', sales: 'Sales', retention: 'Keep customers', launch: 'Launch' }

export const CHANNELS = ['search', 'social', 'email', 'content', 'local', 'events', 'referral'] as const
export type Channel = typeof CHANNELS[number]
export const CHANNEL_LABEL: Record<Channel, string> = {
  search: 'Paid search', social: 'Paid social', email: 'Email', content: 'Content and SEO', local: 'Local and print', events: 'Events', referral: 'Referrals and partners',
}

// The starting split for each goal, in whole percents (each row sums to 100). A
// product decision written down once — not a model's guess.
const SPLIT: Record<Goal, Record<Channel, number>> = {
  // No goal stated: an even-handed starting point.
  general: { search: 25, social: 20, email: 15, content: 15, local: 15, events: 5, referral: 5 },
  awareness: { search: 10, social: 35, email: 5, content: 20, local: 15, events: 10, referral: 5 },
  leads: { search: 35, social: 20, email: 10, content: 15, local: 10, events: 5, referral: 5 },
  sales: { search: 35, social: 20, email: 20, content: 5, local: 10, events: 0, referral: 10 },
  retention: { search: 5, social: 10, email: 40, content: 20, local: 5, events: 5, referral: 15 },
  launch: { search: 20, social: 30, email: 10, content: 10, local: 10, events: 15, referral: 5 },
}
/** Points each priority channel gains, taken evenly (by share) from the others. */
const PRIORITY_BOOST = 10

// The note per channel when the model isn't used: what the money is for, plainly.
const TEMPLATE: Record<Channel, string> = {
  search: 'Ads shown to people already searching for what you offer.',
  social: 'Ads on social platforms, aimed at the people you want to reach.',
  email: 'Newsletters and follow-ups to people who already know you.',
  content: 'Useful pages and posts that help people find you through search.',
  local: 'Local listings, print and signage near where you work.',
  events: 'Fairs, meetups and sponsorships where your customers gather.',
  referral: 'Rewards and partnerships that bring in introductions.',
}

export type BudgetInputs = { businessType: string | null; monthlyMinor: number; currency: string; goal: Goal; priorities: Channel[] }

/** Integers with the same total as `target`, closest to the exact shares (largest remainder). */
function apportion(weights: number[], target: number) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const exact = weights.map((w) => (sum ? (w / sum) * target : 0))
  const out = exact.map(Math.floor)
  let left = target - out.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]![1]]!++
  return out
}

/** The split: whole percents summing to 100 and amounts summing exactly to the budget. */
export function allocate(goal: Goal, priorities: Channel[], monthlyMinor: number) {
  const base = SPLIT[goal]
  const boosted = new Set(priorities)
  const others = CHANNELS.filter((c) => !boosted.has(c))
  const gain = PRIORITY_BOOST * boosted.size
  const otherTotal = others.reduce((s, c) => s + base[c], 0)
  const weight = CHANNELS.map((c) => (boosted.has(c) ? base[c] + PRIORITY_BOOST : Math.max(0, base[c] - (otherTotal ? (gain * base[c]) / otherTotal : 0))))
  const percents = apportion(weight, 100)
  const amounts = apportion(percents, monthlyMinor)
  return CHANNELS.map((c, i) => ({ channel: c, percent: percents[i]!, amount: amounts[i]! })).filter((r) => r.percent > 0)
}

export function validateInputs(raw: { monthlyMinor: unknown; currency: string; goal: unknown; priorities: unknown; businessType?: unknown }): BudgetInputs {
  const bad = (m: string) => badRequest(m, 'INVALID_BUDGET')
  const max = 100_000_000 * 10 ** minorDigits(raw.currency)
  if (!Number.isSafeInteger(raw.monthlyMinor) || (raw.monthlyMinor as number) <= 0 || (raw.monthlyMinor as number) > max) throw bad('The monthly budget is a positive amount')
  if (!GOALS.includes(raw.goal as Goal)) throw bad('Unknown goal')
  if (!Array.isArray(raw.priorities) || raw.priorities.length > 3 || new Set(raw.priorities).size !== raw.priorities.length || raw.priorities.some((p) => !CHANNELS.includes(p))) throw bad('Pick up to three channels as priorities')
  const businessType = typeof raw.businessType === 'string' && raw.businessType.trim() ? raw.businessType.trim().replace(/\s+/g, ' ') : null
  if (businessType && businessType.length > 120) throw bad('Describe the business in at most 120 characters')
  return { businessType, monthlyMinor: raw.monthlyMinor as number, currency: raw.currency, goal: raw.goal as Goal, priorities: raw.priorities as Channel[] }
}

export const money = (minor: number, currency: string) => formatCell({ type: 'money', currency }, minor)
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/** The inputs in plain words — what the person confirms. */
export function describeBudget(i: BudgetInputs) {
  return [
    `${money(i.monthlyMinor, i.currency)} a month`,
    i.businessType ? `for ${i.businessType}` : null,
    i.goal === 'general' ? null : `goal: ${GOAL_LABEL[i.goal]}`,
    i.priorities.length ? `priorities: ${andList(i.priorities.map((p) => CHANNEL_LABEL[p]))}` : 'no channel priorities',
  ].filter(Boolean).join(' · ')
}

export function budgetSheet(i: BudgetInputs, notes: Partial<Record<Channel, string>>): SheetContent {
  return {
    schemaVersion: 1,
    columns: [
      { id: 'channel', label: 'Channel', type: 'text' },
      { id: 'share', label: 'Share (%)', type: 'number', total: 'sum' },
      { id: 'monthly', label: 'Per month', type: 'money', currency: i.currency, total: 'sum' },
      { id: 'notes', label: 'What it pays for', type: 'text' },
    ],
    rows: allocate(i.goal, i.priorities, i.monthlyMinor).map((r) => ({
      id: r.channel,
      cells: { channel: CHANNEL_LABEL[r.channel], share: r.percent, monthly: r.amount, notes: notes[r.channel] ?? TEMPLATE[r.channel] },
    })),
  }
}

export type BudgetSource = { businessType: 'profile' | 'typed' | 'none'; notes: 'ai' | 'template'; callId: string | null }

/** Makes the budget sheet (a native grid, typed, editable). Retry-safe by idempotencyKey. */
export async function createBudget(ctx: WorkspaceCtx, workspaceId: string, input: BudgetInputs & { title?: string; idempotencyKey: string; workspaceAccess?: 'viewer' | 'editor' | null; notes: Partial<Record<Channel, string>>; source: BudgetSource }) {
  const actor = await authorize(ctx.user.id, workspaceId, 'document.create')
  permit(actor, 'workspace.read')
  const title = input.title?.trim() || 'Monthly Marketing Budget'
  if (title.length > 200) throw badRequest('Title must contain 1–200 characters', 'INVALID_TITLE')
  const content = budgetSheet(input, input.notes)
  const inputs = { businessType: input.businessType, monthlyMinor: input.monthlyMinor, currency: input.currency, goal: input.goal, priorities: input.priorities }
  const recipe = {
    kind: 'artifact', generator: 'budget.monthly', generatorVersion: 1, inputs, summary: `Planning template · ${describeBudget(input)}`,
    sources: input.source, asOf: new Date().toISOString(), timezone: actor.workspace.timezone, currency: input.currency, rowCount: content.rows.length,
    dataHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'), previousId: null,
  }
  const documentId = await runAction({
    action: 'document.budget.create', workspaceId, actor: memberActor(actor), origin: ctx.origin, target: { type: 'document' },
    input: { inputs, title }, idempotencyKey: input.idempotencyKey,
  }, async (tx) => {
    const row = await tx.document.create({
      data: {
        workspaceId, ownerMemberId: actor.member.id, title, surface: 'grid', sourceKind: 'native',
        descriptor: { surface: 'grid', source: { kind: 'native', schemaVersion: 1 } }, payload: json(sheetAsText(content)), provenance: json(recipe),
        ...(input.workspaceAccess ? { workspaceAccess: input.workspaceAccess } : {}),
      },
    })
    await tx.documentContent.create({ data: { documentId: row.id, workspaceId, version: 1, content: json(content), updatedByMemberId: actor.member.id } })
    return { value: row.id, targetId: row.id }
  }, async (previous) => previous.targetId!)
  return documents.get(ctx.user.id, workspaceId, documentId)
}
