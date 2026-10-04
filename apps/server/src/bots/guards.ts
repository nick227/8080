// The typed guard registry (doc/08 §4.2). Packs name guards; code defines them.
// A guard returns true to continue, or a skip reason. Subject-filtering guards
// narrow ctx.subjects and fail only when nobody is left.
import { db } from '@project/db'
import { humanAuthoredWhere } from '../lib/authorship'
import { roomPresence } from '../services/presence'
import { isSeated } from './seating'
import { parseDurationValue } from './time'
import { classify } from './classify'
import type { Pack } from './pack'

export type GuardCtx = {
  botId: string
  roomId: string
  subjects: Set<string>
  trigger: { itemId?: string; actorId?: string; roomOwnerId?: string; text?: string | null }
  rng: () => number
  classifier?: Pack['classifier']
}
type Guard = (ctx: GuardCtx, arg: unknown) => Promise<true | string>

export const GREET_WORKFLOWS = ['greet', 'opening']

/** Subjects this bot greeted (posted) in the room since `since`. */
export async function greetedSince(botId: string, roomId: string, since: Date) {
  const rows = await db.botDecision.findMany({
    where: { botId, roomId, workflow: { in: GREET_WORKFLOWS }, itemId: { not: null }, at: { gte: since } },
    select: { subjects: true },
  })
  return new Set(rows.flatMap((r) => (Array.isArray(r.subjects) ? (r.subjects as string[]) : [])))
}

export const GUARDS: Record<string, Guard> = {
  async seated(ctx) {
    const bot = await db.bot.findUnique({ where: { id: ctx.botId }, select: { id: true, kind: true, enabled: true } })
    return bot && (await isSeated(bot, ctx.roomId)) ? true : 'not-seated'
  },
  async roomHasHumanItem(ctx) {
    const n = await db.item.count({ where: { roomId: ctx.roomId, deletedAt: null, ...humanAuthoredWhere } })
    return n > 0 ? true : 'no-human-item'
  },
  async humanPresent(ctx) {
    return roomPresence.here(ctx.roomId).length > 0 ? true : 'nobody-here'
  },
  async subjectsPresent(ctx) {
    for (const id of [...ctx.subjects]) if (!roomPresence.isHere(ctx.roomId, id)) ctx.subjects.delete(id)
    return ctx.subjects.size > 0 ? true : 'subjects-gone'
  },
  async notGreetedWithin(ctx, arg) {
    const since = new Date(Date.now() - parseDurationValue(arg))
    const greeted = await greetedSince(ctx.botId, ctx.roomId, since)
    for (const id of [...ctx.subjects]) if (greeted.has(id)) ctx.subjects.delete(id)
    return ctx.subjects.size > 0 ? true : 'recently-greeted'
  },
  async itemLive(ctx) {
    if (!ctx.trigger.itemId) return 'no-item'
    const item = await db.item.findUnique({ where: { id: ctx.trigger.itemId }, select: { deletedAt: true } })
    return item && !item.deletedAt ? true : 'item-gone'
  },
  async authorIsOwner(ctx) {
    return ctx.trigger.actorId && ctx.trigger.actorId === ctx.trigger.roomOwnerId ? true : 'first-item-not-owner'
  },
  // { intent: media-request } — the trigger text classifies as this intent.
  async intent(ctx, arg) {
    const want = typeof arg === 'string' ? arg : String((arg as any)?.is ?? '')
    if (!ctx.classifier || !ctx.trigger.text) return 'no-text'
    return classify(ctx.trigger.text, ctx.classifier).intents.some((i) => i.intent === want) ? true : 'intent'
  },
  async probability(ctx, arg) {
    const p = typeof arg === 'number' ? arg : Number((arg as any)?.p)
    return ctx.rng() < p ? true : 'probability'
  },
}
