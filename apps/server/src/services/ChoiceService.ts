// Bot message choices (doc/12 §4). A bot message may offer generic options (yes/no,
// tone, audience…). One answer closes it: the choice is stored on the Message (first
// choice wins), the change feed carries it to every viewer (item.updated), and the
// flow that owns the step decides — in code, never a model — what the bot says next.
// The click itself is never posted as chat and never sent to a model.
import { db, type Prisma } from '@project/db'
import { itemInclude, toItem } from '../lib/serialize'
import { badRequest, conflict, httpError } from '../lib/errors'
import { ItemService } from './ItemService'
import { RoomService } from './RoomService'
import { recordChange } from './roomChanges'
import { mutes } from './MuteService'
import { json, type ChoiceOffer, type StoredActions, type StoredChoice } from '../lib/choice'

export type { ChoiceOffer, ChoiceOption } from '../lib/choice'

type Tx = Prisma.TransactionClient

/** A line the bot says after a choice, optionally offering the next one. */
export type FlowSay = { text: string; offer?: Omit<ChoiceOffer, 'flow'> }
export type ChoiceContext = { flow: string; step: string; optionIds: string[]; userId: string; roomId: string; itemId: string }

export type ChoiceFlow = {
  /** Extra gate beyond `forUserId` (e.g. owners only). Default: anyone who can act in the room. */
  canChoose?: (ctx: Omit<ChoiceContext, 'optionIds'>) => Promise<boolean> | boolean
  /** Deterministic next step. Runs inside the choice transaction, so flow state and the
   *  answer commit together; what it returns is posted after commit by the bot that
   *  asked, on the same surface. */
  advance: (tx: Tx, ctx: ChoiceContext) => Promise<FlowSay[]> | FlowSay[]
}

const flows = new Map<string, ChoiceFlow>()

/** Registers the flow that answers choices offered under `key`. Returns an unregister. */
export function registerChoiceFlow(key: string, flow: ChoiceFlow) {
  flows.set(key, flow)
  return () => { if (flows.get(key) === flow) flows.delete(key) }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))

const items = new ItemService()
const rooms = new RoomService()

export class ChoiceService {
  async choose(viewerId: string, itemId: string, optionIds: string[]) {
    const item = await items.loadItem(itemId)
    const { actor, room } = await rooms.authorizeActor(viewerId, item.roomId) // 404 to non-viewers
    const actions = json<StoredActions>(item.message.actions)
    if (!actions || item.message.author.kind !== 'bot') throw badRequest('This item offers no choice', 'NOT_A_CHOICE')
    if (actor.kind === 'bot') throw httpError(403, 'Bots do not answer choices', 'NOT_YOUR_CHOICE')
    if (item.deletedAt || item.message.deletedAt) throw conflict('This choice is closed', 'CHOICE_CLOSED')

    const ids = Array.from(new Set(optionIds))
    const known = new Set(actions.options.map((o) => o.id))
    if (ids.length === 0 || ids.some((id) => !known.has(id)) || (actions.mode === 'one' && ids.length !== 1)) {
      throw badRequest(actions.mode === 'one' ? 'Choose exactly one of the offered options' : 'Choose from the offered options', 'INVALID_CHOICE')
    }

    const flow = flows.get(actions.flow)
    const base = { flow: actions.flow, step: actions.step, userId: viewerId, roomId: item.roomId, itemId: item.id }
    if (actions.forUserId && actions.forUserId !== viewerId) throw httpError(403, 'This choice is for someone else', 'NOT_YOUR_CHOICE')
    if (flow?.canChoose && !(await flow.canChoose(base))) throw httpError(403, 'This choice is for someone else', 'NOT_YOUR_CHOICE')
    await rooms.ensureHumanParticipation(actor, room)

    const says = await db.$transaction(async (tx) => {
      // The row lock makes the first answer win when two people click at once.
      const [row] = await tx.$queryRaw<{ choice: unknown }[]>`SELECT choice FROM Message WHERE id = ${item.messageId} FOR UPDATE`
      const existing = json<StoredChoice>(row?.choice)
      if (existing) {
        if (existing.userId === viewerId && sameSet(existing.optionIds, ids)) return [] // a repeat changes nothing
        throw conflict('This choice was already answered', 'CHOICE_CLOSED')
      }
      const choice: StoredChoice = { optionIds: ids, userId: viewerId, at: new Date().toISOString() }
      await tx.message.update({ where: { id: item.messageId }, data: { choice } })
      await recordChange(tx, item.roomId, item.id, viewerId)
      return flow ? await flow.advance(tx, { ...base, optionIds: ids }) : []
    })

    for (const say of says) await this.say(item.message.authorId, item.roomId, item.chat, actions.flow, say)

    const updated = await db.item.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude })
    return toItem(updated, viewerId, await mutes.mutedBy(viewerId))
  }

  // The answer is already committed; a follow-up the rails refuse (cap, unseated)
  // is logged rather than undoing the person's choice.
  private async say(botUserId: string, roomId: string, chat: boolean, flow: string, say: FlowSay) {
    try {
      const actions = say.offer ? { ...say.offer, flow } : undefined
      await items.send(botUserId, roomId, { text: say.text, chat }, { actions })
    } catch (error) {
      console.error(`[choice] ${flow}: follow-up not posted`, error)
    }
  }
}
