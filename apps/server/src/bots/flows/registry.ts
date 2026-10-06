// Registered deterministic workflows (doc/12). A flow answers the choices offered
// under its key and may post through the workflow allowance (bots/limits.ts) — only
// registered flows can, so the allowance can't be claimed by ordinary bot lines.
import type { Prisma } from '@project/db'
import type { ChoiceOffer } from '../../lib/choice'

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

export const flowFor = (key: string) => flows.get(key)
export const isRegisteredFlow = (key: string) => flows.has(key)
