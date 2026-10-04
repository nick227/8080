// "Human-authored" — the one rule behind every discovery/freshness signal (doc/08 I6):
// bot items may appear in a room, but lobby order, response counts, card pictures and
// unread are computed from items whose Message author is a person.
//
// This is the definition. Other layers implement the same predicate:
//   isHumanAuthored  — DTOs / in memory (here; server and client)
//   humanAuthoredWhere, humanAuthoredSql — apps/server/src/lib/authorship.ts
// The parity suite (apps/server/src/__tests__/authorship.test.ts) runs one fixture set
// through all three; a new seam must join it.

export const HUMAN_KIND = 'human' as const
export type AuthorKind = 'human' | 'bot'

type WithKind = { kind?: AuthorKind | string | null }

export function isHumanAuthor(author: WithKind | null | undefined): boolean {
  return author?.kind === HUMAN_KIND
}

/** Accepts an API Item (`message.author`) or a flattened client item (`author`). */
export function isHumanAuthored(item: { message?: { author?: WithKind | null } | null; author?: WithKind | null }): boolean {
  return isHumanAuthor(item.message?.author ?? item.author)
}
