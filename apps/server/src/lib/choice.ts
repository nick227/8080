// Bot message choices (doc/12 §4): the offer a bot attaches to a message and the
// answer stored next to it. Shared by ItemService (stores offers) and ChoiceService
// (answers them).

export type ChoiceOption = { id: string; label: string }
/** What a bot offers. `flow` + `step` route the answer; the client never sees them. */
export type ChoiceOffer = { flow: string; step: string; mode?: 'one' | 'many'; options: ChoiceOption[]; forUserId?: string | null }
export type StoredActions = { flow: string; step: string; mode: 'one' | 'many'; options: ChoiceOption[]; forUserId: string | null }
export type StoredChoice = { optionIds: string[]; userId: string; at: string }
/** Something a bot message points at (doc/12 §5.4). */
export type MessageLink = {
  type: 'document' | 'contact' | 'compose'
  id: string
  workspaceId: string
  title: string
}

const OPTION_ID = /^[a-z0-9][a-z0-9-]{0,31}$/
const MAX_OPTIONS = 8
const MAX_LABEL = 40

/** Validates a bot's offer. Invalid offers are programming errors, so they throw plainly. */
export function storedActions(offer: ChoiceOffer): StoredActions {
  const mode = offer.mode ?? 'one'
  if (!offer.flow || offer.flow.length > 64 || !offer.step || offer.step.length > 64) throw new Error('Choice offer needs a flow and a step')
  if (mode !== 'one' && mode !== 'many') throw new Error(`Unknown choice mode: ${mode}`)
  if (!Array.isArray(offer.options) || offer.options.length < 1 || offer.options.length > MAX_OPTIONS) throw new Error(`A choice offers 1–${MAX_OPTIONS} options`)
  const ids = new Set<string>()
  const options = offer.options.map(({ id, label }) => {
    if (!OPTION_ID.test(id) || ids.has(id)) throw new Error(`Invalid or repeated option id: ${id}`)
    const text = label?.trim()
    if (!text || text.length > MAX_LABEL) throw new Error(`Option label must be 1–${MAX_LABEL} characters`)
    ids.add(id)
    return { id, label: text }
  })
  return { flow: offer.flow, step: offer.step, mode, options, forUserId: offer.forUserId ?? null }
}

// MySQL raw reads hand JSON back as text; Prisma reads hand back objects.
export const json = <T>(value: unknown): T | null => (value == null ? null : typeof value === 'string' ? JSON.parse(value) : value) as T | null
