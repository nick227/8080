// Server faces of the shared "human-authored" rule (packages/shared/src/authorship.ts).
// Keep them equivalent: the parity suite checks all three return the same item set.
import { Prisma } from '@project/db'
import { HUMAN_KIND } from '@project/shared'

/** Prisma filter: the item's Message author is a person. */
export const humanAuthoredWhere = {
  message: { author: { kind: HUMAN_KIND } },
} satisfies Prisma.ItemWhereInput

/** Raw-SQL condition for `$queryRaw` seams; `itemAlias` is the Item table alias in that query. */
export function humanAuthoredSql(itemAlias: string) {
  const i = Prisma.raw(itemAlias)
  return Prisma.sql`EXISTS (SELECT 1 FROM Message ham JOIN User hau ON hau.id = ham.authorId WHERE ham.id = ${i}.messageId AND hau.kind = ${HUMAN_KIND})`
}
